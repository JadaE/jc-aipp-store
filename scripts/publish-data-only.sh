#!/usr/bin/env bash
# Publish a data-only JC AiPP Store listing update directly to here.now.
#
# Allowed paths (exact match only): data/apps.json, data/site.json, CHANGELOG.md.
# No code, templates, scripts, workflows, package files, dependencies, symlinks,
# or path traversal. If anything else changed, exit non-zero and route the change
# to Review & Release. This script does not call, copy, or bypass the release gate;
# the gated path remains publish.sh for reviewed releases.
#
# Usage:
#   bash scripts/publish-data-only.sh --dry-run
#   bash scripts/publish-data-only.sh --dry-run --base origin/master
#   bash scripts/publish-data-only.sh
#
# --dry-run  Run allowlist, leak, build, and test checks; do not publish or push.
# --base     Git ref to diff against (default: origin/master).
set -euo pipefail

usage() {
  sed -n '2,16p' "$0" | tr -d '#'
}

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
DRY=0
BASE="${PUBLISH_DATA_ONLY_BASE:-origin/master}"
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run|-n) DRY=1; shift ;;
    --base)
      if [ -z "${2:-}" ] || [[ "${2:-}" == -* ]]; then
        echo "usage: --base <ref>" >&2
        exit 2
      fi
      BASE="$2"
      shift 2
      ;;
    --help|-h) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || {
  echo "ERROR: run this script from inside a git checkout of the store repo." >&2
  exit 2
}
ROOT=$(cd "$ROOT" && pwd)
cd "$ROOT"

die() { echo "ERROR: $*" >&2; exit 1; }
route() {
  echo "ERROR: $*" >&2
  echo "This is not a data-only change. Route it to Review & Release (do not publish with this script)." >&2
  exit 1
}

# --- untracked files (ignored paths such as dist/, config.local.json, node_modules/ are excluded) ---
UNTRACKED=$(git ls-files --others --exclude-standard)
if [ -n "$UNTRACKED" ]; then
  echo "ERROR: untracked files are present (commit, ignore, or remove them first):" >&2
  printf '%s\n' "$UNTRACKED" | sed 's/^/  /' >&2
  exit 1
fi

# --- resolve base ref ---
if ! BASE_SHA=$(git rev-parse --verify "${BASE}^{commit}" 2>/dev/null); then
  die "base ref '$BASE' was not found. Fetch it or pass --base <ref>."
fi
HEAD_SHA=$(git rev-parse HEAD)

# Combined diff vs base: committed (base..HEAD) plus staged and unstaged changes.
# Paths must be exact allowlist matches: no ./ prefix, no .., no symlinks, no extras.
mapfile -t CHANGED < <({
  git diff --name-only --no-renames "$BASE_SHA"
  git diff --name-only --no-renames --cached "$BASE_SHA"
} | sed '/^$/d' | sort -u)

if [ "${#CHANGED[@]}" -eq 0 ]; then
  die "no allowed files changed vs $BASE. Nothing to publish."
fi

is_allowed() {
  case "$1" in
    data/apps.json|data/site.json|CHANGELOG.md) return 0 ;;
    *) return 1 ;;
  esac
}

