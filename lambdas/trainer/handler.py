"""AWS Lambda Worker: synchronous document extraction & asynchronous ML model training."""

from __future__ import annotations

import json
import os
import sys
import tempfile
import time
import traceback
import uuid
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# Ensure lambdas/ is on sys.path both locally and when packaged in AWS Lambda
LAMBDAS_ROOT = str(Path(__file__).resolve().parent.parent)
if LAMBDAS_ROOT not in sys.path:
    sys.path.insert(0, LAMBDAS_ROOT)

import boto3
import joblib
import numpy as np
from boto3.dynamodb.conditions import Key
from sklearn.calibration import CalibratedClassifierCV
from sklearn.ensemble import RandomForestClassifier
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression, SGDClassifier
from sklearn.metrics import (
    accuracy_score,
    classification_report,
    confusion_matrix,
    f1_score,
    hamming_loss,
    jaccard_score,
    precision_score,
    recall_score,
)
from sklearn.model_selection import StratifiedKFold, cross_val_score, train_test_split
from sklearn.multiclass import OneVsRestClassifier
from sklearn.naive_bayes import ComplementNB
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import MultiLabelBinarizer
from sklearn.svm import LinearSVC

from shared.text_extractor import (
    extract_csv_dataset,
    extract_document,
    split_multilabel_value,
)


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def get_aws_clients():
    region = os.environ.get("AWS_REGION", "us-east-1")
    s3 = boto3.client("s3", region_name=region)
    ddb = boto3.resource("dynamodb", region_name=region)
    table_name = os.environ["MLTRAIN_DDB_TABLE"]
    return s3, ddb.Table(table_name)


def update_job_status(
    table: Any,
    project_id: str,
    job_sk: str,
    *,
    status: str,
    stage: str,
    progress: int,
    extra: dict[str, Any] | None = None,
) -> None:
    expr_parts = [
        "#status = :status",
        "#stage = :stage",
        "#progress = :progress",
        "#updatedAt = :updatedAt",
    ]
    names = {
        "#status": "status",
        "#stage": "stage",
        "#progress": "progress",
        "#updatedAt": "updatedAt",
    }
    values: dict[str, Any] = {
        ":status": status,
        ":stage": stage,
        ":progress": progress,
        ":updatedAt": utc_now_iso(),
    }

    if extra:
        for idx, (key, val) in enumerate(extra.items()):
            placeholder_n = f"#extN{idx}"
            placeholder_v = f":extV{idx}"
            names[placeholder_n] = key
            values[placeholder_v] = val
            expr_parts.append(f"{placeholder_n} = {placeholder_v}")

    table.update_item(
        Key={"PK": f"PROJECT#{project_id}", "SK": job_sk},
        UpdateExpression="SET " + ", ".join(expr_parts),
        ExpressionAttributeNames=names,
        ExpressionAttributeValues=values,
    )


