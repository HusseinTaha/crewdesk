# Claude Control Center

A local web-based control center for managing multiple **Claude Code** sessions from one dashboard.

The goal is to run several Claude Code agents simultaneously and have a single interface where the user can see when an agent needs attention, answer questions, approve or reject permissions, and route the response back to the exact Claude Code session that requested it.

---

## 1. Overview

### Problem

When running multiple Claude Code sessions simultaneously, each session can independently:

* Ask the user a question
* Request permission to execute an operation
* Wait for user input
* Finish a task
* Encounter an error
* Become idle

With four or more concurrent sessions, monitoring separate terminals becomes inconvenient.

### Goal

Create a local application called **Claude Control Center** that aggregates these events into one dashboard.

Instead of switching between four terminals:

```text
Terminal 1 → Claude
Terminal 2 → Claude
Terminal 3 → Claude
Terminal 4 → Claude
```

the user interacts with:

```text
                 Claude #1 ─┐
                 Claude #2 ─┤
                 Claude #3 ─┼──> Claude Control Center
                 Claude #4 ─┘            │
                                         ▼
                                   Web Dashboard
                                         │
                                         ▼
                                    User Response
                                         │
                                         ▼
                              Correct Claude Session
```

---

# 2. Core Requirements

The application must support:

1. Multiple Claude Code sessions
2. Multiple projects
3. Unique identification of every Claude session
4. Centralized questions
5. Centralized permission requests
6. Centralized notifications
7. Real-time dashboard updates
8. Sending responses back to the correct session
9. Session status monitoring
10. Persistent event history
11. Project/session filtering
12. Local-only operation by default
13. No requirement for a cloud backend
14. Authentication as an optional future feature
15. Easy installation and startup

The initial implementation should support at least:

```text
4 concurrent Claude Code sessions
```

but the architecture should not impose a hard four-session limit.

---

# 3. Proposed Name

## Claude Control Center

CLI command:

```bash
claude-hub
```

Web interface:

```text
http://localhost:7777
```

Optional API:

```text
http://localhost:7777/api
```

---

# 4. Architecture

Recommended architecture:

```text
┌─────────────────────────────────────────────┐
│             Claude Code Session 1           │
│             Project: API                    │
└──────────────────────┬──────────────────────┘
                       │
┌──────────────────────▼──────────────────────┐
│             Claude Code Session 2           │
│             Project: Frontend               │
└──────────────────────┬──────────────────────┘
                       │
┌──────────────────────▼──────────────────────┐
│             Claude Code Session 3           │
│             Project: Backend                │
└──────────────────────┬──────────────────────┘
                       │
┌──────────────────────▼──────────────────────┐
│             Claude Code Session 4           │
│             Project: Mobile                 │
└──────────────────────┬──────────────────────┘
                       │
                       ▼
             ┌───────────────────┐
             │   Claude Hub      │
             │                   │
             │ Node/TypeScript   │
             │ SQLite            │
             │ WebSocket         │
             └─────────┬─────────┘
                       │
                       ▼
             ┌───────────────────┐
             │    Web UI         │
             │                   │
             │ localhost:7777    │
             └───────────────────┘
```

---

# 5. Technology Stack

## Backend

Recommended:

```text
Node.js
TypeScript
Fastify
SQLite
WebSocket
Zod
```

Alternative:

```text
Node.js
TypeScript
Express
SQLite
Socket.IO
```

Fastify is preferred for a lightweight local service.

---

# 6. Frontend

Recommended:

```text
React
TypeScript
Vite
Tailwind CSS
```

The UI should be a single-page application.

---

# 7. Database

Use SQLite.

Database:

```text
~/.claude-control-center/data.db
```

SQLite is sufficient because this is primarily a local application.

No external database should be required.

---

# 8. Claude Session Identification

Every Claude Code session must have a unique identifier.

Example:

```text
session_01HXYZ...
```

Recommended fields:

```json
{
  "sessionId": "session_abc123",
  "agentName": "Claude #1",
  "projectName": "my-api",
  "cwd": "/Users/me/projects/my-api",
  "pid": 12345
}
```

The session ID must remain stable for the lifetime of that Claude Code session.

---

# 9. Agent Registration

When Claude Code starts, the hook integration should register the session with Claude Hub.

Example request:

```http
POST /api/agents/register
Content-Type: application/json
```

```json
{
  "sessionId": "session_abc123",
  "name": "Claude #1",
  "project": "my-api",
  "cwd": "/Users/me/projects/my-api",
  "pid": 12345
}
```

The server responds:

```json
{
  "success": true,
  "agentId": "agent_01"
}
```

---

# 10. Agent States

Each Claude session should have one of these states:

```text
STARTING
WORKING
WAITING
QUESTION
PERMISSION
ERROR
COMPLETED
OFFLINE
```

Example:

```text
Claude #1
● WORKING

Claude #2
● WAITING

Claude #3
● PERMISSION

Claude #4
● ERROR
```

Use colors:

```text
WORKING     = blue
WAITING     = yellow
QUESTION    = orange
PERMISSION  = purple
ERROR       = red
COMPLETED   = green
OFFLINE     = gray
```

---

# 11. Event System

