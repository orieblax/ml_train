#!/usr/bin/env node
/**
 * Cross-platform Python 3 launcher for npm scripts (works on Windows, macOS, Linux).
 */
import { spawnSync } from "node:child_process";

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

function findPython() {
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

const py = findPython();
if (!py) {
  console.error(
    "ERROR: Python 3 interpreter not found on PATH. Install Python 3.11+ and retry."
  );
  process.exit(1);
}

const args = process.argv.slice(2);
const result = spawnSync(py.cmd, [...py.prefix, ...args], {
  stdio: "inherit",
});
if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