def handle_extract(event: dict[str, Any]) -> dict[str, Any]:
    """Extract text or CSV dataset rows from an uploaded S3 file and persist normalized artifacts."""
    bucket = event.get("bucket") or os.environ["MLTRAIN_S3_BUCKET"]
    project_id = event["projectId"]
    doc_id = event["docId"]
    file_name = event["fileName"]
    mime_type = event.get("mimeType")
    s3_raw_key = event["s3RawKey"]
    task_type = event.get("taskType", "multiclass")
    labels = event.get("labels") or []

    s3, table = get_aws_clients()
    raw_obj = s3.get_object(Bucket=bucket, Key=s3_raw_key)
    raw_bytes = raw_obj["Body"].read()

    ext = Path(file_name.lower()).suffix.lstrip(".")
    if ext == "csv":
        text_column = event.get("textColumn")
        label_column = event.get("labelColumn")
        if not text_column:
            raise ValueError("textColumn is required when ingesting a CSV dataset.")

        parsed = extract_csv_dataset(
            raw_bytes,
            text_column=text_column,
            label_column=label_column,
            task_type=task_type,
        )
        s3_text_key = f"projects/{project_id}/extracted/{doc_id}.jsonl"
        jsonl_body = "\n".join(json.dumps(r, ensure_ascii=False) for r in parsed.records)
        s3.put_object(
            Bucket=bucket,
            Key=s3_text_key,
            Body=jsonl_body.encode("utf-8"),
            ContentType="application/x-ndjson",
        )

        label_counts: Counter[str] = Counter()
        labeled_rows = 0
        for rec in parsed.records:
            if rec["labels"]:
                labeled_rows += 1
                for lbl in rec["labels"]:
                    label_counts[lbl] += 1

        preview_text = "\n".join(
            f"[{', '.join(r['labels']) or 'unlabeled'}] {r['text'][:140]}"
            for r in parsed.records[:5]
        )
        now = utc_now_iso()
        item = {
            "PK": f"PROJECT#{project_id}",
            "SK": f"DOC#{doc_id}",
            "GSI1PK": f"PROJECT#{project_id}#DOCS",
            "GSI1SK": f"{now}#{doc_id}",
            "entityType": "DOCUMENT",
            "docId": doc_id,
            "projectId": project_id,
            "fileName": file_name,
            "sourceType": "csv_dataset",
            "s3RawKey": s3_raw_key,
            "s3TextKey": s3_text_key,
            "textColumn": text_column,
            "labelColumn": label_column or "",
            "rowCount": parsed.row_count,
            "labeledCount": labeled_rows,
            "labelCounts": dict(label_counts),
            "sampleRows": parsed.sample_rows[:15],
            "textPreview": preview_text[:450],
            "charCount": sum(len(r["text"]) for r in parsed.records),
            "wordCount": sum(len(r["text"].split()) for r in parsed.records),
            "labels": sorted(label_counts.keys()),
            "warnings": parsed.warnings,
            "status": "EXTRACTED",
            "createdAt": now,
            "updatedAt": now,
        }
        table.put_item(Item=item)
        return {
            "ok": True,
            "docId": doc_id,
            "sourceType": "csv_dataset",
            "rowCount": parsed.row_count,
            "labeledCount": labeled_rows,
            "labelCounts": dict(label_counts),
            "warnings": parsed.warnings,
            "s3TextKey": s3_text_key,
        }

    extracted = extract_document(raw_bytes, file_name=file_name, mime_type=mime_type)
    s3_text_key = f"projects/{project_id}/extracted/{doc_id}.txt"
    s3.put_object(
        Bucket=bucket,
        Key=s3_text_key,
        Body=extracted.text.encode("utf-8"),
        ContentType="text/plain; charset=utf-8",
    )

    clean_labels = (
        split_multilabel_value(",".join(labels))
        if task_type == "multilabel"
        else [str(l).strip() for l in labels if str(l).strip()]
    )

    now = utc_now_iso()
    item = {
        "PK": f"PROJECT#{project_id}",
        "SK": f"DOC#{doc_id}",
        "GSI1PK": f"PROJECT#{project_id}#DOCS",
        "GSI1SK": f"{now}#{doc_id}",
        "entityType": "DOCUMENT",
        "docId": doc_id,
        "projectId": project_id,
        "fileName": file_name,
        "sourceType": extracted.source_type,
        "s3RawKey": s3_raw_key,
        "s3TextKey": s3_text_key,
        "textPreview": extracted.text[:450],
        "charCount": extracted.char_count,
        "wordCount": extracted.word_count,
        "pageCount": extracted.page_count,
        "labels": clean_labels,
        "warnings": extracted.warnings,
        "status": "EXTRACTED",
        "createdAt": now,
        "updatedAt": now,
    }
    # DynamoDB rejects None attributes if omitted cleanly
    if extracted.page_count is None:
        item.pop("pageCount", None)
    table.put_item(Item=item)

    return {
        "ok": True,
        "docId": doc_id,
        "sourceType": extracted.source_type,
        "charCount": extracted.char_count,
        "wordCount": extracted.word_count,
        "pageCount": extracted.page_count,
        "textPreview": extracted.text[:450],
        "warnings": extracted.warnings,
        "s3TextKey": s3_text_key,
    }


def build_vectorizer(config: dict[str, Any]) -> TfidfVectorizer:
    ngram_min = int(config.get("ngramMin", 1))
    ngram_max = int(config.get("ngramMax", 2))
    max_features = int(config.get("maxFeatures", 15000))
    sublinear_tf = bool(config.get("sublinearTf", True))
    lowercase = bool(config.get("lowercase", True))
    stop_words = "english" if config.get("stopWords", "english") == "english" else None
    analyzer = config.get("analyzer", "word")
    if analyzer not in ("word", "char_wb"):
        analyzer = "word"
    if analyzer == "char_wb":
        stop_words = None

    return TfidfVectorizer(
        ngram_range=(ngram_min, ngram_max),
        max_features=max_features,
        sublinear_tf=sublinear_tf,
        lowercase=lowercase,
        stop_words=stop_words,
        analyzer=analyzer,
        min_df=1,
    )


