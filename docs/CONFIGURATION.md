# Configuration

The config file is `~/.crewdesk/config.json`. Environment variables override it.

| Key | Env | Default | Meaning |
|---|---|---|---|
| `port` | `CREWDESK_PORT` | 7777 | HTTP/WebSocket port |
| `host` | `CREWDESK_HOST` | 127.0.0.1 | Bind address (keep loopback) |
| `database` | `CREWDESK_DB` | `~/.crewdesk/data.db` | SQLite file |
| `heartbeatTimeout` | `CREWDESK_HEARTBEAT_TIMEOUT` | 30000 | ms of silence before a session with no known pid is OFFLINE (10x while WORKING) |
| `logLevel` | `LOG_LEVEL` | info | error, warn, info or debug |
| `notifications`, `sound` | `CREWDESK_NOTIFICATIONS`, `CREWDESK_SOUND` | true | UI defaults |
| `waiterGraceMs` | `CREWDESK_WAITER_GRACE` | 5000 | How long a request survives its hook disconnecting before it is marked "handled in terminal" |
| `idlePrompts` | `CREWDESK_IDLE_PROMPTS` | true | Stop hook waits for a follow-up from the dashboard |
| `idleWaitSeconds` | `CREWDESK_IDLE_WAIT` | 1800 | Max idle wait, then control returns to the terminal |
| `questionWaitSeconds` | `CREWDESK_QUESTION_WAIT` | 600 | Max wait for a dashboard answer before the terminal shows the question |
| `permissionWaitSeconds` | `CREWDESK_PERMISSION_WAIT` | 43200 | Max permission wait (the terminal dialog stays usable meanwhile) |
| `permissionExpiryMs` | `CREWDESK_PERMISSION_EXPIRY` | 0 | Auto-cancel pending permissions older than this. 0 turns it off |

Per-session environment, set before launching `claude`:

- `CREWDESK_AGENT_NAME`: display name for the session.
- `CREWDESK_PROJECT`: overrides the project name (default: the folder name).
- `CREWDESK_URL`: sends the session to a different hub.

## Permission policies

`~/.crewdesk/policies.yaml` is reloaded automatically. The first matching rule wins.

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
