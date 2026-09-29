# Hooks

`crewdesk configure` registers these hooks. Each one runs `node <repo>/bin/crewdesk-hook.mjs <sub>`.

| Event | Sub-command | Timeout (s) | Behaviour |
|---|---|---|---|
| SessionStart | `register` | 30, async | Registers the session (id, cwd, project, `CLAUDE_CONFIG_DIR` account, `CLAUDE_PID`) |
| UserPromptSubmit | `prompt` | 10, async | Marks WORKING and cancels any pending idle prompt |
| Notification | `notification` | 10, async | `permission_prompt` and `idle_prompt` are logged silently; others become dismissable notices |
| PermissionRequest | `permission` | 86400 | Creates the request and long-polls `GET /api/events/:id/wait`; prints `decision.behavior` allow or deny |
| PreToolUse (`AskUserQuestion`) | `question` | 86400 | Prints `permissionDecision: allow` plus `updatedInput.answers` |
| Stop | `stop` | 86400 | Logs completion; optionally waits and prints `{"decision":"block","reason":"<your prompt>"}` |
| SessionEnd | `session-end` | 5 | Marks OFFLINE and cancels outstanding requests |

## Observed Claude Code behaviour (2.1.284, Windows)

- **PermissionRequest:** the terminal dialog is shown while the hook runs. If the user answers in the terminal, Claude Code kills the hook, and the hub notices the long-poll dropped and cancels the card after `waiterGraceMs` ("first answer wins").
- **PreToolUse on AskUserQuestion:** the question UI is not shown while the hook runs. That is why the question wait has a time limit and an "Answer in terminal" button.
- **Stop with `decision: block`:** the `reason` becomes Claude's next instruction. `stop_hook_active` is true on the follow-up stop.
- **Environment:** `CLAUDE_PID`, `CLAUDE_CODE_SESSION_ID`, `CLAUDE_PROJECT_DIR` and `CLAUDE_CONFIG_DIR` are exported to hooks. On Windows, hooks run under Git Bash.
- **Not verified:** whether the terminal accepts typing while the Stop hook waits. If it doesn't, press **Back to terminal** on the dashboard or lower `idleWaitSeconds`. Set `idlePrompts: false` to turn the feature off.

## Failure behaviour

Hooks always exit 0.
- **Hub unreachable:** retried at 100 ms, 500 ms, 1 s and 2 s (5 attempts). After that the hook prints nothing, so Claude Code proceeds normally.
- **Hub restart:** a waiting hook keeps retrying its long-poll for about 60 s, so the hub can restart without losing the request.
- **Debugging:** set `CREWDESK_HOOK_DEBUG=1` to log to `~/.crewdesk/logs/hook.log`.