All interaction should be represented as events.

Example:

```json
{
  "eventId": "evt_123",
  "sessionId": "session_abc123",
  "type": "question",
  "timestamp": "2026-09-29T10:00:00Z",
  "payload": {
    "message": "Should I use JWT or sessions?"
  }
}
```

Supported event types:

```text
session.started
session.updated
session.stopped

question.created
question.answered
question.cancelled

permission.created
permission.approved
permission.denied

notification.created

task.started
task.completed
task.failed
```

---

# 12. Question Handling

When Claude needs an answer, the dashboard should show:

```text
┌─────────────────────────────────────────────┐
│ Claude #2                                   │
│ my-api                                      │
├─────────────────────────────────────────────┤
│                                             │
│ Claude asks:                                │
│                                             │
│ Which authentication system should I use?  │
│                                             │
│ ○ JWT                                       │
│ ○ Session cookies                           │
│ ○ OAuth                                     │
│                                             │
│ [ Submit ]                                  │
│                                             │
│ Custom answer:                              │
│ ┌─────────────────────────────────────────┐ │
│ │                                         │ │
│ └─────────────────────────────────────────┘ │
│                                             │
│ [ Send Answer ]                             │
└─────────────────────────────────────────────┘
```

---

# 13. Multiple Choice Questions

If Claude provides explicit options, display buttons.

Example:

```text
Claude asks:

Which database should I use?

[ PostgreSQL ]

[ MySQL ]

[ SQLite ]

[ Let Claude decide ]
```

Selecting an option sends the corresponding response.

---

# 14. Free-Text Questions

The user should always have the ability to provide a custom response.

Example:

```text
┌───────────────────────────────────────┐
│ Type your answer...                   │
│                                       │
│ Use PostgreSQL because this will      │
│ eventually run in production.         │
│                                       │
└───────────────────────────────────────┘

[ Send ]
```

---

# 15. Permission Requests

Claude may request permission for an operation.

Example:

```text
┌──────────────────────────────────────────────┐
│ Permission Request                           │
├──────────────────────────────────────────────┤
│                                              │
│ Claude #3                                    │
│ backend                                      │
│                                              │
│ Wants to execute:                            │
│                                              │
│ npm install zod                              │
│                                              │
│ Directory:                                   │
│ /projects/backend                            │
│                                              │
│ [ Allow ]       [ Deny ]                     │
└──────────────────────────────────────────────┘
```

The dashboard should make permission requests visually distinct from normal questions.

---

# 16. Dangerous Operations

Permission requests should display the operation clearly.

Example:

```text
Command:

rm -rf ./build

Working directory:

/projects/frontend
```

The UI should not hide the command.

For potentially destructive operations, use an additional confirmation:

```text
[ Allow ]

This operation may delete files.

[ Confirm Allow ]
```

---

# 17. Permission Decision API

Example:

```http
POST /api/events/:eventId/respond
```

Request:

```json
{
  "action": "allow"
}
```

or:

```json
{
  "action": "deny"
}
```

For questions:

```json
{
  "action": "answer",
  "answer": "Use PostgreSQL."
}
```

---

# 18. Routing Responses

This is one of the most important parts of the system.

Every pending request must contain:

```text
sessionId
eventId
```

Example:

```json
{
  "eventId": "evt_123",
  "sessionId": "session_abc123",
  "type": "question"
}
```

When the user responds:

```text
evt_123
```

the server looks up:

```text
evt_123
    ↓
session_abc123
    ↓
Claude #2
```

The response must never be routed based solely on:

```text
agent name
project name
terminal number
```

because these can change.

The session ID is the authoritative routing identifier.

---

# 19. Event Lifecycle

Example:

```text
Claude asks question
        │
        ▼
Hook captures question
        │
        ▼
Hub receives event
        │
        ▼
SQLite stores event
        │
        ▼
WebSocket broadcasts event
        │
        ▼
Dashboard displays question
        │
        ▼
User answers
        │
        ▼
POST /api/events/:id/respond
        │
        ▼
Hub resolves session
        │
        ▼
Response delivered to Claude
        │
        ▼
Event marked ANSWERED
```

---

# 20. WebSocket

The frontend should maintain a WebSocket connection:

```text
ws://localhost:7777/ws
```

Events are pushed immediately.

Example:

```json
{
  "type": "question.created",
  "event": {
    "id": "evt_123",
    "sessionId": "session_abc123",
    "message": "Which database should I use?"
  }
}
```

The UI should update without requiring a page refresh.

---

# 21. Dashboard

The dashboard should contain:

```text
┌───────────────────────────────────────────────────────┐
│ Claude Control Center                     ● Connected │
├───────────────────────────────────────────────────────┤
│                                                       │
│  Agents                                               │
│                                                       │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐       │
│  │ Claude #1  │ │ Claude #2  │ │ Claude #3  │       │
│  │ ● Working  │ │ ! Question │ │ 🔐 Perm     │       │
│  │ API        │ │ Frontend   │ │ Backend    │       │
│  └────────────┘ └────────────┘ └────────────┘       │
│                                                       │
│  ┌────────────┐                                       │
│  │ Claude #4  │                                       │
│  │ ● Working  │                                       │
│  │ Mobile     │                                       │
│  └────────────┘                                       │
│                                                       │
├───────────────────────────────────────────────────────┤
│ Attention                                             │
│                                                       │
│  Claude #2                                            │
│  Which authentication system should I use?            │
│                                                       │
│  [JWT] [Sessions] [OAuth]                             │
│                                                       │
│  ┌───────────────────────────────────────────────┐    │
│  │ Custom response                              │    │
│  └───────────────────────────────────────────────┘    │
│                                                       │
│  [ Send ]                                             │
│                                                       │
└───────────────────────────────────────────────────────┘
```

