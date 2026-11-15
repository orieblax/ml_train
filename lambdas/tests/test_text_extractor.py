"""Unit tests for PDF, DOCX, TXT, and CSV document extraction."""

from __future__ import annotations

import io
import sys
import zipfile
from pathlib import Path

import pytest

LAMBDAS_ROOT = Path(__file__).resolve().parent.parent
if str(LAMBDAS_ROOT) not in sys.path:
    sys.path.insert(0, str(LAMBDAS_ROOT))

from shared.text_extractor import (
    detect_extension,
    extract_csv_dataset,
    extract_document,
)


def make_minimal_docx(paragraphs: list[str]) -> bytes:
    """Build a valid minimal .docx archive containing word/document.xml."""
    p_xml = "".join(
        f"<w:p><w:r><w:t>{p}</w:t></w:r></w:p>" for p in paragraphs
    )
    doc_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        f"<w:body>{p_xml}</w:body>"
        "</w:document>"
    )
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("word/document.xml", doc_xml.encode("utf-8"))
    return buf.getvalue()


def make_minimal_pdf(text: str) -> bytes:
    """Build a valid single-page PDF 1.4 containing selectable text without external PDF generators."""
    escaped = text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
    stream = f"BT /F1 12 Tf 72 720 Td ({escaped}) Tj ET".encode("latin-1")

    objects = [
        b"1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n",
        b"2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n",
        (
            b"3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
            b"/Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj\n"
        ),
        (
            f"4 0 obj << /Length {len(stream)} >> stream\n".encode("ascii")
            + stream
            + b"\nendstream endobj\n"
        ),
        b"5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n",
    ]

    pdf = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for obj in objects:
        offsets.append(len(pdf))
        pdf.extend(obj)

    xref_pos = len(pdf)
    pdf.extend(f"xref\n0 {len(objects) + 1}\n".encode("ascii"))
    pdf.extend(b"0000000000 65535 f \n")
    for off in offsets[1:]:
        pdf.extend(f"{off:010d} 00000 n \n".encode("ascii"))
    pdf.extend(
        f"trailer << /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref_pos}\n%%EOF\n".encode(
            "ascii"
        )
    )
    return bytes(pdf)


def test_detect_extension_handles_filenames_and_mimes():
    assert detect_extension("contract.PDF") == "pdf"
    assert detect_extension("notes.md") == "txt"
    assert detect_extension("blob", "application/vnd.openxmlformats-officedocument.wordprocessingml.document") == "docx"
    with pytest.raises(ValueError):
        detect_extension("image.png")


def test_extract_txt_normalizes_whitespace_and_bom():
    raw = "\ufeffLine one\r\n\r\n\r\n  Line\t\ttwo\x00  ".encode("utf-8")
    res = extract_document(raw, "sample.txt")
    assert res.source_type == "txt"
    assert res.text == "Line one\n\nLine two"
    assert res.word_count == 4


def test_extract_docx_reads_paragraphs_cleanly():
    docx_bytes = make_minimal_docx([
        "Master Services Agreement",
        "Payment terms are Net 30 days from invoice date.",
    ])
    res = extract_document(docx_bytes, "msa.docx")
    assert res.source_type == "docx"
    assert "Master Services Agreement" in res.text
    assert "Net 30 days" in res.text
    assert res.warnings == []


def test_extract_docx_rejects_corrupt_zip():
    with pytest.raises(ValueError, match="corrupted ZIP archive"):
        extract_document(b"not-a-zip", "broken.docx")


def test_extract_pdf_reads_selectable_text():
    pdf_bytes = make_minimal_pdf("Invoice #4092 overdue payment notice for cloud compute")
    res = extract_document(pdf_bytes, "invoice.pdf")
    assert res.source_type == "pdf"
    assert res.page_count == 1
    assert "Invoice #4092" in res.text
    assert res.warnings == []


def test_extract_csv_multiclass_and_multilabel():
    csv_data = (
        "body;category\n"
        "\"Duplicate charge on my credit card statement\";Billing\n"
        "\"Server returns 502 bad gateway on login\";Technical,Urgent\n"
        "\"   \";Ignored\n"
    ).encode("utf-8")

    single = extract_csv_dataset(csv_data, text_column="body", label_column="category", task_type="multiclass")
    assert single.row_count == 2
    assert single.records[0]["labels"] == ["Billing"]
    assert len(single.warnings) == 1

    multi = extract_csv_dataset(csv_data, text_column="body", label_column="category", task_type="multilabel")
    assert multi.records[1]["labels"] == ["Technical", "Urgent"]