DISALLOWED=()
for p in "${CHANGED[@]}"; do
  case "$p" in
    *..*|/*|./*|*/./*|*)
      if ! is_allowed "$p"; then DISALLOWED+=("$p"); fi
      ;;
  esac
  # Reject odd path forms even if they might canonicalize to an allowed file.
  case "$p" in
    *..*|/*|./*|*\\*) DISALLOWED+=("$p") ;;
  esac
done

# Dedup disallowed (a path may have been added twice)
if [ "${#DISALLOWED[@]}" -gt 0 ]; then
  mapfile -t DISALLOWED < <(printf '%s\n' "${DISALLOWED[@]}" | sort -u)
fi

if [ "${#DISALLOWED[@]}" -gt 0 ] && [ -n "${DISALLOWED[0]:-}" ]; then
  echo "ERROR: diff vs $BASE touches file(s) outside the data-only allowlist:" >&2
  printf '%s\n' "${DISALLOWED[@]}" | sed 's/^/  /' >&2
  echo "Allowed paths: data/apps.json, data/site.json, CHANGELOG.md." >&2
  echo "This is not a data-only change. Route it to Review & Release (do not publish with this script)." >&2
  exit 1
fi

# Symlink / non-regular-file checks: changed paths, git symlink mode, and the allowlist paths themselves.
is_symlink_mode() {
  local mode
  mode=$(git ls-files -s -- "$1" 2>/dev/null | awk '{print $1}')
  [ "$mode" = "120000" ]
}

for p in "${CHANGED[@]}" data/apps.json data/site.json CHANGELOG.md; do
  [ -e "$p" ] || [ -L "$p" ] || continue
  if [ -L "$p" ]; then
    route "symlink is not allowed: $p"
  fi
  if [ -e "$p" ] && [ ! -f "$p" ]; then
    route "not a regular file: $p"
  fi
  if is_symlink_mode "$p"; then
    route "symlink is not allowed (git mode 120000): $p"
  fi
done

# Also catch a symlink recorded in the diff vs base even if the worktree looks clean.
# git diff --raw: :src-mode dst-mode src-sha dst-sha status\tpath
while read -r src_field dst_mode _src_sha _dst_sha _status path; do
  [ -n "${src_field:-}" ] || continue
  src_mode=${src_field#:}
  if [ "$src_mode" = "120000" ] || [ "$dst_mode" = "120000" ]; then
    route "symlink is not allowed in the diff: ${path:-unknown}"
  fi
done < <({
  git diff --raw --no-renames "$BASE_SHA"
  git diff --raw --no-renames --cached "$BASE_SHA"
})

echo "Allowlist OK: ${CHANGED[*]} (vs $BASE)"

# --- JSON + leak rules on public data ---
HELPER="$SCRIPT_DIR/check-data-leaks.mjs"
[ -f "$HELPER" ] || die "missing $HELPER (data leak helper)."
node "$HELPER" "$ROOT"

# --- build ---
npm run build

# cfg() reads gitignored local config; never prints values.
CFG="$ROOT/config.local.json"
cfg() { [ -f "$CFG" ] && jq -r "$1 // empty" "$CFG" 2>/dev/null || true; }

# --- gitleaks (fail closed if missing). Path comes from PATH, GITLEAKS, or config.local.json; never hard-coded. ---
find_gitleaks() {
  if [ -n "${GITLEAKS:-}" ] && [ -x "$GITLEAKS" ]; then printf '%s\n' "$GITLEAKS"; return 0; fi
  if command -v gitleaks >/dev/null 2>&1; then command -v gitleaks; return 0; fi
  local from_cfg
  from_cfg=$(cfg '.release.gitleaks')
  if [ -n "$from_cfg" ] && [ -x "$from_cfg" ]; then printf '%s\n' "$from_cfg"; return 0; fi
  return 1
}
# cfg() is defined later for publish; define a local-config reader here too so leak tools can use it.
CFG="$ROOT/config.local.json"
cfg() { [ -f "$CFG" ] && jq -r "$1 // empty" "$CFG" 2>/dev/null || true; }

GL=$(find_gitleaks) || die "gitleaks is not installed. Put it on PATH, set GITLEAKS, or set release.gitleaks in config.local.json. Refusing to publish."
echo "gitleaks: ok"
# Scan current listing files (covers unstaged edits). Then scan new commits and staged diffs.
"$GL" dir data CHANGELOG.md --redact --no-banner --no-color
if [ "$(git rev-list --count "${BASE_SHA}..HEAD")" != "0" ]; then
  "$GL" git . --log-opts="${BASE_SHA}..HEAD" --redact --no-banner --no-color
fi
if ! git diff --cached --quiet --no-ext-diff; then
  "$GL" git . --staged --redact --no-banner --no-color
fi

# --- standard leak-check (LEAK_CHECK_SH or config.local.json .release.leakCheckScript; fail closed) ---
LEAK_SH="${LEAK_CHECK_SH:-}"
if [ -z "$LEAK_SH" ]; then
  LEAK_SH=$(cfg '.release.leakCheckScript')
fi
if [ -z "$LEAK_SH" ] || [ ! -f "$LEAK_SH" ]; then
  die "standard leak-check tool not found. Set LEAK_CHECK_SH or config.local.json .release.leakCheckScript. Refusing to publish."
fi
echo "leak-check: ok"
if [ "$(git rev-list --count "${BASE_SHA}..HEAD")" != "0" ]; then
  bash "$LEAK_SH" --range "${BASE_SHA}..HEAD"
fi
bash "$LEAK_SH" --tree

# --- full site tests (includes the repo secret scan in test.mjs) ---
npm test

if [ "$DRY" = 1 ]; then
  echo "Dry run: all checks passed; nothing was published or pushed."
  exit 0
fi

# --- real publish: require a clean worktree (all data-only changes already committed) ---
if ! git diff --quiet --no-ext-diff || ! git diff --cached --quiet --no-ext-diff; then
  die "working tree is not clean. Commit the data-only changes on this branch before publishing (or use --dry-run)."
fi

# Key and slug: env first, then config.local.json. Never echo or log secrets.
if [ -z "${HERENOW_API_KEY:-}" ]; then
  HERENOW_API_KEY=$(cfg '.herenow.apiKey')
  case "$HERENOW_API_KEY" in YOUR_*|"") HERENOW_API_KEY="";; esac
fi
[ -n "${HERENOW_API_KEY:-}" ] || die "No HERENOW_API_KEY in the environment or config.local.json; not publishing."
export HERENOW_API_KEY

SLUG="${HERENOW_SLUG:-$(cfg '.herenow.slug')}"
case "$SLUG" in your-*|"") die "No site slug set (HERENOW_SLUG or config.local.json .herenow.slug); not publishing." ;; esac
if ! [[ "$SLUG" =~ ^[a-z0-9][a-z0-9-]+[a-z0-9]$ ]]; then
  die "Site slug is not a valid here.now slug; not publishing."
fi

PUB="${HERENOW_PUBLISH_SH:-$(cfg '.herenow.publishScript')}"
[ -n "$PUB" ] && [ -f "$PUB" ] || die "here.now publish.sh not found: set HERENOW_PUBLISH_SH or config.local.json .herenow.publishScript."

if ! command -v file >/dev/null 2>&1; then
  SHIM=$(mktemp -d)
  printf '%s\n' '#!/usr/bin/env python3' 'import sys,mimetypes' 'print(mimetypes.guess_type(sys.argv[-1])[0] or "application/octet-stream")' > "$SHIM/file"
  chmod +x "$SHIM/file"
  export PATH="$SHIM:$PATH"
fi

[ -d "$ROOT/dist" ] || die "dist/ is missing after build; not publishing."

BUILD=$(mktemp -d /tmp/aipp-store-data-only.XXXX)
trap 'rm -rf "$BUILD"' EXIT
cp -a "$ROOT/dist/." "$BUILD/"

# Redact the API key from any publish-script output before printing.
redact() {
  python3 -c 'import os,sys
k=os.environ.get("HERENOW_API_KEY") or ""
t=sys.stdin.read()
print(t.replace(k, "[redacted]") if k else t, end="")'
}

echo "Publishing dist/ to here.now (slug set; API key not logged)..."
set +e
OUT=$(bash "$PUB" "$BUILD" --slug "$SLUG" --client grok-bot/aipp-store-data-only 2>&1)
RC=$?
set -e
SAFE=$(printf '%s' "$OUT" | redact)
# Show only result lines, never a raw dump that might include credentials.
printf '%s\n' "$SAFE" | grep -E '^https://|publish_result.(site_url|persistence)|error' || true
if [ "$RC" -ne 0 ] || printf '%s' "$SAFE" | grep -qi '^error'; then
  echo "PUBLISH FAILED" >&2
  exit 1
fi
echo "Published."

# --- verify live listing ---
HN_HOST=$(printf "%s.%s" here now)
LIVE="https://${SLUG}.${HN_HOST}"
verify_url() {
  local url="$1" expect="${2:-}" attempt=1 max=5 body code
  body=$(mktemp)
  while [ "$attempt" -le "$max" ]; do
    code=$(curl -sS -L --max-redirs 3 --max-time 30 \
      -H "Cache-Control: no-cache" -A "aipp-store-data-only-verify" \
      -o "$body" -w "%{http_code}" "$url" || true)
    if [ "$code" = "200" ]; then
      if [ -z "$expect" ] || grep -F -q -- "$expect" "$body"; then
        rm -f "$body"
        return 0
      fi
    fi
    if [ "$attempt" -lt "$max" ]; then sleep 2; fi
    attempt=$((attempt + 1))
  done
  echo "ERROR: live check failed for $url (last HTTP ${code:-none})." >&2
  if [ -n "$expect" ]; then
    echo "The page did not contain the expected updated version string." >&2
  fi
  rm -f "$body"
  return 1
}

echo "Verifying $LIVE/ ..."
verify_url "$LIVE/" || exit 1
echo "  ok  $LIVE/  HTTP 200"

# Compare apps.json at BASE vs HEAD for version changes (publish requires a clean committed tree).
CHANGED_APPS=$(python3 - "$BASE_SHA" <<'PY'
import json, subprocess, sys
base = sys.argv[1]
def load(rev):
    try:
        raw = subprocess.check_output(["git", "show", f"{rev}:data/apps.json"], text=True)
    except subprocess.CalledProcessError:
        return {}
    data = json.loads(raw)
    return {a.get("id"): a for a in data.get("apps", []) if a.get("id")}
old, new = load(base), load("HEAD")
rows = []
for i, a in new.items():
    b = old.get(i) or {}
    nv, ov = str(a.get("version") or ""), str(b.get("version") or "")
    nd = ((a.get("links") or {}).get("download") or {})
    od = ((b.get("links") or {}).get("download") or {})
    nu, ou = (nd.get("url") if isinstance(nd, dict) else None), (od.get("url") if isinstance(od, dict) else None)
    if nv != ov or nu != ou:
        rows.append(f"{i}\t{nv}")
print("\n".join(rows))
PY
)

if [ -n "$CHANGED_APPS" ]; then
  while IFS=$'\t' read -r app_id version; do
    [ -n "$app_id" ] || continue
    url="$LIVE/apps/${app_id}/"
    echo "Verifying $url (version $version) ..."
    # Listings render the version with a leading v (e.g. v0.0.16) and sometimes bare.
    if verify_url "$url" "v${version}" || verify_url "$url" "$version"; then
      echo "  ok  $url  HTTP 200, version $version present"
    else
      exit 1
    fi
  done <<< "$CHANGED_APPS"
fi

# If data/site.json's version changed, the home page should show it.
SITE_VER=$(python3 - "$BASE_SHA" <<'PY'
import json, subprocess, sys
base = sys.argv[1]
def ver(rev):
    try:
        raw = subprocess.check_output(["git", "show", f"{rev}:data/site.json"], text=True)
        return str(json.loads(raw).get("version") or "")
    except Exception:
        return ""
old, new = ver(base), ver("HEAD")
print(new if new and new != old else "")
PY
)
if [ -n "$SITE_VER" ]; then
  if verify_url "$LIVE/" "v${SITE_VER}" || verify_url "$LIVE/" "$SITE_VER"; then
    echo "  ok  $LIVE/  site version $SITE_VER present"
  else
    exit 1
  fi
fi

echo "Live listing verified at $LIVE/"