---

# 22. Dashboard Sections

The UI should have these sections:

## Header

Displays:

```text
Claude Control Center
Connection status
Number of active agents
Number of pending requests
```

Example:

```text
Claude Control Center

● Connected

4 Agents
2 Need Attention
```

---

## Agent List

Each agent card displays:

```text
Agent name
Project
Status
Last activity
Pending request count
```

Example:

```text
Claude #2

Project:
frontend

Status:
WAITING

Last activity:
12 seconds ago
```

---

# 23. Attention Queue

The most important UI element is the attention queue.

Sort pending requests by:

1. Permission requests
2. Questions
3. Errors
4. Other notifications

Within each category, sort by timestamp.

Example:

```text
NEEDS ATTENTION — 3

1. Claude #3
   Permission request
   npm install zod

2. Claude #2
   Question
   Which API should I use?

3. Claude #4
   Error
   Build failed
```

---

# 24. Completed Events

Users should be able to see recently completed interactions.

Example:

```text
Recent Activity

10:32  Claude #1  Question answered
10:30  Claude #3  Permission approved
10:28  Claude #2  Task completed
10:24  Claude #4  Task started
```

---

# 25. Filtering

The dashboard should support filtering by:

```text
All
Working
Waiting
Questions
Permissions
Errors
Completed
```

Also:

```text
Project
Agent
```

Example:

```text
Project:

[ All Projects ▼ ]

Agent:

[ All Agents ▼ ]
```

---

# 26. Search

Add a search field:

```text
Search events...
```

Search should match:

```text
project name
agent name
question text
command
event type
```

---

# 27. Event History

Every event should be persisted.

Example:

```text
Event History

ID
Agent
Project
Type
Status
Created
Resolved
```

---

# 28. Database Schema

## agents

```sql
CREATE TABLE agents (
    id TEXT PRIMARY KEY,
    session_id TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    project_name TEXT,
    cwd TEXT,
    pid INTEGER,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL
);
```

---

## events

```sql
CREATE TABLE events (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    type TEXT NOT NULL,
    status TEXT NOT NULL,
    message TEXT,
    payload TEXT,
    created_at TEXT NOT NULL,
    resolved_at TEXT,
    FOREIGN KEY(session_id) REFERENCES agents(session_id)
);
```

---

## responses

```sql
CREATE TABLE responses (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    action TEXT NOT NULL,
    response TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY(event_id) REFERENCES events(id)
);
```

---

# 29. Event Statuses

Events should use:

```text
PENDING
PROCESSING
RESOLVED
CANCELLED
FAILED
```

Example:

```json
{
  "status": "PENDING"
}
```

After user response:

```json
{
  "status": "RESOLVED"
}
```

---

# 30. REST API

## Register Agent

```http
POST /api/agents/register
```

---

## List Agents

```http
GET /api/agents
```

---

## Get Agent

```http
GET /api/agents/:id
```

---

## Update Agent

```http
PATCH /api/agents/:id
```

---

## Create Event

```http
POST /api/events
```

---

## List Events

```http
GET /api/events
```

Query parameters:

```text
?status=pending
?type=question
?agent=agent_01
?project=my-api
```

---

## Get Event

```http
GET /api/events/:id
```

---

## Respond

```http
POST /api/events/:id/respond
```

---

## Cancel Event

```http
POST /api/events/:id/cancel
```

---

# 31. Example Event Creation

```http
POST /api/events
Content-Type: application/json
```

```json
{
  "sessionId": "session_abc123",
  "type": "question",
  "message": "Which database should I use?",
  "payload": {
    "options": [
      "PostgreSQL",
      "MySQL",
      "SQLite"
    ]
  }
}
```

Response:

```json
{
  "id": "evt_123",
  "status": "PENDING"
}
```

---

# 32. Response Example

```http
POST /api/events/evt_123/respond
Content-Type: application/json
```

```json
{
  "action": "answer",
  "response": "PostgreSQL"
}
```

Response:

```json
{
  "success": true,
  "eventId": "evt_123",
  "status": "RESOLVED"
}
```

---

# 33. Hook Integration

Claude Code hooks should be used to capture relevant events.

The integration should handle at minimum:

```text
PermissionRequest
Notification
```

The implementation should also be designed so additional Claude Code hook events can be added later.

The hook receives Claude's context and forwards the relevant information to the local Hub.

Conceptually:

```text
Claude Code
     │
     ▼
Hook
     │
     ▼
claude-hub
     │
     ▼
SQLite + WebSocket
     │
     ▼
Browser
```

---

# 34. Hook Configuration

