# Configuration

The config file is `~/.claude-control-center/config.json`. Environment variables override it.

| Key | Env | Default | Meaning |
|---|---|---|---|
| `port` | `CLAUDE_HUB_PORT` | 7777 | HTTP/WebSocket port |
| `host` | `CLAUDE_HUB_HOST` | 127.0.0.1 | Bind address (keep loopback) |
| `database` | `CLAUDE_HUB_DB` | `~/.claude-control-center/data.db` | SQLite file |
| `heartbeatTimeout` | `CLAUDE_HUB_HEARTBEAT_TIMEOUT` | 30000 | ms of silence before a session with no known pid is OFFLINE (10x while WORKING) |
| `logLevel` | `LOG_LEVEL` | info | error, warn, info or debug |
| `notifications`, `sound` | `CLAUDE_HUB_NOTIFICATIONS`, `CLAUDE_HUB_SOUND` | true | UI defaults |
| `waiterGraceMs` | `CLAUDE_HUB_WAITER_GRACE` | 5000 | How long a request survives its hook disconnecting before it is marked "handled in terminal" |
| `idlePrompts` | `CLAUDE_HUB_IDLE_PROMPTS` | true | Stop hook waits for a follow-up from the dashboard |
| `idleWaitSeconds` | `CLAUDE_HUB_IDLE_WAIT` | 1800 | Max idle wait, then control returns to the terminal |
| `questionWaitSeconds` | `CLAUDE_HUB_QUESTION_WAIT` | 600 | Max wait for a dashboard answer before the terminal shows the question |
| `permissionWaitSeconds` | `CLAUDE_HUB_PERMISSION_WAIT` | 43200 | Max permission wait (the terminal dialog stays usable meanwhile) |
| `permissionExpiryMs` | `CLAUDE_HUB_PERMISSION_EXPIRY` | 0 | Auto-cancel pending permissions older than this. 0 turns it off |

Per-session environment, set before launching `claude`:

- `CLAUDE_HUB_AGENT_NAME`: display name for the session.
- `CLAUDE_HUB_PROJECT`: overrides the project name (default: the folder name).
- `CLAUDE_HUB_URL`: sends the session to a different hub.

## Permission policies

`~/.claude-control-center/policies.yaml` is reloaded automatically. The first matching rule wins.

```yaml
permissions:
  - tool: "Bash"          # optional tool-name glob
    match: "git status"   # glob over the command (Bash) or file path (Edit/Write)
    action: allow         # allow | deny | ask
  - match: "curl *"
    action: deny
    reason: "No network from agents"
```

Commands that are destructive (`rm`, `git reset --hard`, `DROP TABLE`, ...) or chained (`&&`, `;`, `|`, `$(...)`, redirects) are never auto-allowed. They always reach you.
