"""Self-contained AWS Lambda Function URL inference handler for deployed ML models."""

from __future__ import annotations

import base64
import hashlib
import hmac
import io
import json
import os
import re
import time
import xml.etree.ElementTree as ET
import zipfile
from typing import Any

import boto3
import joblib
import numpy as np

MODEL_BUNDLE: dict[str, Any] | None = None
LOCAL_MODEL_PATH = "/tmp/model.joblib"
WORD_NS = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"

CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Content-Type": "application/json",
}


def json_response(status: int, body: dict[str, Any]) -> dict[str, Any]:
    return {
        "statusCode": status,
        "headers": CORS_HEADERS,
        "body": json.dumps(body),
    }


def load_model_bundle() -> tuple[dict[str, Any], bool]:
    """Load trained joblib bundle from memory cache, /tmp, or S3."""
    global MODEL_BUNDLE
    if MODEL_BUNDLE is not None:
        return MODEL_BUNDLE, False

    if not os.path.exists(LOCAL_MODEL_PATH):
        bucket = os.environ["MODEL_BUCKET"]
        key = os.environ["MODEL_KEY"]
        s3 = boto3.client("s3", region_name=os.environ.get("AWS_REGION", "us-east-1"))
        s3.download_file(bucket, key, LOCAL_MODEL_PATH)

    MODEL_BUNDLE = joblib.load(LOCAL_MODEL_PATH)
    return MODEL_BUNDLE, True


def verify_auth(headers: dict[str, str]) -> bool:
    expected_hash = os.environ.get("API_KEY_HASH", "").strip()
    if not expected_hash:
        return True

    lowered = {k.lower(): v for k, v in headers.items()}
    token = ""
    auth_header = lowered.get("authorization", "")
    if auth_header.lower().startswith("bearer "):
        token = auth_header[7:].strip()
    elif lowered.get("x-api-key"):
        token = lowered["x-api-key"].strip()

    if not token:
        return False

    digest = hashlib.sha256(token.encode("utf-8")).hexdigest()
    return hmac.compare_digest(digest, expected_hash)


def extract_text_from_file_bytes(data: bytes, file_name: str) -> str:
    ext = os.path.splitext(file_name.lower())[1].lstrip(".")
    if ext in ("txt", "md", ""):
        return re.sub(r"\s+", " ", data.decode("utf-8", errors="replace")).strip()

    if ext == "pdf":
        from pypdf import PdfReader

        reader = PdfReader(io.BytesIO(data))
        pages = [(p.extract_text() or "").strip() for p in reader.pages]
        return re.sub(r"\s+", " ", "\n".join(pages)).strip()

    if ext == "docx":
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            xml_bytes = archive.read("word/document.xml")
        root = ET.fromstring(xml_bytes)
        paragraphs = []
        for para in root.iter(f"{WORD_NS}p"):
            parts = [
                elem.text
                for elem in para.iter(f"{WORD_NS}t")
                if elem.text
            ]
            if parts:
                paragraphs.append("".join(parts))
        return re.sub(r"\s+", " ", "\n".join(paragraphs)).strip()

    raise ValueError(f"Unsupported file extension '.{ext}'. Use .pdf, .docx, or .txt.")


def compute_top_signals(
    bundle: dict[str, Any], text: str, class_index: int, top_k: int = 5
) -> list[dict[str, float | str]]:
    """Return the highest-contributing tokens present in this input document."""
    pipeline = bundle["pipeline"]
    tfidf = pipeline.named_steps["tfidf"]
    clf = pipeline.named_steps["clf"]
    feature_names = tfidf.get_feature_names_out()
    vec = tfidf.transform([text])

    nonzero_cols = vec.indices
    if len(nonzero_cols) == 0:
        return []

    weights: np.ndarray | None = None
    classes = bundle["classes"]

    if bundle["task_type"] == "multilabel" and hasattr(clf, "estimators_"):
        est = clf.estimators_[class_index]
        if hasattr(est, "coef_"):
            weights = np.asarray(est.coef_[0])
    elif hasattr(clf, "coef_"):
        coef = np.asarray(clf.coef_)
        if coef.shape[0] == 1 and len(classes) == 2:
            weights = -coef[0] if class_index == 0 else coef[0]
        elif class_index < coef.shape[0]:
            weights = coef[class_index]
    elif hasattr(clf, "calibrated_classifiers_"):
        sub = [
            np.asarray(cc.estimator.coef_)
            for cc in clf.calibrated_classifiers_
            if hasattr(cc.estimator, "coef_")
        ]
        if sub:
            coef = np.mean(sub, axis=0)
            if coef.shape[0] == 1 and len(classes) == 2:
                weights = -coef[0] if class_index == 0 else coef[0]
            elif class_index < coef.shape[0]:
                weights = coef[class_index]

    if weights is None:
        return []

    signals = []
    for col, val in zip(vec.indices, vec.data):
        score = float(val * weights[col])
        if score > 0:
            signals.append({"token": str(feature_names[col]), "score": round(score, 4)})
    signals.sort(key=lambda s: s["score"], reverse=True)
    return signals[:top_k]


