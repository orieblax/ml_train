#!/usr/bin/env python3
"""Cross-platform packager for the Python 3.12 AWS Lambda ML Layer and Trainer zip."""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent.parent
REQ_FILE = ROOT_DIR / "infra" / "requirements-layer.txt"
BUILD_DIR = ROOT_DIR / "infra" / ".build"
DIST_DIR = ROOT_DIR / "infra" / "dist"
LAYER_ROOT = BUILD_DIR / "layer"
LAYER_SITE_PKGS = LAYER_ROOT / "python" / "lib" / "python3.12" / "site-packages"
TRAINER_BUILD = BUILD_DIR / "trainer"

MAX_UNZIPPED_BYTES = 245_000_000  # 245 MB ceiling under AWS Lambda's 250 MB limit
STRIP_DIRS = {"__pycache__", "tests", "test", "benchmarks"}
STRIP_EXTS = {".pyc", ".pyo", ".pyi", ".a", ".h", ".c"}


def zip_directory(source_dir: Path, zip_path: Path) -> None:
    """Create a deterministic ZIP with POSIX 0644/0755 permissions (safe across Windows/macOS/Linux)."""
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        for file_path in sorted(source_dir.rglob("*")):
            if file_path.is_dir():
                continue
            rel_posix = file_path.relative_to(source_dir).as_posix()
            info = zipfile.ZipInfo(rel_posix)
            info.compress_type = zipfile.ZIP_DEFLATED
            # Ensure world-readable permissions on AWS Lambda Linux even when built on Windows
            mode = 0o755 if file_path.suffix == ".so" or ".so." in file_path.name else 0o644
            info.external_attr = (0o100000 | mode) << 16
            zf.writestr(info, file_path.read_bytes())


def main() -> None:
    parser = argparse.ArgumentParser(description="Build Lambda Layer and Trainer zips")
    parser.add_argument(
        "--check-only",
        action="store_true",
        help="Verify unzipped layer size without creating zip archives",
    )
    args = parser.parse_args()

    if BUILD_DIR.exists():
        shutil.rmtree(BUILD_DIR)
    LAYER_SITE_PKGS.mkdir(parents=True, exist_ok=True)
    TRAINER_BUILD.mkdir(parents=True, exist_ok=True)
    DIST_DIR.mkdir(parents=True, exist_ok=True)

    print("==> Installing Python 3.12 manylinux2014_x86_64 wheels into Lambda Layer...")
    subprocess.run(
        [
            sys.executable,
            "-m",
            "pip",
            "install",
            "--no-cache-dir",
            "--platform",
            "manylinux2014_x86_64",
            "--implementation",
            "cp",
            "--python-version",
            "3.12",
            "--only-binary=:all:",
            "--upgrade",
            "-r",
            str(REQ_FILE),
            "-t",
            str(LAYER_SITE_PKGS),
        ],
        check=True,
    )

    print("==> Stripping tests, caches, headers, and static archives...")
    for root, dirs, files in os.walk(LAYER_SITE_PKGS, topdown=True):
        for d in list(dirs):
            if d in STRIP_DIRS:
                shutil.rmtree(Path(root) / d)
                dirs.remove(d)
        for f in files:
            fp = Path(root) / f
            if fp.suffix in STRIP_EXTS:
                fp.unlink()

    unzipped_bytes = sum(
        p.stat().st_size for p in LAYER_ROOT.rglob("*") if p.is_file()
    )
    unzipped_mb = unzipped_bytes / (1024 * 1024)
    print(f"==> Unzipped Layer size: {unzipped_mb:.2f} MB ({unzipped_bytes} bytes)")

    if unzipped_bytes > MAX_UNZIPPED_BYTES:
        raise SystemExit(
            f"ERROR: Unzipped layer ({unzipped_bytes} B) exceeds safety limit ({MAX_UNZIPPED_BYTES} B)."
        )

    if args.check_only:
        print("==> --check-only passed successfully.")
        return

    layer_zip = DIST_DIR / "ml-runtime-layer.zip"
    trainer_zip = DIST_DIR / "trainer-lambda.zip"

    print(f"==> Packaging {layer_zip.relative_to(ROOT_DIR)}...")
    zip_directory(LAYER_ROOT, layer_zip)

    print(f"==> Packaging {trainer_zip.relative_to(ROOT_DIR)}...")
    shutil.copytree(ROOT_DIR / "lambdas" / "trainer", TRAINER_BUILD / "trainer")
    shutil.copytree(ROOT_DIR / "lambdas" / "shared", TRAINER_BUILD / "shared")
    for cache_dir in TRAINER_BUILD.rglob("__pycache__"):
        shutil.rmtree(cache_dir)
    zip_directory(TRAINER_BUILD, trainer_zip)

    print(
        f"==> Artifacts built:\n"
        f"    {layer_zip.name}: {layer_zip.stat().st_size / (1024 * 1024):.2f} MB\n"
        f"    {trainer_zip.name}: {trainer_zip.stat().st_size / 1024:.1f} KB"
    )


if __name__ == "__main__":
    main()
