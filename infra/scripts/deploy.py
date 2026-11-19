#!/usr/bin/env python3
"""Bootstrap and deploy the AWS Free-Tier ML Studio stack using CloudFormation + boto3."""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent.parent
INFRA_DIR = ROOT_DIR / "infra"
TEMPLATE_PATH = INFRA_DIR / "cloudformation.yaml"


def ensure_artifacts_bucket(
    s3: any, ClientError: type[Exception], bucket_name: str, region: str
) -> None:
    try:
        s3.head_bucket(Bucket=bucket_name)
        print(f"==> Reusing bootstrap artifacts bucket: s3://{bucket_name}")
    except ClientError:
        print(f"==> Creating bootstrap artifacts bucket: s3://{bucket_name}")
        kwargs: dict = {"Bucket": bucket_name}
        if region != "us-east-1":
            kwargs["CreateBucketConfiguration"] = {"LocationConstraint": region}
        s3.create_bucket(**kwargs)
        s3.put_public_access_block(
            Bucket=bucket_name,
            PublicAccessBlockConfiguration={
                "BlockPublicAcls": True,
                "IgnorePublicAcls": True,
                "BlockPublicPolicy": True,
                "RestrictPublicBuckets": True,
            },
        )


def deploy_stack(
    cfn: any,
    ClientError: type[Exception],
    stack_name: str,
    template_body: str,
    params: dict[str, str],
) -> dict[str, str]:
    cf_params = [{"ParameterKey": k, "ParameterValue": v} for k, v in params.items()]
    exists = True
    try:
        cfn.describe_stacks(StackName=stack_name)
    except ClientError:
        exists = False

    if exists:
        print(f"==> Updating CloudFormation stack '{stack_name}'...")
        try:
            cfn.update_stack(
                StackName=stack_name,
                TemplateBody=template_body,
                Parameters=cf_params,
                Capabilities=["CAPABILITY_NAMED_IAM"],
            )
            waiter = cfn.get_waiter("stack_update_complete")
            waiter.wait(StackName=stack_name)
        except ClientError as exc:
            if "No updates are to be performed" in str(exc):
                print("==> Stack is already up to date.")
            else:
                raise
    else:
        print(f"==> Creating CloudFormation stack '{stack_name}'...")
        cfn.create_stack(
            StackName=stack_name,
            TemplateBody=template_body,
            Parameters=cf_params,
            Capabilities=["CAPABILITY_NAMED_IAM"],
        )
        waiter = cfn.get_waiter("stack_create_complete")
        waiter.wait(StackName=stack_name)

    stack = cfn.describe_stacks(StackName=stack_name)["Stacks"][0]
    return {out["OutputKey"]: out["OutputValue"] for out in stack.get("Outputs", [])}


def main() -> None:
    parser = argparse.ArgumentParser(description="Deploy ml_train AWS backend stack")
    parser.add_argument("--profile", default=os.environ.get("AWS_PROFILE"))
    parser.add_argument("--region", default=os.environ.get("AWS_REGION"))
    parser.add_argument("--prefix", default="mltrain")
    parser.add_argument("--stack-name", default="mltrain-studio")
    parser.add_argument("--cors-origin", default="*")
    parser.add_argument(
        "--skip-build",
        action="store_true",
        help="Skip rebuilding Lambda Layer & Trainer zip packages",
    )
    parser.add_argument(
        "--create-access-key",
        action="store_true",
        help="Create a new IAM access key for the scoped VercelAppUser",
    )
    args = parser.parse_args()

    try:
        import boto3
        from botocore.exceptions import ClientError
    except ImportError as exc:
        raise SystemExit(
            "Missing Python dependency 'boto3'. Install it with:\n  pip install boto3\n"
        ) from exc

    if not args.skip_build:
        pkg_script = INFRA_DIR / "scripts" / "package_lambdas.py"
        subprocess.run([sys.executable, str(pkg_script)], check=True)

    session = boto3.Session(profile_name=args.profile) if args.profile else boto3.Session()
    region = args.region or session.region_name or "us-east-1"

    sts = session.client("sts", region_name=region)
    account_id = sts.get_caller_identity()["Account"]
    artifacts_bucket = f"{args.prefix}-bootstrap-{account_id}-{region}"

    s3 = session.client("s3", region_name=region)
    ensure_artifacts_bucket(s3, ClientError, artifacts_bucket, region)

    layer_zip = INFRA_DIR / "dist" / "ml-runtime-layer.zip"
    trainer_zip = INFRA_DIR / "dist" / "trainer-lambda.zip"
    layer_key = "bootstrap/ml-runtime-layer.zip"
    trainer_key = "bootstrap/trainer-lambda.zip"

    print(f"==> Uploading {layer_zip.name} to s3://{artifacts_bucket}/{layer_key}")
    s3.upload_file(str(layer_zip), artifacts_bucket, layer_key)
    print(f"==> Uploading {trainer_zip.name} to s3://{artifacts_bucket}/{trainer_key}")
    s3.upload_file(str(trainer_zip), artifacts_bucket, trainer_key)

    cfn = session.client("cloudformation", region_name=region)
    outputs = deploy_stack(
        cfn,
        ClientError,
        args.stack_name,
        TEMPLATE_PATH.read_text(encoding="utf-8"),
        {
            "ProjectPrefix": args.prefix,
            "ArtifactsBucket": artifacts_bucket,
            "LayerS3Key": layer_key,
            "TrainerS3Key": trainer_key,
            "AllowedCorsOrigin": args.cors_origin,
        },
    )

    access_key_id = "<YOUR_IAM_ACCESS_KEY_ID>"
    secret_key = "<YOUR_IAM_SECRET_ACCESS_KEY>"
    if args.create_access_key:
        iam = session.client("iam", region_name=region)
        key_resp = iam.create_access_key(UserName=outputs["VercelAppUserName"])
        access_key_id = key_resp["AccessKey"]["AccessKeyId"]
        secret_key = key_resp["AccessKey"]["SecretAccessKey"]

    print("\n" + "=" * 64)
    print("AWS Stack Ready! Add these environment variables to .env.local & Vercel:")
    print("=" * 64)
    print(f"AWS_REGION={region}")
    print(f"AWS_ACCESS_KEY_ID={access_key_id}")
    print(f"AWS_SECRET_ACCESS_KEY={secret_key}")
    print(f"MLTRAIN_S3_BUCKET={outputs['S3BucketName']}")
    print(f"MLTRAIN_DDB_TABLE={outputs['DynamoTableName']}")
    print(f"MLTRAIN_TRAINER_LAMBDA_ARN={outputs['TrainerLambdaArn']}")
    print(f"MLTRAIN_ML_LAYER_ARN={outputs['MLLayerArn']}")
    print(f"MLTRAIN_INFERENCE_ROLE_ARN={outputs['InferenceRoleArn']}")
    print("MLTRAIN_SESSION_SECRET=<generate-32-char-random-secret>")
    print("APP_USERNAME=admin")
    print("APP_PASSWORD=<set-your-login-password>")
    print("=" * 64)


if __name__ == "__main__":
    main()
