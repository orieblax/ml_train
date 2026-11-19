# ml_train — Document ML Training & AWS Lambda Deployment Studio

Train text classification, multi-label tagging, and sentiment ML models from your documents (`.pdf`, `.docx`, `.txt`, `.csv`) and deploy each model as an isolated **AWS Lambda Function URL** — hosted with **Next.js on Vercel** and engineered to stay within **AWS Free Tier** limits.

## Architecture

- **Frontend & Control Plane (Vercel — Next.js App Router, TypeScript, Tailwind CSS v4)**:
  - Direct browser-to-S3 **Presigned PUT uploads** (bypasses Vercel's 4.5 MB request body limit).
  - Synchronous document text extraction via the Python Lambda worker (`action: "extract"`).
  - Asynchronous training dispatch (`InvocationType: "Event"`) with real-time progress polling.
  - One-click isolated model deployment via `@aws-sdk/client-lambda` + `fflate` in-memory zip packaging.
- **ML Compute & Hosting (AWS Lambda Free Tier — Python 3.12)**:
  - **Shared ML Runtime Layer (`< 235 MB` unzipped)**: `numpy`, `scipy`, `scikit-learn`, `joblib`, `pypdf` (+ zero-dependency stdlib `zipfile`/`xml` `.docx` extraction).
  - **Trainer Lambda** (up to 15 min timeout, 1024 MB): Runs AutoML cross-validation across Logistic Regression, LinearSVC (Calibrated), Complement Naive Bayes, and SGD Log-Loss, evaluates confusion matrix + top predictive n-grams, and saves `model.joblib` + `metrics.json` to S3.
  - **Per-Model Inference Lambda Function URLs**: ~2 KB `handler.py` attached to the shared ML Layer, lazy-loading `model.joblib` from S3 with optional Bearer API key authentication and live matched-token signal explanations.
- **Persistence (AWS Free Tier)**:
  - **DynamoDB Single-Table** (`10 RCU / 10 WCU` provisioned — well inside the Always-Free 25 RCU/WCU quota).
  - **S3 Storage** (raw documents, extracted texts, normalized JSONL CSVs, `model.joblib`, `metrics.json`).

---

## 1. Provision the AWS Backend

See **[DEPLOY_GUIDE.md](./DEPLOY_GUIDE.md)** for the full step-by-step walkthrough.

### Option A: Serverless Framework (Recommended — preconfigured for AWS profile `test_local`)

Ensure you have Node.js 20+, Python 3.11+ with `boto3` (`pip install boto3`), and your AWS CLI profile ready (`aws sts get-caller-identity --profile test_local`):

```bash
npm install
npm run sls:deploy:local
npm run sls:env:local -- --out .env.local
```

Or pass explicit flags if using another profile or region:

```bash
npx --yes serverless@3 deploy --stage prod --aws-profile test_local --region us-east-1
python3 infra/scripts/print-env.py --stage prod --profile test_local --create-access-key
```

### Option B: Standalone CloudFormation + Python Bootstrap

```bash
python3 infra/scripts/deploy.py --profile test_local --region us-east-1 --create-access-key
```

Both methods:
1. Build the Python 3.12 `manylinux2014_x86_64` Shared ML Layer (~194 MB unzipped, safely under AWS Lambda's 250 MB limit).
2. Package `lambdas/trainer` + `lambdas/shared`.
3. Provision S3, Always-Free DynamoDB (`10 RCU / 10 WCU`), Shared ML Layer, Trainer Lambda, and scoped IAM roles.
4. Print the exact environment variables to add to `.env.local` and Vercel Project Settings.

---

## 2. Local Development

```bash
cp .env.example .env.local
# Populate .env.local with the values printed by deploy.py

npm install
npm run dev
```

Visit `http://localhost:3000/settings` to verify live connectivity to S3, DynamoDB, the Trainer Lambda, and the Shared ML Layer.

---

## 3. Verification Commands

```bash
# TypeScript, ESLint, Vitest, Production Build
npm run typecheck
npm run lint
npm run test
npm run build

# Python ML & Document Extraction Tests
python3 -m pytest lambdas/tests -v

# Verify Shared ML Layer stays under 250 MB unzipped limit
bash infra/scripts/build_layer.sh --check-only
```

---

## 4. Deploy to Vercel

1. Push this repository to GitHub and import it in **Vercel** (root directory = `./`).
2. Add the environment variables from `print-env.py` / `deploy.py` (including `MLTRAIN_SESSION_SECRET`, `APP_USERNAME`, and `APP_PASSWORD`) in **Vercel → Settings → Environment Variables**.
3. Deploy! `next.config.ts` traces `lambdas/inference/handler.py` automatically via `outputFileTracingIncludes`.
