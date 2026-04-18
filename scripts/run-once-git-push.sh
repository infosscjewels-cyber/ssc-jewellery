#!/usr/bin/env bash

set -euo pipefail

REPO_DIR="${1:-}"
CRON_TAG="${2:-}"
BRANCH_NAME="${3:-main}"
REMOTE_NAME="${4:-origin}"

if [[ -z "${REPO_DIR}" || -z "${CRON_TAG}" ]]; then
  echo "Usage: $0 <repo_dir> <cron_tag> [branch_name] [remote_name]" >&2
  exit 1
fi

cd "${REPO_DIR}"

echo "[$(date '+%Y-%m-%d %H:%M:%S %Z')] Starting one-time git push for ${REMOTE_NAME}/${BRANCH_NAME}"
git push "${REMOTE_NAME}" "${BRANCH_NAME}"
echo "[$(date '+%Y-%m-%d %H:%M:%S %Z')] Git push completed"

if command -v crontab >/dev/null 2>&1; then
  tmp_file="$(mktemp)"
  crontab -l 2>/dev/null | grep -F -v "${CRON_TAG}" > "${tmp_file}" || true
  crontab "${tmp_file}"
  rm -f "${tmp_file}"
  echo "[$(date '+%Y-%m-%d %H:%M:%S %Z')] Removed one-time cron entry ${CRON_TAG}"
fi
