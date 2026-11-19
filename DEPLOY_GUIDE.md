# Deployment Guide: Serverless Framework (AWS Lambda Free Tier) + Vercel

This guide walks through deploying the **ml_train** ML backend using the **Serverless Framework** on **AWS Free Tier** (preconfigured for an existing local AWS profile such as **`test_local`**) and deploying the web studio to **Vercel**.

---

## Architecture Summary

| Layer | Where It Runs | Deployed By |
| --- | --- | --- |
| **Web UI & Control Plane API** | Vercel (Next.js App Router) | Vercel Git Integration |
| **Shared ML Runtime Layer** (`numpy`, `scipy`, `scikit-learn`, `joblib`, `pypdf`) | AWS Lambda Layer (`python3.12`) | **Serverless Framework ([`serverless.yml`](./serverless.yml))** |
| **Trainer & Document Extractor Lambda** (1024 MB, 900s timeout) | AWS Lambda | **Serverless Framework ([`serverless.yml`](./serverless.yml))** |
| **Storage & Metadata** | AWS S3 + DynamoDB (`10 RCU / 10 WCU` Always Free) | **Serverless Framework ([`serverless.yml`](./serverless.yml))** |
| **Per-Model Inference Endpoints** (`mltrain-model-*`) | AWS Lambda Function URLs | Studio UI (`POST /api/models/[id]/deploy`) |

---

## Prerequisites (On Your Local PC)

1. **Node.js 20+** and **npm**
2. **Python 3.11 or 3.12** with `pip` and `boto3`:
   ```bash
   pip install boto3
   ```
3. **AWS CLI profile `test_local`** already configured on your PC:
   ```bash
   aws sts get-caller-identity --profile test_local
   ```
   > **Using AWS IAM Identity Center (SSO)?** Refresh your session first:
   > ```bash
   > aws sso login --profile test_local
   > ```
4. **Vercel Account** connected to your GitHub repository (`orieblax/ml_train`).

> **Note on Serverless Framework v3 vs v4**  
> [`serverless.yml`](./serverless.yml) works with both Serverless Framework v3 and v4.  
> - **Serverless v3** (`npx serverless@3 ...`) is open-source and requires no Serverless Dashboard login or license key.  
> - **Serverless v4** (`npm i -g serverless`) works identically after running `serverless login`.

---

## Quick Deploy With Profile `test_local`

Pull the latest code on your PC and install dependencies:

```bash
git pull
npm install
```

Then deploy the AWS backend stack and generate your scoped studio environment variables in two commands:

```bash
# 1. Build Python 3.12 Lambda Layer + Trainer zip and deploy via Serverless Framework using profile `test_local`
npm run sls:deploy:local

# 2. Export scoped VercelAppUser credentials + CloudFormation outputs directly into `.env.local`
npm run sls:env:local -- --out .env.local
```

> **Optional overrides**:
> - Deploy to a specific region (by default `sls:deploy:local` uses the region configured on `test_local` or `us-east-1`):
>   ```bash
>   npm run sls:deploy:local -- --region us-west-2
>   ```
> - Restrict S3 presigned upload CORS to your Vercel production domain:
>   ```bash
>   npm run sls:deploy:local -- --corsOrigin https://your-app.vercel.app
>   ```