def make_base_estimator(
    algorithm: str,
    *,
    seed: int = 42,
    min_train_class_count: int = 3,
) -> Any:
    if algorithm == "logistic_regression":
        return LogisticRegression(
            max_iter=1000,
            C=1.5,
            class_weight="balanced",
            random_state=seed,
        )
    if algorithm == "linear_svc":
        base_svc = LinearSVC(C=1.0, class_weight="balanced", dual="auto", random_state=seed)
        if min_train_class_count >= 2:
            cv_folds = min(3, min_train_class_count)
            return CalibratedClassifierCV(base_svc, cv=cv_folds)
        # Fallback when a rare class has < 2 samples in train split
        return LogisticRegression(
            max_iter=1000,
            C=2.0,
            class_weight="balanced",
            random_state=seed,
        )
    if algorithm == "naive_bayes":
        return ComplementNB(alpha=0.5)
    if algorithm == "sgd_classifier":
        return SGDClassifier(
            loss="log_loss",
            max_iter=1000,
            tol=1e-3,
            class_weight="balanced",
            random_state=seed,
        )
    if algorithm == "random_forest":
        return RandomForestClassifier(
            n_estimators=150,
            max_depth=35,
            class_weight="balanced",
            random_state=seed,
            n_jobs=1,  # Lambda /dev/shm lacks POSIX semaphores for multiprocessing
        )
    raise ValueError(f"Unsupported algorithm: {algorithm}")


def safe_train_test_split(
    texts: list[str],
    labels: list[Any],
    *,
    test_size: float,
    seed: int,
    task_type: str,
) -> tuple[list[str], list[str], list[Any], list[Any]]:
    """Perform stratified split when valid, gracefully falling back for tiny/rare classes."""
    n = len(texts)
    if task_type != "multilabel":
        counts = Counter(labels)
        min_count = min(counts.values())
        n_classes = len(counts)
        n_test = int(round(n * test_size))
        n_train = n - n_test
        if min_count >= 2 and n_test >= n_classes and n_train >= n_classes:
            return train_test_split(
                texts,
                labels,
                test_size=test_size,
                random_state=seed,
                stratify=labels,
            )

    return train_test_split(texts, labels, test_size=test_size, random_state=seed)


