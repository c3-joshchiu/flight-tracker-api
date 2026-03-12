#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
SPEC="$REPO_ROOT/openapi/flights-api.yaml"

echo "=== OpenAPI Spec Validation ==="

if [ ! -f "$SPEC" ]; then
  echo "ERROR: Spec not found at $SPEC"
  exit 1
fi

# Lint with Spectral (if installed)
if command -v spectral &> /dev/null; then
  echo "Running Spectral lint..."
  spectral lint "$SPEC" --ruleset spectral:oas
else
  echo "SKIP: spectral not installed (npm install -g @stoplight/spectral-cli)"
fi

# Breaking change detection with oasdiff (if installed)
if command -v oasdiff &> /dev/null; then
  if git rev-parse HEAD~1 &> /dev/null; then
    echo "Checking for breaking changes vs previous commit..."
    PREV_SPEC=$(git show HEAD~1:openapi/flights-api.yaml 2>/dev/null) || true
    if [ -n "$PREV_SPEC" ]; then
      echo "$PREV_SPEC" | oasdiff breaking --base /dev/stdin --revision "$SPEC" || {
        echo "WARNING: Breaking changes detected"
        exit 1
      }
      echo "No breaking changes found."
    else
      echo "SKIP: No previous version of spec to compare"
    fi
  fi
else
  echo "SKIP: oasdiff not installed (brew install oasdiff)"
fi

echo "=== Validation complete ==="