Skip down to **[Step 4: Verify Locally](#step-4-verify-locally)** if you used the two commands above, or follow the step-by-step manual breakdown below.

---

## Step-by-Step Manual Walkthrough

### Step 1: Verify Profile `test_local`

**macOS / Linux / Git Bash / WSL:**
```bash
export AWS_PROFILE=test_local
export AWS_SDK_LOAD_CONFIG=1
aws sts get-caller-identity --profile test_local
```

**Windows PowerShell:**
```powershell
$env:AWS_PROFILE = "test_local"
$env:AWS_SDK_LOAD_CONFIG = "1"
aws sts get-caller-identity --profile test_local
```

### Step 2: Build the Python 3.12 ML Layer & Trainer Package

Because Vercel and macOS/Windows PCs use different native binaries than AWS Lambda Linux, build the `manylinux2014_x86_64` Lambda Layer and Trainer package first (no `zip` binary needed — [`package_lambdas.py`](./infra/scripts/package_lambdas.py) uses Python `zipfile` with POSIX `0644`/`0755` permissions):

```bash
npm run sls:build
```

This script:
- Downloads Python 3.12 `manylinux2014_x86_64` binary wheels from [`infra/requirements-layer.txt`](./infra/requirements-layer.txt)
- Strips `tests/`, `__pycache__/`, `.pyc`, and C header files
- Enforces the **245 MB** safety ceiling (~194 MB actual, safely inside AWS Lambda's 250 MB unzipped limit)
- Writes `infra/dist/ml-runtime-layer.zip` (~60.6 MB) and `infra/dist/trainer-lambda.zip` (~11.5 KB)

### Step 3: Deploy the AWS Stack with Serverless Framework

Run Serverless Framework directly against your `test_local` profile:

```bash
npx --yes serverless@3 deploy --stage prod --aws-profile test_local --region us-east-1
```

Once deployed, export the CloudFormation outputs and create an IAM key pair for the scoped `VercelAppUser`:

```bash
python3 infra/scripts/print-env.py --stage prod --profile test_local --create-access-key --out .env.local
```
*(Use `python` instead of `python3` on Windows PowerShell/CMD if `python3` opens the Microsoft Store alias.)*

### Resources Created by Serverless Framework

- `mltrain-prod-ml-runtime`: Shared Python 3.12 ML Lambda Layer
- `mltrain-prod-trainer`: Document extractor & async AutoML trainer Lambda (7-day CloudWatch log retention)
- `mltrain-prod-storage-<account>-<region>`: Encrypted private S3 bucket with CORS for direct browser uploads
- `mltrain-prod-workspace`: DynamoDB Single-Table (`10 RCU / 10 WCU` on table + `GSI1` = `20 RCU/WCU` total, inside AWS Always Free 25 RCU/WCU quota)
- `InferenceLambdaRole`: Minimal read-only role (`s3:GetObject` on `models/*` only) passed to deployed model Lambdas
- `VercelAppUser`: Least-privilege IAM user scoped strictly to the studio S3 bucket, DynamoDB table, Trainer Lambda, and `mltrain-model-*` functions (instead of putting your broader `test_local` profile credentials in Vercel)

Example variables generated in `.env.local`:

```env
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
MLTRAIN_S3_BUCKET=mltrain-prod-storage-123456789012-us-east-1
MLTRAIN_DDB_TABLE=mltrain-prod-workspace
MLTRAIN_TRAINER_LAMBDA_ARN=arn:aws:lambda:us-east-1:123456789012:function:mltrain-prod-trainer
MLTRAIN_ML_LAYER_ARN=arn:aws:lambda:us-east-1:123456789012:layer:mltrain-prod-ml-runtime:1
MLTRAIN_INFERENCE_ROLE_ARN=arn:aws:iam::123456789012:role/mltrain-prod-inference-role-us-east-1
MLTRAIN_SESSION_SECRET=<64-hex-char-secret-printed-by-script>
APP_USERNAME=admin
APP_PASSWORD=<your-strong-login-password>
```

> **Login Screen Credentials**: Set both `APP_USERNAME` and `APP_PASSWORD` in **Vercel → Project Settings → Environment Variables** (and `.env.local` locally). All Studio pages and API routes require signing in with these credentials; rotating either variable in Vercel immediately invalidates old sessions.

---

## Step 4: Verify Locally

Start the Next.js development server on your PC:

```bash
npm run dev
```

1. Open `http://localhost:3000/`, sign in with your `APP_USERNAME` and `APP_PASSWORD`, then open `/settings` and verify all four live checks pass:
   - **S3 Bucket**: Connected
   - **DynamoDB Table**: `ACTIVE`
   - **Trainer Lambda**: `Active (python3.12, 1024 MB)`
   - **Shared ML Layer**: Found
2. Create a test project on `/`, upload sample `.txt`/`.pdf`/`.docx`/`.csv` files, click **Train Model on AWS Lambda**, inspect metrics, click **Deploy to AWS Lambda**, and test predictions in the **Live Inference Playground**.

---

## Step 5: Deploy the Web Studio to Vercel

1. Go to [vercel.com/new](https://vercel.com/new) and import **`orieblax/ml_train`**.
2. Keep the default **Next.js** preset and Root Directory (`./`).
3. Under **Environment Variables**, paste every variable from `.env.local` (`AWS_REGION` through `APP_USERNAME` and `APP_PASSWORD`).
4. Click **Deploy**.
5. Once live, open `https://<your-vercel-domain>/`, sign in with `APP_USERNAME` and `APP_PASSWORD`, and visit `/settings` to click **Run Checks** and confirm production connectivity.

---

## Step 6: Updating & Teardown

### Updating Lambda Code or Dependencies

Whenever you edit [`lambdas/trainer/handler.py`](./lambdas/trainer/handler.py) or [`lambdas/shared/text_extractor.py`](./lambdas/shared/text_extractor.py):

```bash
npm run sls:deploy:local
```

> **Note**: Editing [`lambdas/inference/handler.py`](./lambdas/inference/handler.py) only requires redeploying Vercel (and clicking **Redeploy / Update Lambda** on active models in the Studio UI), because the Vercel control plane packages `lambdas/inference/handler.py` dynamically via `fflate`.

### Tail Trainer Lambda Logs

```bash
node infra/scripts/sls-with-profile.mjs logs --profile test_local --stage prod -f trainer --tail
```

### Full AWS Teardown (`test_local`)

1. Visit `/deployments` in the Studio UI and click **Undeploy** on every active `mltrain-model-*` Lambda endpoint (these are dynamically created outside CloudFormation).
2. Empty the S3 bucket (CloudFormation cannot delete a non-empty S3 bucket):
   ```bash
   aws s3 rm s3://<YOUR_MLTRAIN_S3_BUCKET> --recursive --profile test_local
   ```
3. Delete any generated access keys on `mltrain-prod-vercel-app-<region>` in AWS IAM so CloudFormation can remove the user cleanly:
   ```bash
   aws iam list-access-keys --user-name mltrain-prod-vercel-app-us-east-1 --profile test_local
   aws iam delete-access-key --user-name mltrain-prod-vercel-app-us-east-1 --access-key-id <KEY_ID> --profile test_local
   ```
4. Remove the Serverless stack:
   ```bash
   npm run sls:remove:local
   ```

---

## AWS Free Tier & Quota Guardrails

| Service | Free Tier Allowance | How `ml_train` Stays Within Free Tier |
| --- | --- | --- |
| **AWS Lambda** | **1M requests/mo + 400,000 GB-s/mo** (Always Free) | Uses Lambda Function URLs directly (no API Gateway fee), disables Provisioned Concurrency, defaults model inference to 512 MB (800,000s/mo free). |
| **AWS DynamoDB** | **25 GB + 25 RCU / 25 WCU** (Always Free) | Single-table design provisioned at `10 RCU / 10 WCU` on table + `10 RCU / 10 WCU` on `GSI1` (`20` total). CSV datasets store 1 metadata row in DynamoDB and full rows as JSONL in S3. |
| **CloudWatch Logs** | **5 GB storage/mo** (Always Free) | `logRetentionInDays: 7` configured in `serverless.yml`. |
| **AWS S3** | 5 GB (12 months free; ~$0.023/GB/mo after) | Stores compressed `joblib` models (~1–10 MB each) and normalized texts. |
| **Vercel Hobby** | 100 GB bandwidth, 10s–60s serverless functions | Direct browser-to-S3 presigned uploads bypass Vercel's 4.5 MB payload cap; async `InvocationType: "Event"` training avoids timeouts. |

---

## Troubleshooting

- **SSO / Assumed role error with `test_local`**: Run `aws sso login --profile test_local` and ensure `pip install boto3` is installed in the active Python environment used by `npm run sls:deploy:local`.
- **`LimitExceeded` when running `npm run sls:env:local`**: IAM allows max 2 access keys per IAM user (`VercelAppUser`). Reuse your existing key in `.env.local`, or delete an old key via `aws iam delete-access-key ... --profile test_local`.
- **`S3 PUT fails with CORS error in browser`**: Confirm `MLTrainBucket` CORS matches your domain (`--corsOrigin '*'`) and that uploads go directly to the presigned S3 URL, not `/api/*`.
- **`Layer unzipped size exceeds 250 MB`**: Run `node infra/scripts/run-python.mjs infra/scripts/package_lambdas.py --check-only` to verify `infra/requirements-layer.txt` stays pinned to `numpy<2.1`, `scipy<1.14`, and `scikit-learn<1.6`.
- **`403 Forbidden` when calling Lambda Function URL**: Ensure the model was deployed via the Studio UI (`src/lib/aws/deployer.ts`), which attaches both `lambda:InvokeFunctionUrl` and `lambda:InvokeFunction` (`InvokedViaFunctionUrl: true`).
- **`AccessDeniedException` on `iam:PassRole`**: Verify `MLTRAIN_INFERENCE_ROLE_ARN` matches the exact ARN output by Serverless (`mltrain-prod-inference-role-<region>`).
