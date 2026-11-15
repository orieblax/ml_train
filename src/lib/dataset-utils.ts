import type { DocumentRecord, TaskType } from "@/lib/types";

export interface DatasetReadiness {
  totalSamples: number;
  labeledSamples: number;
  unlabeledSamples: number;
  classCounts: Array<{ label: string; count: number }>;
  distinctClasses: number;
  ready: boolean;
  blockers: string[];
  warnings: string[];
}

export function computeDatasetReadiness(
  documents: DocumentRecord[],
  taskType: TaskType
): DatasetReadiness {
  const counts = new Map<string, number>();
  let totalSamples = 0;
  let labeledSamples = 0;

  for (const doc of documents) {
    if (doc.status !== "EXTRACTED") continue;

    if (doc.sourceType === "csv_dataset") {
      const rows = doc.rowCount || 0;
      const labeled = doc.labeledCount || 0;
      totalSamples += rows;
      labeledSamples += labeled;
      for (const [label, count] of Object.entries(doc.labelCounts || {})) {
        counts.set(label, (counts.get(label) || 0) + count);
      }
    } else {
      totalSamples += 1;
      const docLabels = (doc.labels || []).filter((l) => l.trim().length > 0);
      if (docLabels.length > 0) {
        labeledSamples += 1;
        for (const label of docLabels) {
          counts.set(label, (counts.get(label) || 0) + 1);
        }
      }
    }
  }

  const classCounts = Array.from(counts.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  const blockers: string[] = [];
  const warnings: string[] = [];

  if (labeledSamples < 6) {
    blockers.push(
      `Need at least 6 labeled samples to train and split a test set (currently ${labeledSamples}).`
    );
  }
  if (classCounts.length < 2) {
    blockers.push(
      `Need at least 2 distinct ${taskType === "multilabel" ? "tags" : "classes"} with labeled samples (currently ${classCounts.length}).`
    );
  }

  const sparseClasses = classCounts.filter((c) => c.count < 3);
  if (sparseClasses.length > 0) {
    warnings.push(
      `Sparse classes (< 3 samples): ${sparseClasses.map((c) => `${c.label} (${c.count})`).join(", ")}. Adding more examples improves F1 stability.`
    );
  }

  if (labeledSamples < totalSamples) {
    warnings.push(
      `${totalSamples - labeledSamples} document(s)/row(s) are unlabeled and will be excluded from training.`
    );
  }

  return {
    totalSamples,
    labeledSamples,
    unlabeledSamples: Math.max(0, totalSamples - labeledSamples),
    classCounts,
    distinctClasses: classCounts.length,
    ready: blockers.length === 0,
    blockers,
    warnings,
  };
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const idx = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const val = bytes / Math.pow(1024, idx);
  return `${val.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
}

export function formatPct(val: number | string | undefined): string {
  const num = typeof val === "string" ? Number(val) : val;
  if (num === undefined || !Number.isFinite(num)) return "—";
  return `${(num * 100).toFixed(1)}%`;
}
