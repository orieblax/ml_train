"""End-to-end tests for ML training, joblib serialization, and Lambda Function URL inference."""

from __future__ import annotations

import base64
import hashlib
import json
import sys
from pathlib import Path

import joblib

LAMBDAS_ROOT = Path(__file__).resolve().parent.parent
if str(LAMBDAS_ROOT) not in sys.path:
    sys.path.insert(0, str(LAMBDAS_ROOT))

from inference import handler as inference_handler
from tests.test_text_extractor import make_minimal_docx, make_minimal_pdf
from trainer.handler import train_and_evaluate


def build_sample_corpus() -> list[dict]:
    billing = [
        "Please refund the duplicate invoice charge on my credit card statement.",
        "Where can I download last month PDF receipt and tax VAT invoice?",
        "My subscription renewal failed because the billing card expired yesterday.",
        "Update our company billing address and PO number for the annual plan.",
        "Why was my account billed twice for the pro tier subscription?",
        "Requesting a credit memo for unused enterprise seats on our invoice.",
    ]
    technical = [
        "API endpoint returns HTTP 502 bad gateway timeout after deployment.",
        "Webhook signature verification fails with SHA256 digest mismatch error.",
        "Python SDK throws SSL certificate verify failed connecting to cluster.",
        "Database query latency spiked above 4 seconds after schema migration.",
        "OAuth token refresh returns 401 unauthorized when scope includes write.",
        "Docker container OOMKilled during batch worker startup on node pool.",
    ]
    legal = [
        "Please review section 8 indemnification clause in the Master Services Agreement.",
        "Need signed mutual NDA and GDPR Data Processing Addendum before onboarding.",
        "Clarify intellectual property ownership terms for custom deliverables.",
        "Update governing law jurisdiction to Delaware in the SaaS license contract.",
        "Termination for convenience notice period should be sixty calendar days.",
        "Security exhibit requires SOC2 Type II compliance attestation annually.",
    ]

    records = []
    for text in billing:
        records.append({"text": text, "labels": ["Billing"]})
    for text in technical:
        records.append({"text": text, "labels": ["Technical"]})
    for text in legal:
        records.append({"text": text, "labels": ["Legal"]})
    return records