The project should provide a generated/configurable hook configuration rather than requiring users to manually write it.

Example conceptual configuration:

```json
{
  "hooks": {
    "PermissionRequest": [
      {
        "command": "claude-hub-hook permission"
      }
    ],
    "Notification": [
      {
        "command": "claude-hub-hook notification"
      }
    ]
  }
}
```

The exact hook configuration must follow the Claude Code version currently installed.

Do not hard-code undocumented fields.

---

# 35. Hook CLI

Create:

```bash
claude-hub-hook
```

Commands:

```bash
claude-hub-hook register
claude-hub-hook permission
claude-hub-hook notification
claude-hub-hook stop
```

Example:

```bash
claude-hub-hook permission
```

The hook reads its input from Claude Code and forwards the event to:

```text
http://127.0.0.1:7777/api/events
```

---

# 36. Local Communication

Use:

```text
127.0.0.1
```

instead of:

```text
0.0.0.0
```

by default.

This ensures the service is not automatically exposed to the local network.

Default:

```text
http://127.0.0.1:7777
```

---

# 37. Security

The initial version should be local-only.

Requirements:

* Bind to `127.0.0.1`
* Do not expose API externally
* Validate all incoming payloads
* Validate session IDs
* Validate event IDs
* Reject malformed JSON
* Do not execute commands received from the browser
* Do not allow arbitrary shell commands through the API

The Hub should route responses to the existing Claude session rather than become an arbitrary command execution service.

---

# 38. Authentication

Authentication is not required for the first version because the application is local-only.

Future versions may support:

```text
API token
Password
OS authentication
Remote access authentication
```

---

# 39. Project Structure

Recommended:

```text
claude-control-center/
│
├── apps/
│   │
│   ├── server/
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── server.ts
│   │   │   │
│   │   │   ├── api/
│   │   │   │   ├── agents.ts
│   │   │   │   ├── events.ts
│   │   │   │   └── health.ts
│   │   │   │
│   │   │   ├── db/
│   │   │   │   ├── database.ts
│   │   │   │   ├── migrations.ts
│   │   │   │   └── schema.sql
│   │   │   │
│   │   │   ├── services/
│   │   │   │   ├── agent.service.ts
│   │   │   │   ├── event.service.ts
│   │   │   │   └── routing.service.ts
│   │   │   │
│   │   │   └── websocket/
│   │   │       └── websocket.ts
│   │   │
│   │   └── package.json
│   │
│   └── web/
│       ├── src/
│       │   ├── components/
│       │   ├── pages/
│       │   ├── hooks/
│       │   ├── lib/
│       │   ├── types/
│       │   └── App.tsx
│       │
│       └── package.json
│
├── packages/
│   │
│   ├── shared/
│   │   ├── src/
│   │   │   ├── types.ts
│   │   │   └── schemas.ts
│   │   └── package.json
│   │
│   └── hook/
│       ├── src/
│       │   ├── cli.ts
│       │   ├── register.ts
│       │   ├── permission.ts
│       │   └── notification.ts
│       └── package.json
│
├── scripts/
│   ├── install.ts
│   └── configure-hooks.ts
│
├── data/
│
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.json
├── README.md
└── LICENSE
```

---

# 40. Monorepo

Use `pnpm` workspaces.

Example:

```text
apps/server
apps/web
packages/shared
packages/hook
```

Root:

```json
{
  "private": true,
  "packageManager": "pnpm"
}
```

---

# 41. Shared Types

All API and frontend types should come from:

```text
packages/shared
```

Example:

```ts
export type AgentStatus =
  | "STARTING"
  | "WORKING"
  | "WAITING"
  | "QUESTION"
  | "PERMISSION"
  | "ERROR"
  | "COMPLETED"
  | "OFFLINE";
```

Event types:

```ts
export type EventType =
  | "session.started"
  | "session.updated"
  | "session.stopped"
  | "question.created"
  | "question.answered"
  | "permission.created"
  | "permission.approved"
  | "permission.denied"
  | "notification.created"
  | "task.started"
  | "task.completed"
  | "task.failed";
```

---

# 42. UI Design

The UI should be:

```text
Dark
Modern
Minimal
Responsive
Keyboard-friendly
```

Suggested colors:

```text
Background:
#0B0D10

Cards:
#151922

Borders:
#252B36

Text:
#F4F7FA

Secondary:
#8B95A5

Blue:
#3B82F6

Green:
#22C55E

Yellow:
#EAB308

Orange:
#F97316

Red:
#EF4444

Purple:
#A855F7
```

---

# 43. Layout

Desktop:

```text
┌──────────────────────────────────────────────────────┐
│ Header                                               │
├───────────────┬──────────────────────────────────────┤
│               │                                      │
│ Agents        │       Attention / Events             │
│               │                                      │
│ Claude #1     │                                      │
│ Claude #2     │       Current Question               │
│ Claude #3     │                                      │
│ Claude #4     │                                      │
│               │                                      │
├───────────────┴──────────────────────────────────────┤
│ Activity                                             │
└──────────────────────────────────────────────────────┘
```

---

# 44. Agent Card

Example:

```text
┌─────────────────────────────┐
│ ● Claude #2                 │
│                             │
│ frontend                    │
│                             │
│ WAITING                     │
│                             │
│ Last activity: 8 sec ago    │
│                             │
│ 1 pending question          │
└─────────────────────────────┘
```

Clicking the card should open that agent's detailed view.

---

# 45. Agent Detail

Example:

```text
Claude #2

Project
frontend

Directory
/projects/frontend

PID
18472

Status
WAITING

Started
10:04:22

Last activity
10:32:14

─────────────────────────────

Current request

Which framework should I use?

[React]
[Vue]
[Svelte]

─────────────────────────────

Recent activity

10:30 Question created
10:28 Task started
10:10 Session started
```

---

# 46. Keyboard Shortcuts

Recommended:

```text
J
Next request

K
Previous request

Enter
Open selected request

A
Allow

D
Deny

R
Focus response box

Esc
Close dialog

?
Show shortcuts
```

---

# 47. Notifications

Optional desktop notifications should be supported.

When a Claude session needs attention:

```text
Claude #3 needs your attention

Permission requested:
npm install zod
```

Browser notifications should only be enabled after user permission.

---

# 48. Sound

Optional sound notification:

```text
Question received
```

Settings:

```text
Sound:
ON / OFF

Desktop notifications:
ON / OFF
```

---

# 49. Priority

Events may have priority:

```text
LOW
NORMAL
HIGH
CRITICAL
```

Example:

```json
{
  "priority": "HIGH"
}
```

Permission requests involving destructive operations may receive higher priority.

---

# 50. Project Groups

The dashboard should optionally group agents by project.

Example:

```text
PROJECT: ecommerce

Claude #1
Claude #2

PROJECT: mobile

Claude #3

PROJECT: infrastructure

Claude #4
```

---

# 51. Multiple Sessions Per Project

The system must allow:

```text
Project A
 ├── Claude #1
 └── Claude #2

Project B
 ├── Claude #3
 └── Claude #4
```

Projects must not be assumed to have one Claude session.

---

# 52. Session Reconnection

If a Claude session disconnects temporarily, the server should retain its record.

Status:

```text
OFFLINE
```

If the same session reconnects:

```text
OFFLINE
    ↓
WORKING
```

The session should not create duplicate records unnecessarily.

---

# 53. Heartbeat

Agents should periodically update:

```text
last_seen_at
```

Example:

```text
Every 10 seconds
```

If no heartbeat/event is received for a configurable period:

```text
OFFLINE
```

---

# 54. Stale Sessions

Default:

```text
Heartbeat timeout: 30 seconds
```

This should be configurable.

Environment variable:

```bash
CLAUDE_HUB_HEARTBEAT_TIMEOUT=30000
```

---

# 55. Logging

Server logs should include:

```text
timestamp
level
event
session ID
event ID
message
```

Example:

```text
10:31:02 INFO  Agent registered session_abc123
10:31:07 INFO  Question created evt_123
10:31:20 INFO  Response received evt_123
10:31:20 INFO  Event resolved evt_123
```

---

# 56. Log Levels

Support:

```text
ERROR
WARN
INFO
DEBUG
```

Environment:

```bash
LOG_LEVEL=info
```

---

# 57. Error Handling

If the Hub is unavailable when a hook fires:

```text
Claude Code should not crash.
```

The hook should fail gracefully.

The hook can:

1. Retry
2. Log the error
3. Exit cleanly

Recommended retry:

```text
100ms
500ms
1s
2s
```

Maximum:

```text
5 attempts
```

---

# 58. Offline Behavior

If the dashboard is closed:

```text
Claude sessions continue working.
```

When the dashboard is reopened:

```text
Pending events are loaded from SQLite.
```

Nothing should depend on the browser remaining open.

---

# 59. Browser Refresh

Refreshing the browser must not lose:

```text
agents
events
pending questions
pending permissions
history
```

The frontend reloads everything from the API.

---

# 60. Server Restart

After server restart:

```text
SQLite database remains intact.
```

Agents that reconnect should become active again.

Previously pending events should remain pending unless explicitly expired.

---

# 61. Event Expiration

Optional future feature.

Example:

```text
Permission request expires after 30 minutes.
```

But the MVP should not automatically expire questions unless explicitly configured.

---

# 62. Configuration

Configuration file:

```text
~/.claude-control-center/config.json
```

Example:

```json
{
  "port": 7777,
  "host": "127.0.0.1",
  "database": "~/.claude-control-center/data.db",
  "heartbeatTimeout": 30000,
  "notifications": true,
  "sound": true
}
```

Environment variables should override config-file values.

---

# 63. CLI

Main command:

```bash
claude-hub
```

Commands:

```bash
claude-hub start
claude-hub stop
claude-hub restart
claude-hub status
claude-hub open
claude-hub logs
claude-hub configure
claude-hub doctor
```

---

# 64. Example CLI

Start:

```bash
claude-hub start
```

Output:

```text
Claude Control Center

✓ Server started
✓ Database ready
✓ WebSocket ready

Dashboard:
http://127.0.0.1:7777

Waiting for Claude Code sessions...
```

---

# 65. Doctor Command

Run:

```bash
claude-hub doctor
```

Output:

