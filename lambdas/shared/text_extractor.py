"""Document text and dataset extraction utilities for PDF, DOCX, TXT, and CSV files."""

from __future__ import annotations

import csv
import io
import os
import re
import xml.etree.ElementTree as ET
import zipfile
from dataclasses import dataclass, field
from typing import Any

WORD_NAMESPACE = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


@dataclass
class ExtractedDocument:
    """Normalized result of extracting text from an uploaded document."""

    text: str
    source_type: str
    char_count: int
    word_count: int
    page_count: int | None = None
    warnings: list[str] = field(default_factory=list)


@dataclass
class ParsedCsvDataset:
    """Result of parsing a CSV dataset file."""

    headers: list[str]
    row_count: int
    sample_rows: list[dict[str, str]]
    records: list[dict[str, Any]]
    warnings: list[str] = field(default_factory=list)


def normalize_whitespace(text: str) -> str:
    """Collapse erratic control chars and excessive blank lines while preserving paragraphs."""
    cleaned = text.replace("\x00", "").replace("\r\n", "\n").replace("\r", "\n")
    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in cleaned.split("\n")]
    normalized = "\n".join(lines)
    normalized = re.sub(r"\n{3,}", "\n\n", normalized)
    return normalized.strip()


def decode_text_bytes(data: bytes) -> str:
    """Decode bytes trying UTF-8 (with BOM) first, then Latin-1."""
    for encoding in ("utf-8-sig", "utf-8", "cp1252", "latin-1"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="replace")


def detect_extension(file_name: str, mime_type: str | None = None) -> str:
    """Infer normalized lowercase document type ('pdf', 'docx', 'txt', 'csv')."""
    ext = os.path.splitext(file_name.lower())[1].lstrip(".")
    if ext in {"pdf", "docx", "txt", "md", "csv"}:
        return "txt" if ext == "md" else ext

    mime_map = {
        "application/pdf": "pdf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
        "text/plain": "txt",
        "text/markdown": "txt",
        "text/csv": "csv",
        "application/csv": "csv",
    }
    if mime_type and mime_type.lower() in mime_map:
        return mime_map[mime_type.lower()]

    raise ValueError(
        f"Unsupported document type for '{file_name}'. Supported formats: .pdf, .docx, .txt, .md, .csv"
    )


def extract_pdf_text(data: bytes) -> tuple[str, int, list[str]]:
    """Extract text from PDF bytes using pypdf."""
    from pypdf import PdfReader

    warnings: list[str] = []
    reader = PdfReader(io.BytesIO(data))
    pages_text: list[str] = []
    for page in reader.pages:
        content = (page.extract_text() or "").strip()
        if content:
            pages_text.append(content)

    combined = normalize_whitespace("\n\n".join(pages_text))
    page_count = len(reader.pages)
    if len(combined) < 20:
        warnings.append(
            "Very little selectable text was found. This PDF may be scanned/image-only without OCR."
        )
    return combined, page_count, warnings


def extract_docx_text(data: bytes) -> tuple[str, list[str]]:
    """Extract text from DOCX bytes using Python's stdlib zipfile + ElementTree (0 extra dependencies)."""
    warnings: list[str] = []
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            if "word/document.xml" not in archive.namelist():
                raise ValueError("Invalid DOCX file: missing word/document.xml")
            xml_bytes = archive.read("word/document.xml")
    except zipfile.BadZipFile as exc:
        raise ValueError("Invalid DOCX file: corrupted ZIP archive") from exc

    root = ET.fromstring(xml_bytes)
    paragraphs: list[str] = []

    p_tag = f"{WORD_NAMESPACE}p"
    t_tag = f"{WORD_NAMESPACE}t"
    tab_tag = f"{WORD_NAMESPACE}tab"
    br_tag = f"{WORD_NAMESPACE}br"
    cr_tag = f"{WORD_NAMESPACE}cr"

    for para in root.iter(p_tag):
        parts: list[str] = []
        for elem in para.iter():
            if elem.tag == t_tag and elem.text:
                parts.append(elem.text)
            elif elem.tag == tab_tag:
                parts.append("\t")
            elif elem.tag in (br_tag, cr_tag):
                parts.append("\n")
        line = "".join(parts).strip()
        if line:
            paragraphs.append(line)

    combined = normalize_whitespace("\n\n".join(paragraphs))
    if not combined:
        warnings.append("DOCX document contained no extractable body text.")
    return combined, warnings


