#!/usr/bin/env bash
# Tests for scripts/publish-data-only.sh --dry-run in a temporary git repo.
# Stubs gitleaks, leak-check, and npm so these cases exercise the allowlist
# and safety gates, not the full site suite.
set -euo pipefail

REPO=$(cd "$(dirname "$0")" && pwd)
SCRIPT="$REPO/scripts/publish-data-only.sh"
[ -x "$SCRIPT" ] || { echo "missing executable $SCRIPT" >&2; exit 1; }

PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); echo "  ok   $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  FAIL $1"; }

WORKDIR=$(mktemp -d /tmp/aipp-data-only-tests.XXXX)
trap 'rm -rf "$WORKDIR"' EXIT

STUBS="$WORKDIR/stubs"
mkdir -p "$STUBS"
cat > "$STUBS/gitleaks" <<'S'
#!/usr/bin/env bash
exit 0
S
cat > "$STUBS/leak-check" <<'S'
#!/usr/bin/env bash
exit 0
S
chmod +x "$STUBS/gitleaks" "$STUBS/leak-check"
export PATH="$STUBS:$PATH"
export LEAK_CHECK_SH="$STUBS/leak-check"

# Ensure a missing gitleaks would be fail-closed in production; these tests
# put a stub first on PATH so find_gitleaks succeeds.

setup_fixture() {
  local dir="$1"
  mkdir -p "$dir/data" "$dir/scripts"
  printf '%s\n' '{"apps":[]}' > "$dir/data/apps.json"
  printf '%s\n' '{"name":"fixture","githubOwner":"ExampleOwner","siteUrl":"https://example.invalid"}' > "$dir/data/site.json"
  printf '%s\n' '# Changelog' > "$dir/CHANGELOG.md"
  printf '%s\n' 'console.log("build")' > "$dir/build.mjs"
  printf '%s\n' '#!/bin/sh' 'echo placeholder' > "$dir/scripts/publish-data-only.sh"
  printf '%s\n' '{
  "name": "fixture-store",
  "private": true,
  "scripts": {
    "build": "mkdir -p dist && echo built > dist/index.html",
    "test": "echo tests-ok"
  }
}' > "$dir/package.json"
  printf '%s\n' 'node_modules/' 'dist/' 'config.local.json' > "$dir/.gitignore"
  git -C "$dir" init -q
  git -C "$dir" checkout -q -b master
  git -C "$dir" config user.name "Test"
  git -C "$dir" config user.email "test@example.com"
  git -C "$dir" add -A
  git -C "$dir" commit -qm "base"
}

run_dry() {
  local dir="$1"
  shift
  (cd "$dir" && bash "$SCRIPT" --dry-run --base master "$@")
}

# capture rc and output without tripping set -e
run_dry_capture() {
  local dir="$1"
  local outrc="$2"
  shift 2
  set +e
  (cd "$dir" && bash "$SCRIPT" --dry-run --base master "$@") >"$outrc.out" 2>"$outrc.err"
  echo $? >"$outrc.rc"
  set -e
}

expect_fail() {
  local label="$1" dir="$2" needle="$3"
  local id
  id=$(printf '%s' "$label" | tr -cs 'a-zA-Z0-9' '_')
  run_dry_capture "$dir" "$WORKDIR/$id"
  local rc
  rc=$(cat "$WORKDIR/$id.rc")
  if [ "$rc" -ne 0 ] && grep -E -q -- "$needle" "$WORKDIR/$id.err" "$WORKDIR/$id.out"; then
    ok "$label"
  else
    fail "$label (rc=$rc, expected non-zero and /${needle}/)"
    echo "    stdout:" && sed 's/^/    /' "$WORKDIR/$id.out" | tail -20
    echo "    stderr:" && sed 's/^/    /' "$WORKDIR/$id.err" | tail -20
  fi
}

expect_pass() {
  local label="$1" dir="$2"
  local id
  id=$(printf '%s' "$label" | tr -cs 'a-zA-Z0-9' '_')
  run_dry_capture "$dir" "$WORKDIR/$id"
  local rc
  rc=$(cat "$WORKDIR/$id.rc")
  if [ "$rc" -eq 0 ] && grep -q 'Dry run: all checks passed' "$WORKDIR/$id.out"; then
    ok "$label"
  else
    fail "$label (rc=$rc, expected 0 and dry-run success)"
    echo "    stdout:" && sed 's/^/    /' "$WORKDIR/$id.out" | tail -30
    echo "    stderr:" && sed 's/^/    /' "$WORKDIR/$id.err" | tail -30
  fi
}

