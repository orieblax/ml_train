#!/usr/bin/env python3
"""Read outputs from a deployed Serverless Framework stack and print Vercel / .env.local variables."""

from __future__ import annotations

import argparse
import os
import secrets
from pathlib import Path
from typing import Any


def find_deployed_stack(
    session: Any,
    ClientError: type[Exception],
    stack_name: str,
    explicit_region: str | None,
) -> tuple[str, dict[str, str]]:
    candidates: list[str] = []
    for r in [
        explicit_region,
        os.environ.get("AWS_REGION"),
        os.environ.get("AWS_DEFAULT_REGION"),
        session.region_name,
        "us-east-1",
    ]:
        if r and r not in candidates:
            candidates.append(r)

    for region in candidates:
        cfn = session.client("cloudformation", region_name=region)
        try:
            stacks = cfn.describe_stacks(StackName=stack_name).get("Stacks", [])
            if stacks:
                outputs = {
                    o["OutputKey"]: o["OutputValue"]
                    for o in stacks[0].get("Outputs", [])
                }
                return region, outputs
        except ClientError as exc:
            if "does not exist" in str(exc):
                continue
            raise

    tried = ", ".join(candidates)
    raise SystemExit(
        f"CloudFormation stack '{stack_name}' was not found in tried region(s): {tried}.\n"
        f"Deploy it first (e.g. `npm run sls:deploy:local`) or pass `--region <region>`."
    )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Print .env.local & Vercel variables from deployed Serverless stack"
    )
    parser.add_argument("--stage", default="prod", help="Serverless stage (default: prod)")
    parser.add_argument(
        "--profile",
        default=os.environ.get("AWS_PROFILE"),
        help="AWS CLI profile name (e.g. test_local)",
    )
    parser.add_argument(
        "--region",
        default=None,
        help="AWS region (defaults to profile region or us-east-1)",
    )
    parser.add_argument("--service", default="mltrain", help="Serverless service name")
    parser.add_argument(
        "--create-access-key",
        action="store_true",
        help="Generate a new IAM access key for the scoped VercelAppUser",
    )
    parser.add_argument(
        "--out",
        default=None,
        help="Optional output file path to write env vars (e.g. .env.local)",
    )
    args = parser.parse_args()

    try:
        import boto3
        from botocore.exceptions import ClientError
    except ImportError as exc:
        raise SystemExit(
            "Missing Python dependency 'boto3'. Install it on your PC with:\n"
            "  pip install boto3\n"
        ) from exc

    session = (
        boto3.Session(profile_name=args.profile)
        if args.profile
        else boto3.Session()
    )
    stack_name = f"{args.service}-{args.stage}"
    region, outputs = find_deployed_stack(session, ClientError, stack_name, args.region)

    access_key_id = "<YOUR_IAM_ACCESS_KEY_ID>"
    secret_key = "<YOUR_IAM_SECRET_ACCESS_KEY>"
    warning_msg: str | None = None

    if args.create_access_key:
        iam = session.client("iam", region_name=region)
        user_name = outputs["VercelAppUserName"]
        try:
            key_resp = iam.create_access_key(UserName=user_name)
            access_key_id = key_resp["AccessKey"]["AccessKeyId"]
            secret_key = key_resp["AccessKey"]["SecretAccessKey"]
        except ClientError as exc:
            if exc.response.get("Error", {}).get("Code") == "LimitExceeded":
                existing = iam.list_access_keys(UserName=user_name).get(
                    "AccessKeyMetadata", []
                )
                key_ids = ", ".join(k["AccessKeyId"] for k in existing) or "unknown"
                profile_flag = f" --profile {args.profile}" if args.profile else ""
                warning_msg = (
                    f"IAM user '{user_name}' already has the maximum 2 access keys ({key_ids}).\n"
                    f"Reuse the existing credentials from .env.local, or delete an old key first:\n"
                    f"  aws iam delete-access-key --user-name {user_name} --access-key-id <OLD_KEY_ID>{profile_flag}"
                )
            else:
                raise

    session_secret = secrets.token_hex(32)
    lines = [
        f"AWS_REGION={region}",
        f"AWS_ACCESS_KEY_ID={access_key_id}",
        f"AWS_SECRET_ACCESS_KEY={secret_key}",
        f"MLTRAIN_S3_BUCKET={outputs['S3BucketName']}",
        f"MLTRAIN_DDB_TABLE={outputs['DynamoTableName']}",
        f"MLTRAIN_TRAINER_LAMBDA_ARN={outputs['TrainerLambdaArn']}",
        f"MLTRAIN_ML_LAYER_ARN={outputs['MLLayerArn']}",
        f"MLTRAIN_INFERENCE_ROLE_ARN={outputs['InferenceRoleArn']}",
        f"MLTRAIN_SESSION_SECRET={session_secret}",
        "APP_ACCESS_PIN=",
    ]
    env_block = "\n".join(lines) + "\n"

    profile_label = args.profile or "default"
    print("\n" + "=" * 72)
    print(
        f"Serverless Stack '{stack_name}' (profile={profile_label}, region={region}) -> .env.local / Vercel Env"
    )
    print("=" * 72)
    print(env_block, end="")
    print("=" * 72)

    if warning_msg:
        print(f"\nWARNING: {warning_msg}\n")

    if args.out:
        out_path = Path(args.out)
        out_path.write_text(env_block, encoding="utf-8")
        print(f"\nWrote environment file to {out_path.resolve()}")


if __name__ == "__main__":
    main()
