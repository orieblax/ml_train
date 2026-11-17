#!/usr/bin/env node
/**
 * Run Serverless Framework with an AWS CLI named profile (default: test_local).
 * Resolves profile credentials & region via boto3 (supporting IAM keys, assumed roles, and AWS SSO),
 * verifies STS caller identity, and executes `npx --yes serverless@3 ...`.
 */
import { spawnSync } from "node:child_process";

function findPython() {
  const candidates =
    process.platform === "win32"
      ? [
          { cmd: "python", prefix: [] },
          { cmd: "py", prefix: ["-3"] },
          { cmd: "python3", prefix: [] },
        ]
      : [
          { cmd: "python3", prefix: [] },
          { cmd: "python", prefix: [] },
        ];

  for (const cand of candidates) {
    const check = spawnSync(
      cand.cmd,
      [...cand.prefix, "-c", "import sys; print(sys.version_info[0])"],
      { encoding: "utf8", stdio: "pipe" }
    );
    if (check.status === 0 && check.stdout.trim() === "3") {
      return cand;
    }
  }
  return null;
}

const rawArgs = process.argv.slice(2);
const slsCommand = rawArgs[0] && !rawArgs[0].startsWith("-") ? rawArgs[0] : "deploy";
const optionArgs = rawArgs[0] && !rawArgs[0].startsWith("-") ? rawArgs.slice(1) : rawArgs;

let profile = process.env.AWS_PROFILE || "test_local";
let stage = "prod";
let region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "";
const passthrough = [];

for (let i = 0; i < optionArgs.length; i++) {
  const arg = optionArgs[i];
  if ((arg === "--profile" || arg === "--aws-profile") && optionArgs[i + 1]) {
    profile = optionArgs[++i];
  } else if (arg.startsWith("--profile=") || arg.startsWith("--aws-profile=")) {
    profile = arg.split("=")[1];
  } else if ((arg === "--stage" || arg === "-s") && optionArgs[i + 1]) {
    stage = optionArgs[++i];
  } else if (arg.startsWith("--stage=")) {
    stage = arg.split("=")[1];
  } else if ((arg === "--region" || arg === "-r") && optionArgs[i + 1]) {
    region = optionArgs[++i];
  } else if (arg.startsWith("--region=")) {
    region = arg.split("=")[1];
  } else {
    passthrough.push(arg);
  }
}

const childEnv = {
  ...process.env,
  AWS_SDK_LOAD_CONFIG: "1",
  SLS_TELEMETRY_DISABLED: "1",
};
let resolvedViaBoto = false;

const py = findPython();
if (py) {
  const pyScript = `
import json, sys
try:
    import boto3
except ImportError:
    print(json.dumps({"missing_boto3": True}))
    sys.exit(0)

profile = sys.argv[1]
explicit_region = sys.argv[2] or None
session = boto3.Session(profile_name=profile)
region = explicit_region or session.region_name or "us-east-1"
sts = session.client("sts", region_name=region)
ident = sts.get_caller_identity()
creds = session.get_credentials().get_frozen_credentials()
print(json.dumps({
    "ok": True,
    "account": ident["Account"],
    "arn": ident["Arn"],
    "region": region,
    "access_key": creds.access_key,
    "secret_key": creds.secret_key,
    "token": creds.token or "",
}))
`;

  const probe = spawnSync(
    py.cmd,
    [...py.prefix, "-c", pyScript, profile, region],
    { encoding: "utf8", stdio: "pipe" }
  );

  if (probe.status !== 0) {
    console.error(
      `ERROR: Failed to authenticate with AWS profile '${profile}'.\n` +
        (probe.stderr || probe.stdout || "").trim() +
        `\n\nHints:\n` +
        `  - Verify profile exists: aws configure list --profile ${profile}\n` +
        `  - If using AWS SSO, refresh session: aws sso login --profile ${profile}`
    );
    process.exit(probe.status || 1);
  }

  let parsed = null;
  try {
    parsed = JSON.parse(probe.stdout.trim());
  } catch {
    parsed = null;
  }

  if (parsed?.ok) {
    resolvedViaBoto = true;
    region = region || parsed.region;
    console.log(
      `==> AWS Profile: ${profile} | Account: ${parsed.account} | Region: ${region} | Identity: ${parsed.arn}`
    );
    childEnv.AWS_ACCESS_KEY_ID = parsed.access_key;
    childEnv.AWS_SECRET_ACCESS_KEY = parsed.secret_key;
    if (parsed.token) {
      childEnv.AWS_SESSION_TOKEN = parsed.token;
    } else {
      delete childEnv.AWS_SESSION_TOKEN;
    }
    delete childEnv.AWS_PROFILE;
    childEnv.AWS_REGION = region;
  }
}

if (!region) {
  region = "us-east-1";
}

const slsArgs = [slsCommand, "--stage", stage, "--region", region, ...passthrough];
if (!resolvedViaBoto) {
  childEnv.AWS_PROFILE = profile;
  childEnv.AWS_REGION = region;
  slsArgs.push("--aws-profile", profile);
  console.log(`==> Running Serverless with --aws-profile ${profile} (region=${region})`);
}

let res;
if (process.platform === "win32") {
  const quoted = slsArgs.map((a) =>
    /[\s"&|<>^()]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a
  );
  res = spawnSync(`npx --yes serverless@3 ${quoted.join(" ")}`, {
    stdio: "inherit",
    shell: true,
    env: childEnv,
  });
} else {
  res = spawnSync("npx", ["--yes", "serverless@3", ...slsArgs], {
    stdio: "inherit",
    env: childEnv,
  });
}

if (res.error) {
  console.error(res.error.message);
  process.exit(1);
}
process.exit(res.status ?? 1);
