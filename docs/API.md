# API

Base URL: `http://127.0.0.1:7777`. JSON only. All input is validated with Zod.

Errors use the form `{"error":{"code","message","details?"}}`, with status 400, 401, 403, 404, 409, 422 or 500.

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | `{status, database, websocket, uptime, version, pid}` |
| POST | `/api/agents/register` | `{sessionId, name?, project?, cwd?, pid?, account?}` returns `{success, agentId, agent}`. Idempotent per session |
| POST | `/api/agents/heartbeat` | `{sessionId, status?, activity?}` |
| GET | `/api/agents`, `/api/agents/:id` | The detail call includes recent events |
| PATCH | `/api/agents/:id` | `{name?, status?, activity?}` |
| DELETE | `/api/agents/:id` | Removes the agent and its history |
| POST | `/api/events` | `{sessionId, type, message?, priority?, payload?, agent?}` returns `{id, status, event}` |
| GET | `/api/events` | `?status=pending&type=question&agent=&session=&project=&q=&limit=&before=` |
| GET | `/api/events/pending` | Everything in PENDING or PROCESSING |
| GET | `/api/events/:id` | |
| POST | `/api/events/:id/respond` | `{action: allow, deny, answer, prompt or dismiss, sessionId?, response? (alias answer), answers?, confirm?}` |
| POST | `/api/events/:id/cancel` | `{sessionId?, reason?}` |
| GET | `/api/events/:id/wait` | `?sessionId=&timeout=ms`. Long-poll for hooks; returns `{state: pending, resolved or cancelled}` |
| GET | `/api/policies`, `/api/settings` | |
| WS | `/ws` | Server-push only: `hello`, `agent.created/updated/removed`, `event.created/updated/resolved/deleted` |

## Event lifecycle

`PENDING` → decision recorded → `PROCESSING` → hook received it → `RESOLVED`.

A request can also end as `CANCELLED` (withdrawn, handled in the terminal, session ended, expired) or `FAILED` (the session stopped waiting before delivery).

## Routing rules

- A response is routed only by event id → session id → transport.
- If `respond`, `cancel` or `wait` gets a `sessionId` that doesn't match the event, it returns `403 SESSION_MISMATCH`.
- Answering twice returns `409 EVENT_NOT_PENDING`.
- Allowing a destructive permission without `confirm: true` returns `422 CONFIRMATION_REQUIRED`.
