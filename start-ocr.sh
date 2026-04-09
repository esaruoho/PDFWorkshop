#!/usr/bin/env bash
# start-ocr.sh — Bootstrap the OCR worker daemon with caffeinate.
#
# Designed for CloudcityMacMini — prevents sleep, auto-restarts on crash,
# and ensures GLM-OCR backend is available.
#
# Usage:
#   ./start-ocr.sh              # Normal start
#   ./start-ocr.sh --once       # Process queue and exit
#
# Add to Cloudcity-Boot.app or run in a dedicated iTerm pane.

set -euo pipefail

cd "$(dirname "$0")"

# Set up Homebrew environment (macOS Apple Silicon)
if [[ -x /opt/homebrew/bin/brew ]]; then
  eval "$(/opt/homebrew/bin/brew shellenv)"
fi

# Source .env if present (API keys, custom config)
if [[ -f .env ]]; then
  set -a; source .env; set +a
fi

echo "╔═══════════════════════════════════════════════╗"
echo "║  PDFWorkshop — OCR Worker Daemon              ║"
echo "╚═══════════════════════════════════════════════╝"
echo ""
echo "Repo:    $(pwd)"
echo "Started: $(date)"
echo "Host:    $(hostname -s)"
echo ""

# Ensure queue directories exist
mkdir -p queue/{pending,processing,done,failed,uploads}

# Ensure Syncthing results directory exists
mkdir -p "${HOME}/work/comms/queue/ocr-results"

# Ensure npm deps are installed
if [[ ! -d node_modules ]]; then
  echo "Installing dependencies..."
  npm install --production 2>&1 | tail -5
  echo ""
fi

# Check for GLM-OCR backend
check_backend() {
  if curl -sf --max-time 3 "http://localhost:8080/v1/models" >/dev/null 2>&1; then
    echo "MLX (:8080)"
    return 0
  fi

  if curl -sf --max-time 3 "http://localhost:11434/api/tags" 2>/dev/null | grep -q "glm-ocr"; then
    echo "Ollama (:11434)"
    return 0
  fi

  echo "NONE"
  return 1
}

backend="$(check_backend || true)"
echo "OCR Backend: ${backend}"

if [[ "$backend" == "NONE" ]]; then
  echo ""
  echo "WARNING: No GLM-OCR backend detected."
  echo "  MLX:    mlx_lm.server --model mlx-community/GLM-OCR-bf16 --port 8080"
  echo "  Ollama: ollama pull glm-ocr:latest && ollama serve"
  echo ""
  echo "Worker will start but jobs will fail until a backend is available."
fi

echo ""

# --- Crash-resilient restart loop with caffeinate ---
MAX_BACKOFF=60
BACKOFF=5

while true; do
  echo "[$(date +%H:%M:%S)] Starting ocr-worker (caffeinate -s)..."

  # caffeinate -s: prevent system sleep while process runs
  # caffeinate -w: release when child exits
  if caffeinate -s -w $$ -- ./ocr-worker "$@"; then
    echo "[$(date +%H:%M:%S)] Worker exited cleanly."
    break
  fi

  EXIT_CODE=$?

  # Exit code 75 = user-requested restart (from signal)
  if [[ $EXIT_CODE -eq 75 ]]; then
    echo "[$(date +%H:%M:%S)] Restart requested."
    BACKOFF=5
    continue
  fi

  echo "[$(date +%H:%M:%S)] Worker crashed (exit ${EXIT_CODE}). Restarting in ${BACKOFF}s..."
  sleep "$BACKOFF"

  # Exponential backoff
  BACKOFF=$((BACKOFF * 2))
  if [[ $BACKOFF -gt $MAX_BACKOFF ]]; then
    BACKOFF=$MAX_BACKOFF
  fi
done