def predict_texts(bundle: dict[str, Any], texts: list[str]) -> list[dict[str, Any]]:
    pipeline = bundle["pipeline"]
    classes: list[str] = bundle["classes"]
    task_type: str = bundle["task_type"]
    threshold: float = float(bundle.get("multilabel_threshold", 0.5))

    if hasattr(pipeline, "predict_proba"):
        probs_matrix = np.asarray(pipeline.predict_proba(texts))
    else:
        preds = pipeline.predict(texts)
        probs_matrix = np.zeros((len(texts), len(classes)))
        for idx, p in enumerate(preds):
            if p in classes:
                probs_matrix[idx, classes.index(p)] = 1.0

    results = []
    for i, text in enumerate(texts):
        probs = probs_matrix[i]
        prob_map = {cls: round(float(probs[j]), 4) for j, cls in enumerate(classes)}

        if task_type == "multilabel":
            active_indices = [j for j, p in enumerate(probs) if p >= threshold]
            if not active_indices:
                active_indices = [int(np.argmax(probs))]
            predicted_labels = [classes[j] for j in active_indices]
            top_idx = int(np.argmax(probs))
            results.append(
                {
                    "label": predicted_labels[0],
                    "labels": predicted_labels,
                    "confidence": round(float(probs[top_idx]), 4),
                    "probabilities": prob_map,
                    "topSignals": compute_top_signals(bundle, text, top_idx),
                }
            )
        else:
            top_idx = int(np.argmax(probs))
            results.append(
                {
                    "label": classes[top_idx],
                    "labels": [classes[top_idx]],
                    "confidence": round(float(probs[top_idx]), 4),
                    "probabilities": prob_map,
                    "topSignals": compute_top_signals(bundle, text, top_idx),
                }
            )
    return results


def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    t0 = time.perf_counter()

    # Handle Lambda Function URL v2 HTTP event vs direct Lambda invocation
    is_http = "requestContext" in event and "http" in event.get("requestContext", {})
    if is_http:
        http_info = event["requestContext"]["http"]
        method = http_info.get("method", "GET").upper()
        path = event.get("rawPath", "/")
        headers = event.get("headers") or {}

        if method == "OPTIONS":
            return json_response(200, {"ok": True})

        if method == "GET" and path in ("/", "/health"):
            bundle, cold_start = load_model_bundle()
            return json_response(
                200,
                {
                    "status": "healthy",
                    "modelId": bundle.get("model_id") or os.environ.get("MODEL_ID"),
                    "taskType": bundle.get("task_type"),
                    "algorithm": bundle.get("algorithm"),
                    "classes": bundle.get("classes", []),
                    "coldStart": cold_start,
                },
            )

        if not verify_auth(headers):
            return json_response(401, {"error": "Unauthorized: invalid or missing API key."})

        raw_body = event.get("body") or "{}"
        if event.get("isBase64Encoded"):
            raw_body = base64.b64decode(raw_body).decode("utf-8")
        try:
            payload = json.loads(raw_body)
        except json.JSONDecodeError:
            return json_response(400, {"error": "Invalid JSON request body."})
    else:
        payload = event

    try:
        bundle, cold_start = load_model_bundle()
        texts: list[str] = []

        if isinstance(payload.get("fileBase64"), str):
            file_bytes = base64.b64decode(payload["fileBase64"])
            file_name = payload.get("fileName", "document.txt")
            extracted = extract_text_from_file_bytes(file_bytes, file_name)
            if not extracted:
                return json_response(400, {"error": "No extractable text found in uploaded file."})
            texts = [extracted]
        elif isinstance(payload.get("texts"), list):
            texts = [str(t).strip() for t in payload["texts"] if str(t).strip()]
            if len(texts) > 50:
                return json_response(400, {"error": "Maximum batch size is 50 texts per request."})
        elif isinstance(payload.get("text"), str) and payload["text"].strip():
            texts = [payload["text"].strip()]
        else:
            return json_response(
                400,
                {
                    "error": "Provide 'text', 'texts' (array), or 'fileBase64' + 'fileName' in request body."
                },
            )

        predictions = predict_texts(bundle, texts)
        latency_ms = round((time.perf_counter() - t0) * 1000, 2)
        result = {
            "modelId": bundle.get("model_id") or os.environ.get("MODEL_ID"),
            "taskType": bundle["task_type"],
            "algorithm": bundle["algorithm"],
            "coldStart": cold_start,
            "latencyMs": latency_ms,
            "predictions": predictions,
        }
        return json_response(200, result) if is_http else result

    except Exception as exc:
        err = {"error": str(exc)}
        return json_response(500, err) if is_http else err