```text
Claude Control Center Doctor

✓ Node.js
✓ SQLite
✓ Database
✓ Server
✓ Port 7777
✓ Claude Code detected
✓ Hook configuration
✓ Hook executable

Everything looks good.
```

---

# 66. Installation

Target installation:

```bash
npm install -g claude-control-center
```

or:

```bash
pnpm add -g claude-control-center
```

Then:

```bash
claude-hub configure
```

Then:

```bash
claude-hub start
```

---

# 67. First Run

On first launch:

```text
Welcome to Claude Control Center

This will:

✓ Create a local database
✓ Configure Claude Code hooks
✓ Start the local server
✓ Open the dashboard

Continue?

[Y] Yes
[N] No
```

---

# 68. Hook Installation

The installer should:

1. Detect Claude Code configuration
2. Back up existing configuration
3. Add required hooks
4. Validate configuration
5. Provide rollback if something fails

Never overwrite unrelated existing hooks.

---

# 69. Backup

Before modifying Claude Code configuration:

```text
~/.claude/
```

create a backup:

```text
~/.claude-control-center/backups/
```

Example:

```text
hooks-2026-09-29-103200.json
```

---

# 70. Uninstallation

Command:

```bash
claude-hub uninstall
```

Should offer:

```text
Remove application
Remove hooks
Keep database
Delete database
```

The user should explicitly choose whether to delete historical data.

---

# 71. MVP

The first version should focus on:

### Required

```text
✓ Local server
✓ SQLite
✓ Agent registration
✓ Session IDs
✓ Permission requests
✓ Questions
✓ Responses
✓ WebSocket
✓ Dashboard
✓ Event history
✓ Four concurrent agents
✓ Hook installation
```

### Not required initially

```text
✗ Cloud hosting
✗ Mobile app
✗ Multi-user accounts
✗ Remote access
✗ AI-generated answers
✗ Analytics
✗ Team collaboration
```

---

# 72. Phase 2

Add:

```text
Desktop notifications
Sound
Keyboard shortcuts
Search
Filtering
Project grouping
Event history UI
Agent detail page
Dark/light themes
```

---

# 73. Phase 3

Add:

```text
Remote access
Authentication
HTTPS
Mobile-responsive interface
Multiple computers
Cloud synchronization
```

---

# 74. Phase 4

Potential advanced functionality:

```text
Automatic routing
Agent prioritization
Question templates
Permission policies
Agent groups
Session tagging
Analytics
Usage statistics
```

---

# 75. Permission Policies

A future version could support rules like:

```yaml
permissions:
  - match: "npm install *"
    action: allow

  - match: "git status"
    action: allow

  - match: "rm -rf *"
    action: ask
```

The system should never silently create broad permission rules without explicit user configuration.

---

# 76. Important Routing Principle

The system must distinguish between:

```text
Agent
Session
Project
Terminal
Process
Event
```

They are not interchangeable.

Example:

```text
Project:
my-api

Agent:
Claude #2

Session:
session_abc123

Process:
PID 18273

Event:
evt_92831
```

The event is routed through:

```text
event ID
   ↓
session ID
   ↓
session transport
```

---

# 77. Response Transport

The exact mechanism used to deliver an answer back to Claude Code should be isolated behind an interface.

Example:

```ts
interface SessionTransport {
  sendResponse(
    sessionId: string,
    response: SessionResponse
  ): Promise<void>;
}
```

This prevents the application architecture from being tied to one implementation.

Potential transports:

```text
Hook callback
Local IPC
Named pipe
Unix socket
PTY
Temporary response file
```

The first implementation should use the mechanism officially supported by the installed Claude Code hook/input model.

---

# 78. Transport Abstraction

Example:

```text
SessionTransport
       │
       ├── HookTransport
       │
       ├── IPCTransport
       │
       └── PtyTransport
```

The rest of the application should not care which transport is used.

---

# 79. API Validation

Use Zod.

Example:

```ts
const CreateEventSchema = z.object({
  sessionId: z.string().min(1),
  type: z.string(),
  message: z.string().optional(),
  payload: z.record(z.unknown()).optional()
});
```

All incoming API requests must be validated.

---

# 80. IDs

Use UUID or ULID.

Recommended:

```text
ULID
```

because it is sortable by creation time.

Examples:

```text
01J...
```

IDs:

```text
agentId
sessionId
eventId
responseId
```

---

# 81. Timestamps

Store timestamps in UTC.

Example:

```text
2026-09-29T07:30:00.000Z
```

Convert to local time only in the UI.

---

# 82. Frontend State

Recommended state structure:

```ts
interface AppState {
  agents: Agent[];
  events: Event[];
  pendingEvents: Event[];
  selectedAgentId?: string;
  selectedEventId?: string;
  connectionStatus: "connected" | "disconnected";
}
```

---

# 83. Real-Time Updates

WebSocket messages should support:

```text
agent.created
agent.updated
agent.removed

event.created
event.updated
event.resolved
event.deleted
```

Frontend should update only affected records.

Avoid full-page reloads.

---

# 84. API Error Format

All API errors should use:

```json
{
  "error": {
    "code": "EVENT_NOT_FOUND",
    "message": "Event was not found."
  }
}
```

