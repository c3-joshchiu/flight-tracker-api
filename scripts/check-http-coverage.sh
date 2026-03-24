#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

SPEC="$REPO_ROOT/openapi/flights-api.yaml"
HTTP_DIR="$REPO_ROOT/http"

if [ ! -f "$SPEC" ]; then
  echo "ERROR: Spec not found at $SPEC" >&2
  exit 1
fi

# Extract operationIds from spec (yq preferred, grep fallback)
if command -v yq &>/dev/null; then
  spec_ops=$(yq '.paths[][].operationId' "$SPEC" | grep -v '^null$' | tr -d ' ' | sort)
else
  spec_ops=$(grep -E '^\s+operationId:\s+' "$SPEC" | sed 's/.*operationId:\s*//' | tr -d ' ' | sort)
fi

# Extract operationIds referenced in .http files
http_ops=$(grep -rh '# operationId:' "$HTTP_DIR"/*.http | sed 's/.*operationId: *//' | tr -d ' ' | sort -u)

# Diff
missing=$(comm -23 <(echo "$spec_ops") <(echo "$http_ops"))

spec_count=$(echo "$spec_ops" | wc -l | tr -d ' ')
http_count=$(echo "$http_ops" | wc -l | tr -d ' ')

if [ -n "$missing" ]; then
  echo "Operations in spec but not in .http files:"
  echo "$missing"
  echo ""
  echo "Coverage: $http_count/$spec_count operations covered."
  exit 1
fi

echo "All operations covered. ($spec_count/$spec_count)"