def extract_document(
    data: bytes, file_name: str, mime_type: str | None = None
) -> ExtractedDocument:
    """Extract normalized plain text from PDF, DOCX, or TXT bytes."""
    source_type = detect_extension(file_name, mime_type)

    if source_type == "pdf":
        text, page_count, warnings = extract_pdf_text(data)
    elif source_type == "docx":
        text, warnings = extract_docx_text(data)
        page_count = None
    elif source_type == "txt":
        text = normalize_whitespace(decode_text_bytes(data))
        page_count = None
        warnings = [] if text else ["Text document is empty."]
    else:
        raise ValueError(
            "CSV files must be parsed with extract_csv_dataset() using column mapping."
        )

    words = text.split() if text else []
    return ExtractedDocument(
        text=text,
        source_type=source_type,
        char_count=len(text),
        word_count=len(words),
        page_count=page_count,
        warnings=warnings,
    )


def split_multilabel_value(raw_label: str) -> list[str]:
    """Split a label string into normalized unique tags for multilabel tasks."""
    if not raw_label:
        return []
    parts = [p.strip() for p in re.split(r"[,;|]", raw_label) if p.strip()]
    seen: set[str] = set()
    unique: list[str] = []
    for part in parts:
        if part not in seen:
            seen.add(part)
            unique.append(part)
    return unique


def extract_csv_dataset(
    data: bytes,
    text_column: str,
    label_column: str | None = None,
    task_type: str = "multiclass",
    max_sample_rows: int = 25,
) -> ParsedCsvDataset:
    """Parse a CSV file into normalized training records with sample preview rows."""
    decoded = decode_text_bytes(data)
    warnings: list[str] = []

    sample_chunk = decoded[:8192]
    delimiter = ","
    try:
        dialect = csv.Sniffer().sniff(sample_chunk, delimiters=",;\t|")
        delimiter = dialect.delimiter
    except csv.Error:
        delimiter = ","

    reader = csv.DictReader(io.StringIO(decoded), delimiter=delimiter)
    if not reader.fieldnames:
        raise ValueError("CSV file has no header row.")

    headers = [h.strip() for h in reader.fieldnames if h is not None]
    if text_column not in headers:
        raise ValueError(
            f"Text column '{text_column}' not found in CSV headers: {headers}"
        )
    if label_column and label_column not in headers:
        raise ValueError(
            f"Label column '{label_column}' not found in CSV headers: {headers}"
        )

    records: list[dict[str, Any]] = []
    sample_rows: list[dict[str, str]] = []
    skipped_empty = 0

    for row in reader:
        clean_row = {
            (k.strip() if k else ""): (v.strip() if v else "")
            for k, v in row.items()
            if k is not None
        }
        if len(sample_rows) < max_sample_rows:
            sample_rows.append(clean_row)

        text_val = normalize_whitespace(clean_row.get(text_column, ""))
        if not text_val:
            skipped_empty += 1
            continue

        raw_label = clean_row.get(label_column, "").strip() if label_column else ""
        if task_type == "multilabel":
            labels = split_multilabel_value(raw_label)
        else:
            labels = [raw_label] if raw_label else []

        records.append({"text": text_val, "labels": labels})

    if skipped_empty:
        warnings.append(f"Skipped {skipped_empty} row(s) with empty '{text_column}'.")
    if not records:
        warnings.append("No non-empty text records were found in the CSV file.")

    return ParsedCsvDataset(
        headers=headers,
        row_count=len(records),
        sample_rows=sample_rows,
        records=records,
        warnings=warnings,
    )