HTTP status:

```text
400
401
403
404
409
422
500
```

---

# 85. Health Check

Endpoint:

```http
GET /health
```

Response:

```json
{
  "status": "ok",
  "database": "ok",
  "websocket": "ok",
  "uptime": 12345
}
```

---

# 86. Testing

Use:

```text
Vitest
Playwright
```

Backend tests:

```text
Agent registration
Event creation
Event retrieval
Event response
Event routing
Permission handling
Database persistence
```

Frontend tests:

```text
Dashboard rendering
Question interaction
Permission interaction
Filtering
WebSocket updates
```

---

# 87. Critical Tests

### Test 1 — Four agents

Register:

```text
Claude #1
Claude #2
Claude #3
Claude #4
```

Verify all appear.

---

### Test 2 — Independent questions

Create:

```text
Claude #1 → Question A
Claude #2 → Question B
```

Answer B first.

Verify:

```text
Question B → Claude #2
```

and:

```text
Question A → still pending for Claude #1
```

---

### Test 3 — Simultaneous permissions

Create:

```text
Claude #1 → Permission A
Claude #3 → Permission B
```

Approve B.

Verify A remains pending.

---

### Test 4 — Server restart

Create pending event.

Restart server.

Verify event still exists.

---

### Test 5 — Browser refresh

Create pending event.

Refresh browser.

Verify event remains visible.

---

### Test 6 — Wrong session protection

Attempt:

```text
event A
session B
```

The server must reject the mismatch.

---

# 88. UX Principles

The application should answer three questions immediately:

### 1. Which Claude needs me?

Example:

```text
2 NEED ATTENTION
```

### 2. What does it need?

Example:

```text
Claude #3
Permission:
npm install zod
```

### 3. What should I do?

Example:

```text
[ Allow ]

[ Deny ]
```

Do not force the user to navigate through multiple pages for common interactions.

---

# 89. Notification Priority

When multiple agents need attention:

```text
CRITICAL
HIGH
NORMAL
LOW
```

The dashboard should visually prioritize higher-priority requests.

However, the user must still be able to inspect all pending requests.

---

# 90. No Automatic AI Decision-Making

The first version should not automatically answer Claude questions.

Claude Control Center is an orchestration/interface layer.

The user remains responsible for decisions.

Future automation can be added separately.

---

# 91. Example User Workflow

Start the Hub:

```bash
claude-hub start
```

Open:

```text
http://127.0.0.1:7777
```

Start four Claude sessions:

```text
Terminal 1 → Project API
Terminal 2 → Project Frontend
Terminal 3 → Project Backend
Terminal 4 → Project Mobile
```

Dashboard:

```text
Claude #1  ● Working
Claude #2  ● Working
Claude #3  ● Working
Claude #4  ● Working
```

Later:

```text
Claude #3  ! Needs attention
```

Open it:

```text
Claude #3

I found two possible implementations.

1. Redis
2. In-memory cache

Which should I use?
```

User clicks:

```text
Redis
```

The response is routed to Claude #3.

Dashboard becomes:

```text
Claude #1  ● Working
Claude #2  ● Working
Claude #3  ● Working
Claude #4  ● Working
```

No terminal switching required.

---

# 92. Example Dashboard

```text
╭─────────────────────────────────────────────────────────────╮
│ Claude Control Center                       ● CONNECTED      │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  AGENTS                                                     │
│                                                             │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐              │
│  │ ● #1       │ │ ! #2       │ │ 🔐 #3      │              │
│  │ API        │ │ Frontend   │ │ Backend    │              │
│  │ WORKING    │ │ QUESTION   │ │ PERMISSION │              │
│  └────────────┘ └────────────┘ └────────────┘              │
│                                                             │
│  ┌────────────┐                                             │
│  │ ● #4       │                                             │
│  │ Mobile     │                                             │
│  │ WORKING    │                                             │
│  └────────────┘                                             │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  NEEDS ATTENTION                                            │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ Claude #2 · frontend                                  │  │
│  │                                                       │  │
│  │ Which authentication approach should I use?           │  │
│  │                                                       │  │
│  │ [ JWT ] [ Sessions ] [ OAuth ]                       │  │
│  │                                                       │  │
│  │ ┌───────────────────────────────────────────────────┐ │  │
│  │ │ Custom response...                                │ │  │
│  │ └───────────────────────────────────────────────────┘ │  │
│  │                                                       │  │
│  │ [ Send Answer ]                                       │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  RECENT ACTIVITY                                            │
│                                                             │
│  10:31  Claude #1  Task started                             │
│  10:30  Claude #3  Permission approved                     │
│  10:29  Claude #2  Question answered                       │
│                                                             │
╰─────────────────────────────────────────────────────────────╯
```

---

# 93. Development Commands

Install dependencies:

```bash
pnpm install
```

Development:

```bash
pnpm dev
```

Server:

```bash
pnpm dev:server
```

Frontend:

```bash
pnpm dev:web
```

Tests:

```bash
pnpm test
```

Build:

```bash
pnpm build
```

Lint:

```bash
pnpm lint
```

Type checking:

```bash
pnpm typecheck
```

---

# 94. Production Build

Build:

```bash
pnpm build
```

