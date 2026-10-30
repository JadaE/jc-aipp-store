#!/usr/bin/env bash
# Publish JC AiPP Store Lite (dist/) to here.now.
# Only run after the release reviewer has approved the build.
#   HERENOW_API_KEY=... bash publish.sh      (or put it in config.local.json, which is gitignored)
# Reads: HERENOW_API_KEY (env) or config.local.json .herenow.apiKey; slug from HERENOW_SLUG or .herenow.slug.
set -euo pipefail
DIR=$(cd "$(dirname "$0")" && pwd)
CFG="$DIR/config.local.json"
cfg() { [ -f "$CFG" ] && jq -r "$1 // empty" "$CFG" 2>/dev/null || true; }

if [ -z "${HERENOW_API_KEY:-}" ]; then
  HERENOW_API_KEY=$(cfg '.herenow.apiKey')
  case "$HERENOW_API_KEY" in YOUR_*|"") HERENOW_API_KEY="";; esac
fi
[ -n "$HERENOW_API_KEY" ] || { echo "No HERENOW_API_KEY in the environment or config.local.json; not publishing." >&2; exit 1; }
export HERENOW_API_KEY   # here.now's script reads it from the environment; it is never printed

SLUG="${HERENOW_SLUG:-$(cfg '.herenow.slug')}"
case "$SLUG" in your-*|"") echo "No site slug set (HERENOW_SLUG or config.local.json .herenow.slug); not publishing." >&2; exit 1;; esac

PUB="${HERENOW_PUBLISH_SH:-$(cfg '.herenow.publishScript')}"
[ -n "$PUB" ] && [ -f "$PUB" ] || PUB=$(ls -d /home/box/sand-data/plugins/cache/cursor-public/here_now/*/skills/here-now/scripts/publish.sh 2>/dev/null | head -1 || true)
[ -n "$PUB" ] && [ -f "$PUB" ] || { echo "here.now publish.sh not found (set .herenow.publishScript or HERENOW_PUBLISH_SH)." >&2; exit 1; }

# here.now's script needs a `file` binary; provide a tiny shim if missing
if ! command -v file >/dev/null 2>&1; then
  SHIM=$(mktemp -d); printf '%s\n' '#!/usr/bin/env python3' 'import sys,mimetypes' 'print(mimetypes.guess_type(sys.argv[-1])[0] or "application/octet-stream")' > "$SHIM/file"
  chmod +x "$SHIM/file"; export PATH="$SHIM:$PATH"
fi

# Never publish an untested build
(cd "$DIR" && node build.mjs && node test.mjs)

BUILD=$(mktemp -d /tmp/aipp-store-build.XXXX)
trap 'rm -rf "$BUILD"' EXIT
cp -a "$DIR/dist/." "$BUILD/"
OUT=$(bash "$PUB" "$BUILD" --slug "$SLUG" --client grok-bot/aipp-store 2>&1) || true
echo "$OUT" | grep -E '^https://|publish_result.(site_url|persistence)|error' || true
if echo "$OUT" | grep -qi '^error'; then echo "PUBLISH FAILED" >&2; exit 1; fi
echo "Published."