def extract_top_features(
    pipeline: Pipeline,
    classes: list[str],
    task_type: str,
    top_k: int = 12,
) -> dict[str, list[dict[str, float | str]]]:
    """Extract highest-signal n-grams per class from fitted linear, NB, or tree pipelines."""
    tfidf: TfidfVectorizer = pipeline.named_steps["tfidf"]
    clf = pipeline.named_steps["clf"]
    feature_names = tfidf.get_feature_names_out()
    result: dict[str, list[dict[str, float | str]]] = {}

    def top_from_weights(weights: np.ndarray) -> list[dict[str, float | str]]:
        idx = np.argsort(weights)[-top_k:][::-1]
        return [
            {"token": str(feature_names[i]), "weight": round(float(weights[i]), 4)}
            for i in idx
            if weights[i] > 0
        ]

    if task_type == "multilabel" and isinstance(clf, OneVsRestClassifier):
        for class_idx, estimator in enumerate(clf.estimators_):
            label = classes[class_idx]
            if hasattr(estimator, "coef_"):
                result[label] = top_from_weights(np.asarray(estimator.coef_[0]))
            elif hasattr(estimator, "feature_log_prob_"):
                log_p = estimator.feature_log_prob_
                diff = log_p[1] - log_p[0] if log_p.shape[0] > 1 else log_p[0]
                result[label] = top_from_weights(np.asarray(diff))
            elif hasattr(estimator, "calibrated_classifiers_"):
                coefs = [
                    np.asarray(cc.estimator.coef_[0])
                    for cc in estimator.calibrated_classifiers_
                    if hasattr(cc.estimator, "coef_")
                ]
                if coefs:
                    result[label] = top_from_weights(np.mean(coefs, axis=0))
        return result

    # Unwrap CalibratedClassifierCV if present
    coef_matrix: np.ndarray | None = None
    if hasattr(clf, "coef_"):
        coef_matrix = np.asarray(clf.coef_)
    elif hasattr(clf, "calibrated_classifiers_"):
        sub_coefs = [
            np.asarray(cc.estimator.coef_)
            for cc in clf.calibrated_classifiers_
            if hasattr(cc.estimator, "coef_")
        ]
        if sub_coefs:
            coef_matrix = np.mean(sub_coefs, axis=0)
    elif hasattr(clf, "feature_log_prob_"):
        # ComplementNB / MultinomialNB
        log_probs = np.asarray(clf.feature_log_prob_)
        # Higher relative log probability indicates stronger association for ComplementNB/MNB
        # Note: ComplementNB stores complement weights in feature_log_prob_ (lower = stronger),
        # while class_log_prior_ / feature_count_ can derive class log odds directly.
        if hasattr(clf, "feature_count_"):
            fc = np.asarray(clf.feature_count_, dtype=float) + 0.5
            row_sums = fc.sum(axis=1, keepdims=True)
            probs = fc / np.maximum(row_sums, 1.0)
            mean_probs = probs.mean(axis=0, keepdims=True)
            coef_matrix = np.log(probs + 1e-9) - np.log(mean_probs + 1e-9)
        else:
            coef_matrix = log_probs

    if coef_matrix is not None:
        if coef_matrix.shape[0] == 1 and len(classes) == 2:
            # Binary LogisticRegression / LinearSVC has single row for positive class[1]
            w = coef_matrix[0]
            result[classes[0]] = top_from_weights(-w)
            result[classes[1]] = top_from_weights(w)
        else:
            for idx, label in enumerate(classes):
                if idx < coef_matrix.shape[0]:
                    result[label] = top_from_weights(coef_matrix[idx])
        return result

    if hasattr(clf, "feature_importances_"):
        importances = np.asarray(clf.feature_importances_)
        top_global = top_from_weights(importances)
        for label in classes:
            result[label] = top_global

    return result