echo "publish-data-only.sh --dry-run"

# 1. Passing when only data/apps.json changed.
F="$WORKDIR/pass-apps"
setup_fixture "$F"
printf '%s\n' '{"apps":[{"id":"demo"}]}' > "$F/data/apps.json"
# apps must be an array; leak helper allows any array. Use a minimal valid object without secrets.
printf '%s\n' '{"apps":[]}' > "$F/data/apps.json"
# actually need a change vs base — tweak whitespace / a comment is invalid JSON, so add a blank field-free change
python3 -c 'import json,pathlib; p=pathlib.Path("'"$F"'/data/apps.json"); json.dump({"apps":[],"note":"listing tweak"}, p.open("w"), indent=2); p.write_text(p.read_text()+"\n")'
expect_pass "passes when only data/apps.json changed" "$F"

# 2. Failing when a code file (build.mjs) is also modified.
F="$WORKDIR/fail-build"
setup_fixture "$F"
python3 -c 'import json,pathlib; p=pathlib.Path("'"$F"'/data/apps.json"); json.dump({"apps":[],"note":"listing tweak"}, p.open("w"), indent=2)'
echo '// touched' >> "$F/build.mjs"
expect_fail "fails when build.mjs is also modified" "$F" "build.mjs"

# 3. Failing when the publish script itself is also modified.
F="$WORKDIR/fail-script"
setup_fixture "$F"
python3 -c 'import json,pathlib; p=pathlib.Path("'"$F"'/data/apps.json"); json.dump({"apps":[],"note":"listing tweak"}, p.open("w"), indent=2)'
echo '# touched' >> "$F/scripts/publish-data-only.sh"
expect_fail "fails when scripts/publish-data-only.sh is also modified" "$F" "scripts/publish-data-only.sh"

# 4. Failing when package.json is also modified.
F="$WORKDIR/fail-pkg"
setup_fixture "$F"
python3 -c 'import json,pathlib; p=pathlib.Path("'"$F"'/data/apps.json"); json.dump({"apps":[],"note":"listing tweak"}, p.open("w"), indent=2)'
python3 -c 'import json,pathlib; p=pathlib.Path("'"$F"'/package.json"); d=json.loads(p.read_text()); d["version"]="9.9.9"; p.write_text(json.dumps(d, indent=2)+"\n")'
expect_fail "fails when package.json is also modified" "$F" "package.json"

# 5. Failing when an untracked file exists.
F="$WORKDIR/fail-untracked"
setup_fixture "$F"
python3 -c 'import json,pathlib; p=pathlib.Path("'"$F"'/data/apps.json"); json.dump({"apps":[],"note":"listing tweak"}, p.open("w"), indent=2)'
echo stray > "$F/stray.txt"
expect_fail "fails when an untracked file exists" "$F" "untracked"

# 6. Failing when an allowed path is replaced by a symlink.
F="$WORKDIR/fail-symlink"
setup_fixture "$F"
rm -f "$F/data/apps.json"
ln -s site.json "$F/data/apps.json"
expect_fail "fails when data/apps.json is a symlink" "$F" "symlink"

# 7. Failing when no allowed files changed (empty diff).
F="$WORKDIR/fail-empty"
setup_fixture "$F"
expect_fail "fails when no allowed files changed" "$F" "no allowed files changed"

# 8. Failing when only a disallowed file changed (no allowed files in the diff).
F="$WORKDIR/fail-only-code"
setup_fixture "$F"
echo '// touched' >> "$F/build.mjs"
expect_fail "fails when only build.mjs changed" "$F" "build.mjs"

# 9. Ignored untracked files (e.g. dist/) do not block a data-only dry-run.
F="$WORKDIR/pass-ignored"
setup_fixture "$F"
python3 -c 'import json,pathlib; p=pathlib.Path("'"$F"'/data/apps.json"); json.dump({"apps":[],"note":"listing tweak"}, p.open("w"), indent=2)'
mkdir -p "$F/dist"
echo ignored > "$F/dist/index.html"
expect_pass "passes when only apps.json changed and dist/ is untracked-ignored" "$F"

# Fail-closed when gitleaks is missing is covered by find_gitleaks returning 1
# when GITLEAKS, PATH, and config.local.json .release.gitleaks are all unset/unusable.

echo
echo "publish-data-only tests: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] || exit 1