Start:

```bash
pnpm start
```

Expected:

```text
Claude Control Center
Running on http://127.0.0.1:7777
```

---

# 95. Packaging

Eventually publish:

```text
claude-control-center
```

as an npm package.

Potential binaries:

```text
claude-hub
claude-hub-hook
```

---

# 96. Documentation

The repository should include:

```text
README.md
INSTALLATION.md
CONFIGURATION.md
HOOKS.md
API.md
DEVELOPMENT.md
TROUBLESHOOTING.md
SECURITY.md
```

---

# 97. README Quick Start

The README should ultimately allow a new user to do:

```bash
npm install -g claude-control-center

claude-hub configure

claude-hub start
```

Then:

```text
Open http://127.0.0.1:7777
```

Start Claude Code sessions normally.

---

# 98. Troubleshooting

## Hub not starting

Run:

```bash
claude-hub doctor
```

Check:

```text
Port
Database
Node
Claude Code
Hooks
```

---

## Claude does not appear

Check:

```text
claude-hub logs
```

Then:

```bash
claude-hub doctor
```

---

## Question appears but answer does not return

Inspect:

```text
session ID
event ID
transport
hook output
```

The event should remain:

```text
PENDING
```

until delivery succeeds.

---

# 99. Important Implementation Constraint

Do not assume that a Claude Code terminal can be controlled simply by writing text to its process.

The implementation must use the supported Claude Code interaction/hook mechanisms available in the installed version.

The session-response layer should therefore remain abstract:

```ts
SessionTransport
```

This makes the application resilient to changes in Claude Code's hook architecture.

---

# 100. Acceptance Criteria

The MVP is complete when the following workflow works:

### Setup

```bash
claude-hub configure
claude-hub start
```

### Sessions

Four Claude Code sessions connect:

```text
Claude #1
Claude #2
Claude #3
Claude #4
```

### Question

Claude #2 asks:

```text
Which database should I use?
```

Dashboard displays it.

### Response

User selects:

```text
PostgreSQL
```

The response is delivered to Claude #2.

### Permission

Claude #3 requests:

```text
npm install zod
```

Dashboard displays:

```text
[ Allow ] [ Deny ]
```

User clicks:

```text
Allow
```

The correct Claude session receives the decision.

### Concurrent operation

Claude #1, #2, #3 and #4 can all continue operating independently.

### Persistence

Restarting the Hub does not lose event history.

### Real-time

The dashboard updates without refreshing.

---

# 101. Final Architecture

The finished system should look like:

```text
                          USER
                            │
                            ▼
                 ┌─────────────────────┐
                 │ Claude Control Center│
                 │      Web UI          │
                 └──────────┬──────────┘
                            │
                       WebSocket/API
                            │
                            ▼
                 ┌─────────────────────┐
                 │     Claude Hub      │
                 │                     │
                 │ Agent Manager       │
                 │ Event Manager       │
                 │ Routing Manager     │
                 │ Session Manager     │
                 └───────┬─────┬───────┘
                         │     │
                    SQLite     │
                         │     │
                         ▼     ▼
                 ┌──────────┐  Hook
                 │ Database │   Transport
                 └──────────┘      │
                                   │
              ┌────────────────────┼──────────────────┐
              │                    │                  │
              ▼                    ▼                  ▼
        Claude #1             Claude #2          Claude #3
        Project A             Project B          Project C
                                                     │
                                                     ▼
                                                Claude #4
                                                Project D
```

---

# 102. Core Design Principle

The entire application can be reduced to one principle:

> **Every Claude session is an independent worker, and Claude Control Center is the centralized human interface for all workers.**

The Hub should never confuse:

```text
which Claude
which project
which session
which event
```

Every interaction must have a deterministic route:

```text
EVENT
  ↓
SESSION
  ↓
CLAUDE INSTANCE
  ↓
USER RESPONSE
  ↓
SAME SESSION
```

That guarantees that when four Claude Code sessions are running simultaneously, an answer intended for Claude #3 can never accidentally be delivered to Claude #1.

---

# 103. Future Vision

Once the MVP works, Claude Control Center can become a general-purpose local orchestration layer for coding agents.

Potential future UI:

```text
┌─────────────────────────────────────────────────────────────┐
│ CLAUDE CONTROL CENTER                                       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  4 ACTIVE AGENTS             2 NEED ATTENTION              │
│                                                             │
│  API          ● WORKING                                      │
│  Frontend     ! QUESTION                                    │
│  Backend      🔐 PERMISSION                                 │
│  Mobile       ● WORKING                                     │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ATTENTION                                                  │
│                                                             │
│  Frontend                                                   │
│  Which API approach should I use?                           │
│                                                             │
│  [ Option A ] [ Option B ] [ Custom ]                       │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ACTIVITY                                                   │
│                                                             │
│  API       Implementing authentication                      │
│  Frontend  Waiting for answer                               │
│  Backend   Installing dependencies                          │
│  Mobile    Running tests                                    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

The result is a **single command center for multiple Claude Code workers**, while keeping each Claude session independent and preserving deterministic routing between a session and its corresponding user interaction.

This is structured as an implementation-ready product specification, rather than just a UI mockup.