def train_and_evaluate(
    records: list[dict[str, Any]],
    *,
    task_type: str,
    config: dict[str, Any],
    model_id: str,
    project_id: str,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Pure ML training + evaluation pipeline (testable offline without AWS)."""
    if len(records) < 6:
        raise ValueError(
            f"At least 6 labeled documents/rows are required to train and validate (found {len(records)})."
        )

    texts = [r["text"] for r in records]
    seed = int(config.get("randomSeed", 42))
    test_size = float(config.get("testSplit", 0.2))
    test_size = min(0.4, max(0.1, test_size))
    requested_algo = config.get("algorithm", "auto")

    if task_type == "multilabel":
        raw_y = [r["labels"] for r in records]
        mlb = MultiLabelBinarizer()
        y_bin = mlb.fit_transform(raw_y)
        classes = [str(c) for c in mlb.classes_]
        if len(classes) < 2:
            raise ValueError("Multilabel training requires at least 2 distinct label tags.")

        X_train, X_test, y_train, y_test = safe_train_test_split(
            texts, y_bin, test_size=test_size, seed=seed, task_type=task_type
        )
        y_train_arr = np.asarray(y_train)
        y_test_arr = np.asarray(y_test)
        min_train_count = 3
    else:
        mlb = None
        raw_y_str = [str(r["labels"][0]) for r in records]
        unique_classes = sorted(set(raw_y_str))
        if len(unique_classes) < 2:
            raise ValueError(
                f"Training requires at least 2 distinct classes (found {unique_classes})."
            )
        X_train, X_test, y_train_list, y_test_list = safe_train_test_split(
            texts, raw_y_str, test_size=test_size, seed=seed, task_type=task_type
        )
        y_train_arr = np.asarray(y_train_list)
        y_test_arr = np.asarray(y_test_list)
        train_counts = Counter(y_train_list)
        min_train_count = min(train_counts.values()) if train_counts else 1
        classes = sorted(set(raw_y_str))

    candidates = (
        ["logistic_regression", "linear_svc", "naive_bayes", "sgd_classifier"]
        if requested_algo == "auto"
        else [requested_algo]
    )

    leaderboard: list[dict[str, Any]] = []
    best_algo = candidates[0]
    best_cv_score = -1.0
    best_pipeline: Pipeline | None = None

    for algo in candidates:
        t0 = time.perf_counter()
        vectorizer = build_vectorizer(config)
        base_est = make_base_estimator(
            algo, seed=seed, min_train_class_count=min_train_count
        )
        clf = (
            OneVsRestClassifier(base_est, n_jobs=1)
            if task_type == "multilabel"
            else base_est
        )
        pipe = Pipeline([("tfidf", vectorizer), ("clf", clf)])

        cv_score: float | None = None
        if len(candidates) > 1:
            if task_type != "multilabel" and min_train_count >= 2 and len(X_train) >= 10:
                n_splits = min(5, min_train_count)
                skf = StratifiedKFold(n_splits=n_splits, shuffle=True, random_state=seed)
                scores = cross_val_score(
                    pipe, X_train, y_train_arr, cv=skf, scoring="f1_macro", n_jobs=1
                )
                cv_score = float(np.mean(scores))
            else:
                # Tiny/multilabel fallback: fit on train and score on test split
                pipe.fit(X_train, y_train_arr)
                val_pred = pipe.predict(X_test)
                cv_score = float(
                    f1_score(y_test_arr, val_pred, average="macro", zero_division=0)
                )

        pipe.fit(X_train, y_train_arr)
        test_pred = pipe.predict(X_test)
        test_macro_f1 = float(
            f1_score(y_test_arr, test_pred, average="macro", zero_division=0)
        )
        test_acc = float(accuracy_score(y_test_arr, test_pred))
        elapsed_ms = int((time.perf_counter() - t0) * 1000)

        selection_score = cv_score if cv_score is not None else test_macro_f1
        leaderboard.append(
            {
                "algorithm": algo,
                "cvMacroF1": round(cv_score, 4) if cv_score is not None else None,
                "testMacroF1": round(test_macro_f1, 4),
                "testAccuracy": round(test_acc, 4),
                "durationMs": elapsed_ms,
                "selected": False,
            }
        )

        if selection_score > best_cv_score:
            best_cv_score = selection_score
            best_algo = algo
            best_pipeline = pipe

    assert best_pipeline is not None
    for entry in leaderboard:
        if entry["algorithm"] == best_algo:
            entry["selected"] = True

    y_pred = best_pipeline.predict(X_test)
    probs = (
        best_pipeline.predict_proba(X_test)
        if hasattr(best_pipeline, "predict_proba")
        else None
    )

    accuracy = float(accuracy_score(y_test_arr, y_pred))
    macro_f1 = float(f1_score(y_test_arr, y_pred, average="macro", zero_division=0))
    weighted_f1 = float(f1_score(y_test_arr, y_pred, average="weighted", zero_division=0))
    macro_precision = float(
        precision_score(y_test_arr, y_pred, average="macro", zero_division=0)
    )
    macro_recall = float(
        recall_score(y_test_arr, y_pred, average="macro", zero_division=0)
    )

    report_dict = classification_report(
        y_test_arr,
        y_pred,
        target_names=classes if task_type == "multilabel" else None,
        labels=None if task_type == "multilabel" else classes,
        output_dict=True,
        zero_division=0,
    )
    per_class = []
    for cls_name in classes:
        stats = report_dict.get(cls_name, {})
        per_class.append(
            {
                "label": cls_name,
                "precision": round(float(stats.get("precision", 0.0)), 4),
                "recall": round(float(stats.get("recall", 0.0)), 4),
                "f1": round(float(stats.get("f1-score", 0.0)), 4),
                "support": int(stats.get("support", 0)),
            }
        )

    confusion = None
    extra_metrics: dict[str, float] = {}
    if task_type == "multilabel":
        extra_metrics["hammingLoss"] = round(float(hamming_loss(y_test_arr, y_pred)), 4)
        extra_metrics["jaccardMacro"] = round(
            float(jaccard_score(y_test_arr, y_pred, average="macro", zero_division=0)),
            4,
        )
    else:
        cm = confusion_matrix(y_test_arr, y_pred, labels=classes)
        confusion = {"labels": classes, "matrix": cm.tolist()}

    # Build up to 25 test sample predictions (prioritize misclassifications first)
    sample_predictions = []
    wrong_items = []
    right_items = []
    for idx, text in enumerate(X_test):
        if task_type == "multilabel":
            actual_labels = [classes[j] for j, v in enumerate(y_test_arr[idx]) if v == 1]
            pred_labels = [classes[j] for j, v in enumerate(y_pred[idx]) if v == 1]
            is_correct = actual_labels == pred_labels
            conf = float(np.max(probs[idx])) if probs is not None else 1.0
            row = {
                "textPreview": text[:220],
                "actual": actual_labels,
                "predicted": pred_labels,
                "confidence": round(conf, 4),
                "correct": is_correct,
            }
        else:
            actual_lbl = str(y_test_arr[idx])
            pred_lbl = str(y_pred[idx])
            is_correct = actual_lbl == pred_lbl
            conf = float(np.max(probs[idx])) if probs is not None else 1.0
            row = {
                "textPreview": text[:220],
                "actual": [actual_lbl],
                "predicted": [pred_lbl],
                "confidence": round(conf, 4),
                "correct": is_correct,
            }
        (right_items if is_correct else wrong_items).append(row)

    sample_predictions = (wrong_items + right_items)[:25]
    top_features = extract_top_features(best_pipeline, classes, task_type, top_k=12)

    vocab_size = len(best_pipeline.named_steps["tfidf"].vocabulary_)

    metrics = {
        "modelId": model_id,
        "projectId": project_id,
        "taskType": task_type,
        "algorithm": best_algo,
        "requestedAlgorithm": requested_algo,
        "classes": classes,
        "trainCount": len(X_train),
        "testCount": len(X_test),
        "vocabSize": vocab_size,
        "summary": {
            "accuracy": round(accuracy, 4),
            "macroF1": round(macro_f1, 4),
            "weightedF1": round(weighted_f1, 4),
            "macroPrecision": round(macro_precision, 4),
            "macroRecall": round(macro_recall, 4),
            **extra_metrics,
        },
        "perClass": per_class,
        "confusionMatrix": confusion,
        "topFeatures": top_features,
        "leaderboard": leaderboard,
        "samplePredictions": sample_predictions,
        "config": config,
    }

    bundle = {
        "format_version": 1,
        "model_id": model_id,
        "project_id": project_id,
        "task_type": task_type,
        "algorithm": best_algo,
        "classes": classes,
        "pipeline": best_pipeline,
        "mlb": mlb,
        "multilabel_threshold": 0.5,
        "created_at": utc_now_iso(),
    }
    return bundle, metrics


def load_project_labeled_records(
    s3: Any, table: Any, bucket: str, project_id: str
) -> list[dict[str, Any]]:
    """Query all project documents from DynamoDB and fetch extracted text / JSONL datasets from S3."""
    docs: list[dict[str, Any]] = []
    query_kwargs: dict[str, Any] = {
        "KeyConditionExpression": Key("PK").eq(f"PROJECT#{project_id}")
        & Key("SK").begins_with("DOC#"),
    }
    while True:
        resp = table.query(**query_kwargs)
        docs.extend(resp.get("Items", []))
        if "LastEvaluatedKey" not in resp:
            break
        query_kwargs["ExclusiveStartKey"] = resp["LastEvaluatedKey"]

    records: list[dict[str, Any]] = []
    for doc in docs:
        if doc.get("status") != "EXTRACTED":
            continue
        s3_text_key = doc.get("s3TextKey")
        if not s3_text_key:
            continue

        if doc.get("sourceType") == "csv_dataset":
            obj = s3.get_object(Bucket=bucket, Key=s3_text_key)
            for line in obj["Body"].read().decode("utf-8").splitlines():
                if not line.strip():
                    continue
                rec = json.loads(line)
                if rec.get("text") and rec.get("labels"):
                    records.append({"text": rec["text"], "labels": rec["labels"]})
        else:
            labels = [str(l).strip() for l in (doc.get("labels") or []) if str(l).strip()]
            if not labels:
                continue
            obj = s3.get_object(Bucket=bucket, Key=s3_text_key)
            text = obj["Body"].read().decode("utf-8").strip()
            if text:
                records.append({"text": text, "labels": labels})

    return records


def handle_train(event: dict[str, Any]) -> dict[str, Any]:
    """Run asynchronous training job on project documents and save model artifact to S3."""
    bucket = event.get("bucket") or os.environ["MLTRAIN_S3_BUCKET"]
    project_id = event["projectId"]
    job_id = event["jobId"]
    job_sk = event["jobSk"]
    task_type = event.get("taskType", "multiclass")
    config = event.get("config") or {}
    version = int(event.get("nextVersion", 1))
    model_id = event.get("modelId") or f"mdl_{uuid.uuid4().hex[:12]}"

    s3, table = get_aws_clients()
    started_at = utc_now_iso()
    start_perf = time.perf_counter()

    try:
        update_job_status(
            table,
            project_id,
            job_sk,
            status="RUNNING",
            stage="loading_documents",
            progress=15,
            extra={"startedAt": started_at},
        )
        records = load_project_labeled_records(s3, table, bucket, project_id)

        update_job_status(
            table,
            project_id,
            job_sk,
            status="RUNNING",
            stage="training_models",
            progress=45,
            extra={"datasetStats": {"labeledSamples": len(records)}},
        )

        bundle, metrics = train_and_evaluate(
            records,
            task_type=task_type,
            config=config,
            model_id=model_id,
            project_id=project_id,
        )

        update_job_status(
            table,
            project_id,
            job_sk,
            status="RUNNING",
            stage="saving_artifact",
            progress=85,
        )

        s3_model_key = f"models/{model_id}/model.joblib"
        s3_metrics_key = f"models/{model_id}/metrics.json"

        with tempfile.NamedTemporaryFile(suffix=".joblib", delete=False) as tmp_f:
            tmp_path = tmp_f.name
        try:
            joblib.dump(bundle, tmp_path, compress=3)
            artifact_size_bytes = os.path.getsize(tmp_path)
            with open(tmp_path, "rb") as f:
                s3.put_object(
                    Bucket=bucket,
                    Key=s3_model_key,
                    Body=f.read(),
                    ContentType="application/octet-stream",
                )
        finally:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)

        metrics["artifactSizeBytes"] = artifact_size_bytes
        metrics["durationMs"] = int((time.perf_counter() - start_perf) * 1000)

        s3.put_object(
            Bucket=bucket,
            Key=s3_metrics_key,
            Body=json.dumps(metrics, indent=2).encode("utf-8"),
            ContentType="application/json",
        )

        finished_at = utc_now_iso()
        model_item = {
            "PK": f"PROJECT#{project_id}",
            "SK": f"MODEL#{finished_at}#{model_id}",
            "GSI1PK": f"MODEL#{model_id}",
            "GSI1SK": "META",
            "entityType": "MODEL",
            "modelId": model_id,
            "projectId": project_id,
            "jobId": job_id,
            "version": version,
            "taskType": task_type,
            "algorithm": bundle["algorithm"],
            "classes": bundle["classes"],
            "s3ModelKey": s3_model_key,
            "s3MetricsKey": s3_metrics_key,
            "artifactSizeBytes": artifact_size_bytes,
            "trainCount": metrics["trainCount"],
            "testCount": metrics["testCount"],
            "vocabSize": metrics["vocabSize"],
            "metricsSummary": {
                k: str(v) for k, v in metrics["summary"].items()
            },
            "createdAt": finished_at,
        }
        table.put_item(Item=model_item)

        # Update project latest model pointer
        table.update_item(
            Key={"PK": "WORKSPACE#default", "SK": f"PROJECT#{project_id}"},
            UpdateExpression="SET latestModelId = :mid, updatedAt = :u",
            ExpressionAttributeValues={":mid": model_id, ":u": finished_at},
        )

        update_job_status(
            table,
            project_id,
            job_sk,
            status="SUCCEEDED",
            stage="completed",
            progress=100,
            extra={
                "modelId": model_id,
                "finishedAt": finished_at,
                "durationMs": metrics["durationMs"],
            },
        )
        return {"ok": True, "modelId": model_id, "summary": metrics["summary"]}

    except Exception as exc:
        traceback.print_exc()
        update_job_status(
            table,
            project_id,
            job_sk,
            status="FAILED",
            stage="failed",
            progress=100,
            extra={
                "errorMessage": str(exc)[:1000],
                "finishedAt": utc_now_iso(),
            },
        )
        return {"ok": False, "error": str(exc)}


def lambda_handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    action = event.get("action")
    if action == "extract":
        return handle_extract(event)
    if action == "train":
        return handle_train(event)
    raise ValueError(f"Unknown action '{action}'. Expected 'extract' or 'train'.")
