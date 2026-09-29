#!/usr/bin/env bash
# Installed-CLI smoke test for Linux and macOS (run after `pnpm build`). Uses a throwaway HOME and port.
# Covers what the unit/E2E suites don't: `configure` against a real settings.json, the daemon,
# Claude pid detection through the process tree, OFFLINE on process death, fail-open, uninstall.
set -uo pipefail
cd "$(dirname "$0")/.."

TMP=$(mktemp -d)
export HOME="$TMP/home" CREWDESK_HOME="$TMP/home/.crewdesk" CREWDESK_PORT=7799 CREWDESK_HEARTBEAT_TIMEOUT=600000
HUB="http://127.0.0.1:$CREWDESK_PORT"
FAILED=0
pass() { echo "ok   - $1"; }
fail() { echo "FAIL - $1"; FAILED=1; }
cli() { node bin/crewdesk.mjs "$@"; }
settings() { node -e "const s=require(process.env.HOME+'/.claude/settings.json');console.log($1)"; }
agent() {
  curl -s "$HUB/api/agents" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const a=JSON.parse(d).agents.find(a=>a.sessionId==="smoke");console.log(a?`${a.pid} ${a.status}`:"missing")})'
}
cleanup() { kill "${SHIM:-}" 2>/dev/null; cli stop >/dev/null 2>&1; rm -rf "$TMP"; }
trap cleanup EXIT

mkdir -p "$HOME/.claude"
echo '{"permissions":{"allow":["Bash(ls:*)"]}}' > "$HOME/.claude/settings.json"

cli configure --yes < /dev/null > /dev/null && pass "configure" || fail "configure"
CMD=$(settings 's.hooks.SessionStart[0].hooks[0].command')
[[ "$CMD" == *crewdesk-hook* ]] && pass "hook command: $CMD" || fail "hook command missing"
[ "$(settings 'JSON.stringify(s.permissions)')" = '{"allow":["Bash(ls:*)"]}' ] && pass "existing settings kept" || fail "existing settings changed"

cli start > /dev/null && pass "daemon start" || fail "daemon start"
cli status > /dev/null && pass "status" || fail "status"

# Simulate Claude Code: a process named `claude` running the hook command through sh, without CLAUDE_PID,
# so the hook has to find its pid by walking the process tree.
cat > "$TMP/shim.mjs" <<'EOF'
import { spawn } from "node:child_process";
const c = spawn("sh", ["-c", process.env.HOOKCMD], { stdio: ["pipe", "inherit", "inherit"], env: { ...process.env, CLAUDE_PID: "" } });
c.stdin.end(JSON.stringify({ session_id: "smoke", cwd: process.cwd(), hook_event_name: "SessionStart", source: "startup" }));
setInterval(() => {}, 1000);
EOF
ln -sf "$(command -v node)" "$TMP/claude"
HOOKCMD="$CMD" "$TMP/claude" "$TMP/shim.mjs" &
SHIM=$!
for _ in $(seq 1 40); do [ "$(agent)" != "missing" ] && break; sleep 0.5; done
A=$(agent)
[ "${A%% *}" = "$SHIM" ] && pass "claude pid detected ($A)" || fail "claude pid detection: got '$A', expected $SHIM ($(ps -o comm= -p $SHIM))"

kill "$SHIM"; SHIM=
for _ in $(seq 1 30); do [ "${A#* }" = "OFFLINE" ] && break; sleep 0.5; A=$(agent); done
[ "${A#* }" = "OFFLINE" ] && pass "OFFLINE when claude exits" || fail "still '${A#* }' after claude exited"

cli stop > /dev/null && pass "daemon stop" || fail "daemon stop"
START=$(date +%s)
echo '{"session_id":"x","tool_name":"Bash","tool_input":{"command":"ls"}}' | sh -c "${CMD% register} permission"
RC=$?
[ $RC -eq 0 ] && [ $(( $(date +%s) - START )) -lt 30 ] && pass "fail-open with hub down" || fail "hook with hub down: exit $RC"

cli uninstall --keep-data --yes < /dev/null > /dev/null && pass "uninstall" || fail "uninstall"
[ "$(settings 'JSON.stringify(s)')" = '{"permissions":{"allow":["Bash(ls:*)"]}}' ] && pass "settings restored" || fail "settings not restored: $(settings 'JSON.stringify(s)')"

exit $FAILED
