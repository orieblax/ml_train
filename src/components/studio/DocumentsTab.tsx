"use client";

import {
  Check,
  Eye,
  FileSpreadsheet,
  FileText,
  Loader2,
  Plus,
  Search,
  Tag,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import Papa from "papaparse";
import { useMemo, useRef, useState } from "react";
import { computeDatasetReadiness, formatBytes } from "@/lib/dataset-utils";
import type { DocumentRecord, ProjectRecord } from "@/lib/types";

interface DocumentsTabProps {
  project: ProjectRecord;
  documents: DocumentRecord[];
  onRefresh: () => Promise<void>;
}

interface PendingCsv {
  file: File;
  headers: string[];
  previewRows: Array<Record<string, string>>;
  textColumn: string;
  labelColumn: string;
}

interface UploadItemStatus {
  name: string;
  stage: "uploading" | "extracting" | "done" | "error";
  error?: string;
}

export function DocumentsTab({
  project,
  documents,
  onRefresh,
}: DocumentsTabProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [batchLabels, setBatchLabels] = useState<string[]>([]);
  const [newLabelInput, setNewLabelInput] = useState("");
  const [uploads, setUploads] = useState<UploadItemStatus[]>([]);
  const [pendingCsv, setPendingCsv] = useState<PendingCsv | null>(null);
  const [csvSubmitting, setCsvSubmitting] = useState(false);

  const [search, setSearch] = useState("");
  const [filterLabel, setFilterLabel] = useState<string>("ALL");
  const [editingDocId, setEditingDocId] = useState<string | null>(null);
  const [editingLabels, setEditingLabels] = useState<string[]>([]);
  const [customTagInput, setCustomTagInput] = useState("");

  const [inspectDoc, setInspectDoc] = useState<DocumentRecord | null>(null);
  const [inspectLoading, setInspectLoading] = useState(false);
  const [inspectContent, setInspectContent] = useState<{
    text?: string;
    rows?: Array<{ text: string; labels: string[] }>;
  } | null>(null);
  const [error, setError] = useState("");

  const readiness = useMemo(
    () => computeDatasetReadiness(documents, project.taskType),
    [documents, project.taskType]
  );

  const allLabels = useMemo(() => {
    const set = new Set<string>(project.labels || []);
    for (const c of readiness.classCounts) set.add(c.label);
    return Array.from(set).sort();
  }, [project.labels, readiness.classCounts]);

  const filteredDocs = useMemo(() => {
    return documents.filter((d) => {
      const q = search.trim().toLowerCase();
      const matchesQuery =
        !q ||
        d.fileName.toLowerCase().includes(q) ||
        (d.textPreview || "").toLowerCase().includes(q);
      const matchesLabel =
        filterLabel === "ALL" ||
        (filterLabel === "UNLABELED"
          ? d.sourceType !== "csv_dataset" && (d.labels || []).length === 0
          : (d.labels || []).includes(filterLabel));
      return matchesQuery && matchesLabel;
    });
  }, [documents, search, filterLabel]);

  function guessColumn(headers: string[], candidates: string[]): string {
    const lower = headers.map((h) => h.toLowerCase());
    for (const c of candidates) {
      const idx = lower.findIndex((h) => h === c || h.includes(c));
      if (idx >= 0) return headers[idx];
    }
    return headers[0] || "";
  }

  async function uploadSingleFileToS3AndExtract(
    file: File,
    opts: { labels?: string[]; textColumn?: string; labelColumn?: string }
  ) {
    const presignResp = await fetch(
      `/api/projects/${project.projectId}/upload-url`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: file.name,
          contentType: file.type || "application/octet-stream",
          sizeBytes: file.size,
        }),
      }
    );
    const presignData = await presignResp.json();
    if (!presignResp.ok) {
      throw new Error(presignData.error || "Failed to get upload URL");
    }

    const putResp = await fetch(presignData.uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": file.type || "application/octet-stream",
      },
      body: file,
    });
    if (!putResp.ok) {
      throw new Error(`Direct S3 upload failed (${putResp.status})`);
    }

    setUploads((prev) =>
      prev.map((u) =>
        u.name === file.name ? { ...u, stage: "extracting" } : u
      )
    );

    const ingestResp = await fetch(
      `/api/projects/${project.projectId}/documents/ingest`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          docId: presignData.docId,
          fileName: file.name,
          mimeType: file.type || "application/octet-stream",
          s3RawKey: presignData.s3RawKey,
          labels: opts.labels || [],
          textColumn: opts.textColumn,
          labelColumn: opts.labelColumn,
        }),
      }
    );
    const ingestData = await ingestResp.json();
    if (!ingestResp.ok) {
      throw new Error(ingestData.error || "Extraction failed");
    }
  }

  async function handleFilesSelected(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    setError("");

    const files = Array.from(fileList);
    const csvFiles = files.filter((f) => f.name.toLowerCase().endsWith(".csv"));
    const docFiles = files.filter((f) => !f.name.toLowerCase().endsWith(".csv"));

    if (csvFiles.length > 0) {
      const csvFile = csvFiles[0];
      Papa.parse<Record<string, string>>(csvFile, {
        header: true,
        preview: 10,
        skipEmptyLines: true,
        complete: (results) => {
          const headers = (results.meta.fields || []).filter(Boolean);
          if (headers.length === 0) {
            setError("CSV file has no detectable header row.");
            return;
          }
          setPendingCsv({
            file: csvFile,
            headers,
            previewRows: results.data || [],
            textColumn: guessColumn(headers, [
              "text",
              "body",
              "content",
              "document",
              "review",
              "message",
            ]),
            labelColumn: guessColumn(headers, [
              "label",
              "category",
              "class",
              "sentiment",
              "tag",
            ]),
          });
        },
        error: (err) => setError(`CSV parse error: ${err.message}`),
      });
    }

    if (docFiles.length > 0) {
      setUploads(
        docFiles.map((f) => ({ name: f.name, stage: "uploading" }))
      );

      for (const file of docFiles) {
        try {
          await uploadSingleFileToS3AndExtract(file, { labels: batchLabels });
          setUploads((prev) =>
            prev.map((u) => (u.name === file.name ? { ...u, stage: "done" } : u))
          );
        } catch (err) {
          setUploads((prev) =>
            prev.map((u) =>
              u.name === file.name
                ? {
                    ...u,
                    stage: "error",
                    error: err instanceof Error ? err.message : "Upload failed",
                  }
                : u
            )
          );
        }
      }
      await onRefresh();
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  async function handleConfirmCsvUpload() {
    if (!pendingCsv) return;
    setCsvSubmitting(true);
    setError("");
    const fileName = pendingCsv.file.name;
    setUploads([{ name: fileName, stage: "uploading" }]);
    try {
      await uploadSingleFileToS3AndExtract(pendingCsv.file, {
        textColumn: pendingCsv.textColumn,
        labelColumn: pendingCsv.labelColumn || undefined,
      });
      setUploads([{ name: fileName, stage: "done" }]);
      setPendingCsv(null);
      await onRefresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "CSV ingestion failed";
      setError(msg);
      setUploads([{ name: fileName, stage: "error", error: msg }]);
    } finally {
      setCsvSubmitting(false);
    }
  }

  function addBatchLabel() {
    const clean = newLabelInput.trim();
    if (!clean) return;
    if (project.taskType === "multilabel") {
      setBatchLabels((prev) => Array.from(new Set([...prev, clean])));
    } else {
      setBatchLabels([clean]);
    }
    setNewLabelInput("");
  }

  function toggleBatchLabel(lbl: string) {
    if (project.taskType === "multilabel") {
      setBatchLabels((prev) =>
        prev.includes(lbl) ? prev.filter((l) => l !== lbl) : [...prev, lbl]
      );
    } else {
      setBatchLabels((prev) => (prev[0] === lbl ? [] : [lbl]));
    }
  }

  async function saveDocLabels(docId: string) {
    const resp = await fetch(
      `/api/projects/${project.projectId}/documents/ingest`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docId, labels: editingLabels }),
      }
    );
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      setError(data.error || "Failed to update labels");
      return;
    }
    setEditingDocId(null);
    await onRefresh();
  }

  async function handleDeleteDoc(doc: DocumentRecord) {
    if (!window.confirm(`Remove "${doc.fileName}" from this dataset?`)) return;
    const resp = await fetch(
      `/api/projects/${project.projectId}/documents/ingest?docId=${doc.docId}`,
      { method: "DELETE" }
    );
    if (resp.ok) {
      await onRefresh();
    } else {
      const data = await resp.json().catch(() => ({}));
      setError(data.error || "Failed to delete document");
    }
  }

  async function openInspector(doc: DocumentRecord) {
    setInspectDoc(doc);
    setInspectLoading(true);
    setInspectContent(null);
    try {
      const resp = await fetch(
        `/api/projects/${project.projectId}/documents/${doc.docId}/text`
      );
      setInspectContent(await resp.json());
    } finally {
      setInspectLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Upload & Batch Labeling Section */}
      <section className="rounded-xl border border-zinc-200 bg-white p-6 shadow-xs space-y-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-zinc-950">
              Upload Training Documents
            </h2>
            <p className="text-xs text-zinc-600 mt-0.5">
              Supports <code className="font-mono">.pdf</code>,{" "}
              <code className="font-mono">.docx</code>,{" "}
              <code className="font-mono">.txt</code>, and labeled{" "}
              <code className="font-mono">.csv</code> datasets (uploaded directly
              to S3 up to 25 MB).
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-zinc-600 inline-flex items-center gap-1">
              <Tag className="h-3.5 w-3.5" />
              <span>Batch Label (PDF/DOCX/TXT):</span>
            </span>
            {allLabels.map((lbl) => {
              const active = batchLabels.includes(lbl);
              return (
                <button
                  key={lbl}
                  type="button"
                  onClick={() => toggleBatchLabel(lbl)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium border transition-colors cursor-pointer ${
                    active
                      ? "bg-[#0f766e] text-white border-[#0f766e]"
                      : "bg-zinc-50 text-zinc-700 border-zinc-200 hover:bg-zinc-100"
                  }`}
                >
                  {lbl}
                </button>
              );
            })}
            <div className="inline-flex items-center">
              <input
                type="text"
                value={newLabelInput}
                onChange={(e) => setNewLabelInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addBatchLabel();
                  }
                }}
                placeholder="New label..."
                className="w-28 rounded-l-md border border-zinc-300 px-2 py-1 text-xs focus:outline-none focus:border-[#0f766e]"
              />
              <button
                type="button"
                onClick={addBatchLabel}
                className="rounded-r-md border border-l-0 border-zinc-300 bg-zinc-50 px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-100 cursor-pointer"
                aria-label="Add batch label"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>

        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            handleFilesSelected(e.dataTransfer.files);
          }}
          onClick={() => fileInputRef.current?.click()}
          className="rounded-xl border-2 border-dashed border-zinc-300 hover:border-[#0f766e] bg-zinc-50/70 hover:bg-teal-50/30 transition-colors px-6 py-8 text-center cursor-pointer"
        >
          <input
            ref={fileInputRef}
            id="input-upload-documents"
            type="file"
            multiple
            accept=".pdf,.docx,.txt,.md,.csv"
            onChange={(e) => handleFilesSelected(e.target.files)}
            className="hidden"
          />
          <UploadCloud className="h-8 w-8 text-[#0f766e] mx-auto mb-2.5" />
          <p className="text-sm font-medium text-zinc-900">
            Drop PDF, DOCX, TXT, or CSV files here, or click to browse
          </p>
          <p className="text-xs text-zinc-500 mt-1">
            {batchLabels.length > 0
              ? `New individual documents will be tagged: ${batchLabels.join(", ")}`
              : "Tip: Pick a batch label above before dropping documents, or tag them individually below."}
          </p>
        </div>

        {uploads.length > 0 && (
          <div className="space-y-1.5">
            {uploads.map((u) => (
              <div
                key={u.name}
                className="flex items-center justify-between rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs"
              >
                <span className="font-mono text-zinc-800 truncate">{u.name}</span>
                <span
                  className={`font-medium shrink-0 ml-3 inline-flex items-center gap-1.5 ${
                    u.stage === "done"
                      ? "text-emerald-700"
                      : u.stage === "error"
                        ? "text-red-600"
                        : "text-[#0f766e]"
                  }`}
                >
                  {(u.stage === "uploading" || u.stage === "extracting") && (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  )}
                  {u.stage === "uploading"
                    ? "Uploading to S3..."
                    : u.stage === "extracting"
                      ? "Extracting text..."
                      : u.stage === "done"
                        ? "Ingested"
                        : u.error}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* CSV Column Mapper */}
        {pendingCsv && (
          <div className="rounded-xl border border-teal-200 bg-teal-50/50 p-5 space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-sm font-semibold text-zinc-950 flex items-center gap-2">
                  <FileSpreadsheet className="h-4 w-4 text-[#0f766e]" />
                  <span>Map CSV Columns: {pendingCsv.file.name}</span>
                </h3>
                <p className="text-xs text-zinc-600 mt-0.5">
                  Select which column holds the document text and which holds the
                  target label ({formatBytes(pendingCsv.file.size)}).
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPendingCsv(null)}
                className="text-zinc-500 hover:text-zinc-800 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="block text-xs font-medium text-zinc-700">
                  Text Column
                </label>
                <select
                  value={pendingCsv.textColumn}
                  onChange={(e) =>
                    setPendingCsv({ ...pendingCsv, textColumn: e.target.value })
                  }
                  className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm"
                >
                  {pendingCsv.headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-medium text-zinc-700">
                  Label Column
                </label>
                <select
                  value={pendingCsv.labelColumn}
                  onChange={(e) =>
                    setPendingCsv({ ...pendingCsv, labelColumn: e.target.value })
                  }
                  className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm"
                >
                  <option value="">(Unlabeled)</option>
                  {pendingCsv.headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {pendingCsv.previewRows.length > 0 && (
              <div className="rounded-lg border border-zinc-200 bg-white overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-zinc-50 border-b border-zinc-200 text-zinc-600">
                    <tr>
                      <th className="px-3 py-2">Text ({pendingCsv.textColumn})</th>
                      <th className="px-3 py-2">
                        Label ({pendingCsv.labelColumn || "none"})
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {pendingCsv.previewRows.slice(0, 4).map((row, i) => (
                      <tr key={i}>
                        <td className="px-3 py-2 max-w-md truncate text-zinc-800">
                          {row[pendingCsv.textColumn] || ""}
                        </td>
                        <td className="px-3 py-2 font-mono text-zinc-700">
                          {pendingCsv.labelColumn
                            ? row[pendingCsv.labelColumn] || "—"
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingCsv(null)}
                className="rounded-lg border border-zinc-300 bg-white px-3.5 py-2 text-xs font-medium text-zinc-700 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={csvSubmitting}
                onClick={handleConfirmCsvUpload}
                className="rounded-lg bg-[#0f766e] hover:bg-[#115e59] text-white px-4 py-2 text-xs font-medium disabled:opacity-60 cursor-pointer"
              >
                {csvSubmitting ? "Processing CSV..." : "Upload & Normalize CSV"}
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Class Distribution Summary */}
      <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-xs space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-zinc-950">
            Dataset Balance ({readiness.labeledSamples} labeled /{" "}
            {readiness.totalSamples} total samples)
          </h3>
          <span
            className={`text-xs font-medium px-2 py-0.5 rounded-md border ${
              readiness.ready
                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                : "bg-amber-50 text-amber-800 border-amber-200"
            }`}
          >
            {readiness.ready
              ? "Ready to Train"
              : `${readiness.distinctClasses} class(es) · needs ≥ 6 labeled & ≥ 2 classes`}
          </span>
        </div>

        {readiness.classCounts.length === 0 ? (
          <p className="text-xs text-zinc-500">
            No labeled samples yet. Upload a labeled CSV or assign labels to uploaded documents.
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {readiness.classCounts.map((item) => {
              const pct =
                readiness.labeledSamples > 0
                  ? Math.round((item.count / readiness.labeledSamples) * 100)
                  : 0;
              return (
                <div
                  key={item.label}
                  className="rounded-lg border border-zinc-200 bg-zinc-50/70 p-3 space-y-1.5"
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-zinc-900 truncate">
                      {item.label}
                    </span>
                    <span className="font-mono text-zinc-600">
                      {item.count} ({pct}%)
                    </span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-zinc-200 overflow-hidden">
                    <div
                      className="h-full bg-[#0f766e] rounded-full"
                      style={{ width: `${Math.max(4, pct)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Documents List */}
      <section className="rounded-xl border border-zinc-200 bg-white shadow-xs overflow-hidden">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-4 border-b border-zinc-200">
          <div className="relative flex-1 max-w-sm">
            <Search className="h-4 w-4 text-zinc-400 absolute left-3 top-2.5" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter documents or text preview..."
              className="w-full rounded-lg border border-zinc-300 pl-9 pr-3 py-1.5 text-sm focus:outline-none focus:border-[#0f766e]"
            />
          </div>

          <select
            value={filterLabel}
            onChange={(e) => setFilterLabel(e.target.value)}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700"
          >
            <option value="ALL">All Labels ({documents.length})</option>
            <option value="UNLABELED">Unlabeled Docs</option>
            {allLabels.map((lbl) => (
              <option key={lbl} value={lbl}>
                {lbl}
              </option>
            ))}
          </select>
        </div>

        {filteredDocs.length === 0 ? (
          <div className="p-10 text-center text-sm text-zinc-500">
            No matching documents in this project yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-zinc-50 border-b border-zinc-200 text-xs font-medium text-zinc-600">
                <tr>
                  <th className="px-4 py-3">Document</th>
                  <th className="px-4 py-3">Preview</th>
                  <th className="px-4 py-3">Stats</th>
                  <th className="px-4 py-3">Labels</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {filteredDocs.map((doc) => {
                  const isEditing = editingDocId === doc.docId;
                  return (
                    <tr key={doc.docId} className="hover:bg-zinc-50/70 align-top">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2 font-medium text-zinc-900">
                          {doc.sourceType === "csv_dataset" ? (
                            <FileSpreadsheet className="h-4 w-4 text-[#0f766e] shrink-0" />
                          ) : (
                            <FileText className="h-4 w-4 text-zinc-500 shrink-0" />
                          )}
                          <span className="max-w-[180px] truncate">
                            {doc.fileName}
                          </span>
                        </div>
                        <span className="font-mono text-[11px] uppercase text-zinc-500">
                          {doc.sourceType === "csv_dataset"
                            ? `CSV · ${doc.rowCount} rows`
                            : doc.sourceType}
                        </span>
                      </td>

                      <td className="px-4 py-3 max-w-md">
                        <p className="text-xs text-zinc-600 line-clamp-2">
                          {doc.textPreview || "(Empty text)"}
                        </p>
                        {doc.warnings && doc.warnings.length > 0 && (
                          <p className="text-[11px] text-amber-700 mt-1">
                            {doc.warnings[0]}
                          </p>
                        )}
                      </td>

                      <td className="px-4 py-3 font-mono text-xs text-zinc-600 whitespace-nowrap">
                        {doc.sourceType === "csv_dataset"
                          ? `${doc.labeledCount}/${doc.rowCount} rows`
                          : `${doc.wordCount} words`}
                      </td>

                      <td className="px-4 py-3">
                        {doc.sourceType === "csv_dataset" ? (
                          <div className="flex flex-wrap gap-1">
                            {Object.entries(doc.labelCounts || {}).map(
                              ([lbl, cnt]) => (
                                <span
                                  key={lbl}
                                  className="rounded border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[11px] font-mono text-zinc-700"
                                >
                                  {lbl}: {cnt}
                                </span>
                              )
                            )}
                          </div>
                        ) : isEditing ? (
                          <div className="space-y-2 min-w-[200px]">
                            <div className="flex flex-wrap gap-1">
                              {Array.from(
                                new Set([...allLabels, ...editingLabels])
                              ).map((lbl) => {
                                const active = editingLabels.includes(lbl);
                                return (
                                  <button
                                    key={lbl}
                                    type="button"
                                    onClick={() => {
                                      if (project.taskType === "multilabel") {
                                        setEditingLabels((prev) =>
                                          active
                                            ? prev.filter((x) => x !== lbl)
                                            : [...prev, lbl]
                                        );
                                      } else {
                                        setEditingLabels(active ? [] : [lbl]);
                                      }
                                    }}
                                    className={`px-2 py-0.5 rounded text-[11px] border cursor-pointer ${
                                      active
                                        ? "bg-[#0f766e] text-white border-[#0f766e]"
                                        : "bg-white text-zinc-700 border-zinc-200"
                                    }`}
                                  >
                                    {lbl}
                                  </button>
                                );
                              })}
                            </div>
                            <div className="flex items-center gap-1">
                              <input
                                type="text"
                                value={customTagInput}
                                onChange={(e) => setCustomTagInput(e.target.value)}
                                placeholder="Add label"
                                className="w-24 rounded border border-zinc-300 px-1.5 py-0.5 text-xs"
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  const clean = customTagInput.trim();
                                  if (!clean) return;
                                  setEditingLabels((prev) =>
                                    project.taskType === "multilabel"
                                      ? Array.from(new Set([...prev, clean]))
                                      : [clean]
                                  );
                                  setCustomTagInput("");
                                }}
                                className="rounded border border-zinc-300 px-1.5 py-0.5 text-xs bg-zinc-50 cursor-pointer"
                              >
                                +
                              </button>
                              <button
                                type="button"
                                onClick={() => saveDocLabels(doc.docId)}
                                className="rounded bg-[#0f766e] text-white px-2 py-0.5 text-xs inline-flex items-center gap-0.5 cursor-pointer"
                              >
                                <Check className="h-3 w-3" />
                                Save
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingDocId(doc.docId);
                              setEditingLabels(doc.labels || []);
                            }}
                            className="flex flex-wrap gap-1 text-left cursor-pointer group"
                            title="Click to edit labels"
                          >
                            {(doc.labels || []).length === 0 ? (
                              <span className="rounded border border-dashed border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-800 group-hover:bg-amber-100">
                                + Assign label
                              </span>
                            ) : (
                              doc.labels.map((lbl) => (
                                <span
                                  key={lbl}
                                  className="rounded border border-teal-200 bg-teal-50 px-2 py-0.5 text-[11px] font-medium text-[#0f766e]"
                                >
                                  {lbl}
                                </span>
                              ))
                            )}
                          </button>
                        )}
                      </td>

                      <td className="px-4 py-3 text-right whitespace-nowrap space-x-1.5">
                        <button
                          type="button"
                          onClick={() => openInspector(doc)}
                          className="inline-flex items-center gap-1 rounded border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-50 cursor-pointer"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          <span>Inspect</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteDoc(doc)}
                          className="inline-flex items-center rounded border border-zinc-200 bg-white p-1 text-zinc-500 hover:text-red-600 hover:border-red-200 cursor-pointer"
                          aria-label={`Delete ${doc.fileName}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Extracted Text Drawer */}
      {inspectDoc && (
        <div className="fixed inset-0 z-50 flex justify-end bg-zinc-950/35 backdrop-blur-[1px]">
          <div className="w-full max-w-2xl bg-white h-full shadow-2xl border-l border-zinc-200 flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200">
              <div>
                <h3 className="text-sm font-semibold text-zinc-950">
                  {inspectDoc.fileName}
                </h3>
                <p className="text-xs text-zinc-500 font-mono">
                  {inspectDoc.sourceType} · {inspectDoc.charCount} chars ·{" "}
                  {inspectDoc.wordCount} words
                </p>
              </div>
              <button
                type="button"
                onClick={() => setInspectDoc(null)}
                className="text-zinc-400 hover:text-zinc-800 cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              {inspectLoading ? (
                <div className="flex items-center gap-2 text-sm text-zinc-500">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Loading extracted content from S3...</span>
                </div>
              ) : inspectContent?.rows ? (
                <div className="space-y-2.5">
                  <p className="text-xs text-zinc-500">
                    Showing up to 100 normalized rows from S3 JSONL:
                  </p>
                  {inspectContent.rows.map((r, idx) => (
                    <div
                      key={idx}
                      className="rounded-lg border border-zinc-200 p-3 text-xs space-y-1.5"
                    >
                      <div className="flex flex-wrap gap-1">
                        {r.labels.map((l) => (
                          <span
                            key={l}
                            className="rounded bg-teal-50 border border-teal-200 px-1.5 py-0.5 font-medium text-[#0f766e]"
                          >
                            {l}
                          </span>
                        ))}
                      </div>
                      <p className="text-zinc-800 whitespace-pre-wrap">{r.text}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-zinc-800 bg-zinc-50 border border-zinc-200 rounded-lg p-4">
                  {inspectContent?.text || "(Empty extracted text)"}
                </pre>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
