# Crewdesk

One local dashboard for all your Claude Code sessions. When any session asks a question, wants permission, or finishes a turn, it shows up in one attention queue at **http://127.0.0.1:7777**. Your answer goes back to the exact session that asked. Routing uses the event id and the session id, never the name or terminal.

```text
Claude #1 ─┐
Claude #2 ─┤   hooks    ┌──────────────┐  WebSocket   ┌───────────┐
Claude #3 ─┼──────────▶ │   crewdesk   │ ◀──────────▶ │ Dashboard │
Claude #4 ─┘ ◀──────────│ SQLite + API │     REST     └───────────┘
            decisions   └──────────────┘
```

## Quick start

```bash
npm install -g crewdesk     # Node >= 22.13 (uses the built-in node:sqlite)
crewdesk configure          # installs hooks into ~/.claude and ~/.claude-accounts/* (with backups)
crewdesk start              # background daemon
crewdesk open               # http://127.0.0.1:7777
```

Install it globally rather than running it through `npx`. The hooks point at the installed script, so its path has to stay put. To work on Crewdesk itself, see [Development](docs/DEVELOPMENT.md).

Start Claude Code sessions normally. Sessions that were already running need a restart, or run `/hooks`, to pick up the hooks.

## What reaches the dashboard

| Claude Code does… | Hook | Dashboard shows | Terminal meanwhile |
|---|---|---|---|
| Asks permission for a tool | `PermissionRequest` | **Allow / Deny** (destructive commands need a second confirm) | Dialog stays live. **First answer wins** |
| Uses `AskUserQuestion` | `PreToolUse` | Option buttons + free-text answer | Spinner. Falls back to the terminal after `questionWaitSeconds` or **Answer in terminal** |
| Finishes a turn | `Stop` | "Waiting for instructions" + **Send** next prompt | Hook waits up to `idleWaitSeconds`. **Back to terminal** releases it |
| Sends a notification | `Notification` | Dismissable notice | — |
| Starts / ends / gets a prompt | `SessionStart` / `SessionEnd` / `UserPromptSubmit` | Agent status, activity | — |

If the hub is down, every hook fails open: Claude Code behaves exactly as if no hook existed.

## Features

- **Agents:** multiple sessions per project, multiple accounts, named `<project> #N` and renamable. Session reconnects are detected. A session goes OFFLINE when its Claude process (`CLAUDE_PID`) dies.
- **Attention queue:** sorted permissions → questions → errors → idle prompts → notifications, then by priority and age.
- **Keyboard:** `J`/`K` move through requests, `A` allows, `D` denies, `R` focuses the reply box, `/` searches, `?` shows help.
- **Filtering and search:** by status, project, agent and free text. History page with a full event table. Per-agent detail page.
- **Notifications:** desktop notifications (opt-in) and sound. Dark and light themes.
- **Permission policies:** in `~/.crewdesk/policies.yaml`. Destructive or chained shell commands are never auto-allowed.
- **Persistence:** everything is persisted in SQLite, so a browser refresh or hub restart loses nothing.

## Commands

`crewdesk start | stop | restart | status | open | logs [-f] | configure | doctor | uninstall`

## Documentation

[Installation](docs/INSTALLATION.md) · [Configuration](docs/CONFIGURATION.md) · [Hooks](docs/HOOKS.md) · [API](docs/API.md) · [Development](docs/DEVELOPMENT.md) · [Troubleshooting](docs/TROUBLESHOOTING.md) · [Security](docs/SECURITY.md) · [Original spec](docs/CLAUDE-CONTROL-CENTER.md)
