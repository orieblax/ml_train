#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
REQ_FILE="${ROOT_DIR}/infra/requirements-layer.txt"
BUILD_DIR="${ROOT_DIR}/infra/.build"
DIST_DIR="${ROOT_DIR}/infra/dist"
LAYER_SITE_PKGS="${BUILD_DIR}/layer/python/lib/python3.12/site-packages"
TRAINER_BUILD="${BUILD_DIR}/trainer"

MAX_UNZIPPED_BYTES=245000000 # 245 MB safety ceiling under AWS Lambda's 250 MB (262,144,000 B) limit
CHECK_ONLY="${1:-}"

rm -rf "${BUILD_DIR}"
mkdir -p "${LAYER_SITE_PKGS}" "${TRAINER_BUILD}" "${DIST_DIR}"

echo "==> Installing Python 3.12 manylinux2014_x86_64 wheels into Lambda Layer..."
python3 -m pip install \
  --no-cache-dir \
  --platform manylinux2014_x86_64 \
  --implementation cp \
  --python-version 3.12 \
  --only-binary=:all: \
  --upgrade \
  -r "${REQ_FILE}" \
  -t "${LAYER_SITE_PKGS}"

echo "==> Stripping tests, caches, headers, and static archives to fit Lambda 250 MB limit..."
find "${LAYER_SITE_PKGS}" -type d \( -name "__pycache__" -o -name "tests" -o -name "test" -o -name "benchmarks" \) -prune -exec rm -rf {} +
find "${LAYER_SITE_PKGS}" -type f \( -name "*.pyc" -o -name "*.pyo" -o -name "*.pyi" -o -name "*.a" -o -name "*.h" -o -name "*.c" \) -delete

UNZIPPED_BYTES="$(du -sb "${BUILD_DIR}/layer" | awk '{print $1}')"
UNZIPPED_MB="$(awk "BEGIN {printf \"%.2f\", ${UNZIPPED_BYTES}/1024/1024}")"
echo "==> Unzipped Layer size: ${UNZIPPED_MB} MB (${UNZIPPED_BYTES} bytes)"

if [ "${UNZIPPED_BYTES}" -gt "${MAX_UNZIPPED_BYTES}" ]; then
  echo "ERROR: Unzipped layer (${UNZIPPED_BYTES} B) exceeds safety limit (${MAX_UNZIPPED_BYTES} B)." >&2
  exit 1
fi

if [ "${CHECK_ONLY}" = "--check-only" ]; then
  echo "==> --check-only passed successfully."
  exit 0
fi

echo "==> Packaging dist/ml-runtime-layer.zip..."
(cd "${BUILD_DIR}/layer" && zip -qr "${DIST_DIR}/ml-runtime-layer.zip" python)

echo "==> Packaging dist/trainer-lambda.zip..."
cp -r "${ROOT_DIR}/lambdas/trainer" "${TRAINER_BUILD}/trainer"
cp -r "${ROOT_DIR}/lambdas/shared" "${TRAINER_BUILD}/shared"
find "${TRAINER_BUILD}" -type d -name "__pycache__" -prune -exec rm -rf {} +
(cd "${TRAINER_BUILD}" && zip -qr "${DIST_DIR}/trainer-lambda.zip" trainer shared)

echo "==> Artifacts built:"
ls -lh "${DIST_DIR}/ml-runtime-layer.zip" "${DIST_DIR}/trainer-lambda.zip"