def test_automl_training_and_inference_roundtrip(tmp_path: Path, monkeypatch):
    records = build_sample_corpus()
    bundle, metrics = train_and_evaluate(
        records,
        task_type="multiclass",
        config={
            "algorithm": "auto",
            "ngramMin": 1,
            "ngramMax": 2,
            "maxFeatures": 5000,
            "testSplit": 0.25,
            "randomSeed": 42,
        },
        model_id="mdl_test_001",
        project_id="prj_test_001",
    )

    assert metrics["algorithm"] in {
        "logistic_regression",
        "linear_svc",
        "naive_bayes",
        "sgd_classifier",
    }
    assert len(metrics["leaderboard"]) == 4
    assert metrics["summary"]["accuracy"] >= 0.6
    assert metrics["confusionMatrix"] is not None
    assert len(metrics["perClass"]) == 3
    assert len(metrics["topFeatures"]) == 3

    model_file = tmp_path / "model.joblib"
    joblib.dump(bundle, model_file, compress=3)

    api_key = "mlt_secret_test_key"
    api_hash = hashlib.sha256(api_key.encode("utf-8")).hexdigest()

    monkeypatch.setattr(inference_handler, "MODEL_BUNDLE", None)
    monkeypatch.setattr(inference_handler, "LOCAL_MODEL_PATH", str(model_file))
    monkeypatch.setenv("API_KEY_HASH", api_hash)

    # 1. Health check succeeds without auth
    health_resp = inference_handler.lambda_handler(
        {
            "requestContext": {"http": {"method": "GET"}},
            "rawPath": "/health",
            "headers": {},
        },
        None,
    )
    assert health_resp["statusCode"] == 200
    health_body = json.loads(health_resp["body"])
    assert health_body["status"] == "healthy"
    assert health_body["coldStart"] is True

    # 2. Missing Bearer token is rejected with 401
    unauth_resp = inference_handler.lambda_handler(
        {
            "requestContext": {"http": {"method": "POST"}},
            "rawPath": "/predict",
            "headers": {},
            "body": json.dumps({"text": "Refund duplicate invoice charge"}),
        },
        None,
    )
    assert unauth_resp["statusCode"] == 401

    # 3. Single text prediction succeeds and stays warm
    pred_resp = inference_handler.lambda_handler(
        {
            "requestContext": {"http": {"method": "POST"}},
            "rawPath": "/predict",
            "headers": {"Authorization": f"Bearer {api_key}"},
            "body": json.dumps({
                "text": "Please refund the duplicate invoice charge on our billing card."
            }),
        },
        None,
    )
    assert pred_resp["statusCode"] == 200
    pred_body = json.loads(pred_resp["body"])
    assert pred_body["coldStart"] is False
    assert pred_body["predictions"][0]["label"] == "Billing"
    assert sum(pred_body["predictions"][0]["probabilities"].values()) > 0.99

    # 4. Base64 DOCX & PDF file upload prediction works directly on inference endpoint
    docx_b64 = base64.b64encode(
        make_minimal_docx(["Mutual NDA indemnification clause and GDPR Data Processing Addendum"])
    ).decode("ascii")
    docx_resp = inference_handler.lambda_handler(
        {
            "requestContext": {"http": {"method": "POST"}},
            "rawPath": "/predict",
            "headers": {"x-api-key": api_key},
            "body": json.dumps({"fileBase64": docx_b64, "fileName": "contract.docx"}),
        },
        None,
    )
    assert docx_resp["statusCode"] == 200
    assert json.loads(docx_resp["body"])["predictions"][0]["label"] == "Legal"

    pdf_b64 = base64.b64encode(
        make_minimal_pdf("API gateway returns HTTP 502 error timeout after database migration")
    ).decode("ascii")
    pdf_resp = inference_handler.lambda_handler(
        {
            "requestContext": {"http": {"method": "POST"}},
            "rawPath": "/predict",
            "headers": {"x-api-key": api_key},
            "body": json.dumps({"fileBase64": pdf_b64, "fileName": "incident.pdf"}),
        },
        None,
    )
    assert pdf_resp["statusCode"] == 200
    assert json.loads(pdf_resp["body"])["predictions"][0]["label"] == "Technical"


def test_multilabel_training_and_prediction(tmp_path: Path, monkeypatch):
    records = [
        {"text": "Urgent billing issue: invoice charged twice on credit card", "labels": ["Billing", "Urgent"]},
        {"text": "Need copy of March tax invoice receipt for accounting", "labels": ["Billing"]},
        {"text": "Production API server down returning 502 error immediately", "labels": ["Technical", "Urgent"]},
        {"text": "SDK throws minor warning log on Python 3.12 import", "labels": ["Technical"]},
        {"text": "Urgent security breach alert: unauthorized SSH key detected", "labels": ["Technical", "Urgent"]},
        {"text": "Annual subscription billing renewal card expired", "labels": ["Billing"]},
        {"text": "Database timeout outage impacting all customer logins right now", "labels": ["Technical", "Urgent"]},
        {"text": "Requesting billing credit note for canceled seat", "labels": ["Billing"]},
    ]
    bundle, metrics = train_and_evaluate(
        records,
        task_type="multilabel",
        config={"algorithm": "logistic_regression", "testSplit": 0.25},
        model_id="mdl_multi_001",
        project_id="prj_multi_001",
    )
    assert "hammingLoss" in metrics["summary"]
    assert metrics["confusionMatrix"] is None

    model_file = tmp_path / "multi.joblib"
    joblib.dump(bundle, model_file, compress=3)
    monkeypatch.setattr(inference_handler, "MODEL_BUNDLE", None)
    monkeypatch.setattr(inference_handler, "LOCAL_MODEL_PATH", str(model_file))
    monkeypatch.setenv("API_KEY_HASH", "")

    out = inference_handler.lambda_handler({"texts": ["Urgent invoice billing charge problem"]}, None)
    assert out["taskType"] == "multilabel"
    assert len(out["predictions"]) == 1
    assert isinstance(out["predictions"][0]["labels"], list)
