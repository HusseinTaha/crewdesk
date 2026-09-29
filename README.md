# Crewdesk

[![npm](https://img.shields.io/npm/v/crewdesk)](https://www.npmjs.com/package/crewdesk)
[![CI](https://github.com/HusseinTaha/crewdesk/actions/workflows/ci.yml/badge.svg)](https://github.com/HusseinTaha/crewdesk/actions/workflows/ci.yml)
![node](https://img.shields.io/node/v/crewdesk)
![platforms](https://img.shields.io/badge/platforms-macOS%20%7C%20Linux%20%7C%20Windows-blue)
[![license](https://img.shields.io/npm/l/crewdesk)](LICENSE)

One local dashboard for all your Claude Code sessions. When any session asks a question, wants permission, or finishes a turn, it shows up in one attention queue at **http://127.0.0.1:7777**. Your answer goes back to the exact session that asked. Routing uses the event id and the session id, never the name or terminal.

<picture>
  <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/HusseinTaha/crewdesk/main/docs/images/dashboard-light.png">
  <img alt="Crewdesk dashboard: five Claude Code sessions, a destructive permission request, a question and recent activity" src="https://raw.githubusercontent.com/HusseinTaha/crewdesk/main/docs/images/dashboard-dark.png">
</picture>

## Quick start

```bash
npm install -g crewdesk     # Node >= 22.13 (uses the built-in node:sqlite)
crewdesk configure          # installs hooks into ~/.claude and ~/.claude-accounts/* (with backups)
crewdesk start              # background daemon
crewdesk open               # http://127.0.0.1:7777
```

Install it globally rather than running it through `npx`. The hooks point at the installed script, so its path has to stay put. To work on Crewdesk itself, see [Development](docs/DEVELOPMENT.md).

Start Claude Code sessions normally. Sessions that were already running need a restart, or run `/hooks`, to pick up the hooks.

## How it works

```mermaid
flowchart LR
  subgraph sessions["Claude Code sessions (any project, any account)"]
    C1["payments-api #1"]
    C2["storefront-web #1"]
    C3["mobile-app #1"]
  end
  H["crewdesk-hook<br/>(one short process per hook call)"]
  HUB[("Crewdesk hub<br/>Fastify + SQLite<br/>127.0.0.1:7777")]
  UI["Dashboard<br/>(browser)"]

  C1 & C2 & C3 -- "hook JSON on stdin" --> H
  H -- "POST event, then long-poll" --> HUB
  HUB -- "WebSocket push" --> UI
  UI -- "Allow / Deny / answer / next prompt" --> HUB
  HUB -- "decision" --> H
  H -- "hook output" --> C1 & C2 & C3
```

Each hook call is routed by **event id → the session id stored with that event**, so an answer can only ever reach the session that asked. The terminal stays live the whole time. Whichever answers first, the dashboard or the terminal, wins.

```mermaid
sequenceDiagram
  autonumber
  participant CC as Claude Code
  participant HK as crewdesk-hook
  participant HUB as Crewdesk hub
  participant UI as Dashboard
  CC->>HK: PermissionRequest (Bash: rm -rf dist && pnpm build)
  HK->>HUB: POST /api/events
  HUB-->>UI: WebSocket: new request (desktop notification + chime)
  HK->>HUB: GET /api/events/:id/wait (long-poll)
  UI->>HUB: Allow
  HUB-->>HK: { action: "allow" }
  HK-->>CC: allow → the tool runs
  Note over HK,HUB: Hub down or unreachable? The hook exits 0 and Claude Code carries on as if no hook existed.
```

## What reaches the dashboard

| Claude Code does… | Hook | Dashboard shows | Terminal meanwhile |
|---|---|---|---|
| Asks permission for a tool | `PermissionRequest` | **Allow / Deny** (destructive commands need a second confirm) | Dialog stays live. **First answer wins** |
| Uses `AskUserQuestion` | `PreToolUse` | Option buttons + free-text answer | Spinner. Falls back to the terminal after `questionWaitSeconds` or **Answer in terminal** |
| Finishes a turn | `Stop` | "Waiting for instructions" + **Send** next prompt | Hook waits up to `idleWaitSeconds`. **Back to terminal** releases it |
| Sends a notification | `Notification` | Dismissable notice | — |
| Starts / ends / gets a prompt | `SessionStart` / `SessionEnd` / `UserPromptSubmit` | Agent status, activity | — |

If the hub is down, every hook fails open: Claude Code behaves exactly as if no hook existed.

## Screenshots

**Permission requests.** Destructive commands are flagged and need a second confirm.

![Permission request for rm -rf with a destructive-command warning](https://raw.githubusercontent.com/HusseinTaha/crewdesk/main/docs/images/permission.png)

**Questions.** `AskUserQuestion` options become buttons, and you can also type a custom answer.

![AskUserQuestion rendered as option buttons](https://raw.githubusercontent.com/HusseinTaha/crewdesk/main/docs/images/question.png)

**Idle sessions.** When Claude finishes a turn, send the next instruction straight from the dashboard.

![Waiting for instructions card with a follow-up prompt typed in](https://raw.githubusercontent.com/HusseinTaha/crewdesk/main/docs/images/waiting.png)

**Desktop notifications.** Opt in with **Notify**. They fire while the dashboard tab is in the background.

![Desktop notification: storefront-web #2 needs your attention, permission request git push](https://raw.githubusercontent.com/HusseinTaha/crewdesk/main/docs/images/notification.png)

<table>
  <tr>
    <td width="50%"><b>History</b>: every event, filterable by type, status, project and agent.<br><img alt="Event history table" src="https://raw.githubusercontent.com/HusseinTaha/crewdesk/main/docs/images/history.png"></td>
    <td width="50%"><b>Agent detail</b>: project, directory, pid, account, current task and pending requests.<br><img alt="Agent detail page" src="https://raw.githubusercontent.com/HusseinTaha/crewdesk/main/docs/images/agent-detail.png"></td>
  </tr>
  <tr>
    <td width="50%"><b>Keyboard-first</b>: <code>J</code>/<code>K</code> to move, <code>A</code>/<code>D</code> to allow or deny, <code>?</code> for help.<br><img alt="Keyboard shortcuts dialog" src="https://raw.githubusercontent.com/HusseinTaha/crewdesk/main/docs/images/shortcuts.png"></td>
    <td width="50%" align="center"><b>Responsive</b>: fits a narrow window or a split screen next to your terminal.<br><img alt="Dashboard at phone width" src="https://raw.githubusercontent.com/HusseinTaha/crewdesk/main/docs/images/mobile.png" width="260"></td>
  </tr>
</table>

<sub>Screenshots use made-up sessions and are regenerated with <code>node scripts/screenshots.mjs</code>.</sub>

## Features

- **Agents:** multiple sessions per project, multiple accounts, named `<project> #N` and renamable. Session reconnects are detected. A session goes OFFLINE when its Claude process (`CLAUDE_PID`) dies.
- **Attention queue:** sorted permissions → questions → errors → idle prompts → notifications, then by priority and age.
- **Keyboard:** `J`/`K` move through requests, `A` allows, `D` denies, `R` focuses the reply box, `/` searches, `?` shows help.
- **Filtering and search:** by status, project, agent and free text. History page with a full event table. Per-agent detail page.
- **Notifications:** desktop notifications (opt-in) and sound. Dark and light themes.
- **Permission policies:** in `~/.crewdesk/policies.yaml`. Destructive or chained shell commands are never auto-allowed.
- **Persistence:** everything is persisted in SQLite, so a browser refresh or hub restart loses nothing.
- **Cross-platform:** tested in CI on macOS, Linux and Windows with Node 22 and 24.

## Commands

`crewdesk start | stop | restart | status | open | logs [-f] | configure | doctor | uninstall`

## Documentation

[Installation](docs/INSTALLATION.md) · [Configuration](docs/CONFIGURATION.md) · [Hooks](docs/HOOKS.md) · [API](docs/API.md) · [Development](docs/DEVELOPMENT.md) · [Troubleshooting](docs/TROUBLESHOOTING.md) · [Security](docs/SECURITY.md) · [Original spec](docs/CLAUDE-CONTROL-CENTER.md)
