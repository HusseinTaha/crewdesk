# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

- Shared memory: bootstrap with `ctx_get(role=<yours>)` before exploring; pass `since=<last CURSOR>` on later calls; `ctx_commit` compact results before finishing.
- Code navigation: this repo is indexed by graft (see `AGENTS.md`); prefer `graft ask/grep/callers/skeleton` over raw grep. Run `graft build` after large changes.

## What this is

Crewdesk: a local hub + web dashboard that receives Claude Code hook events from many sessions (permissions, `AskUserQuestion`, Stop/idle, notifications) and routes the user's answer back to the exact session. pnpm monorepo, Node >= 22.13 (uses built-in `node:sqlite`), ESM throughout. Published to npm as a single package `crewdesk` (see `files` in root `package.json`).

## Commands

| Command | Does |
|---|---|
| `pnpm dev` | Hub (tsx watch) + Vite dev server on :5173 proxied to the hub |
| `pnpm build` | Builds all packages (tsup for server/hook, Vite for web) |
| `pnpm test` | Vitest unit/integration (`apps/*/test`, `packages/*/test`) |
| `pnpm vitest run apps/server/test/api.test.ts -t "<name>"` | Single test file / test |
| `pnpm test:e2e` | Playwright. **Requires `pnpm build` first**; starts a real hub on port 7788 with a temp `CREWDESK_HOME` |
| `pnpm test:live` | Opt-in, runs a real `claude -p` (costs tokens) |
| `pnpm typecheck` | Type-check every package (`lint` is an alias) |
| `bash scripts/smoke.sh` | macOS/Linux CLI smoke test (installer, daemon, pid detection, fail-open); needs `pnpm build` |
| `node scripts/screenshots.mjs` | Regenerate README screenshots (`docs/images/`) from a throwaway hub with made-up sessions; needs `pnpm build` |
| `pnpm start` | Run the built hub in the foreground |

`bin/crewdesk.mjs` and `bin/crewdesk-hook.mjs` load the **built** `dist/` outputs, so rebuild after changing server or hook code before testing via the CLI or E2E.

## Architecture

- `packages/shared` — types, Zod schemas, operation/risk classification helpers used by server and web.
- `packages/hook` — the `crewdesk-hook` bridge that Claude Code invokes per hook. Bundled with no zod for fast startup. **Must fail open**: if the hub is unreachable or anything throws, exit 0 silently so Claude Code behaves as if no hook existed. It posts the event, then long-polls the hub for a decision.
- `apps/server` — Fastify hub.
  - `hub.ts` wires the domain core independent of HTTP: SQLite db, `EventBus`, `AgentService`, `EventService`, `PolicyService`, `RoutingService`, plus a sweeper that marks agents OFFLINE (dead `CLAUDE_PID` or heartbeat timeout) and expires permissions.
  - `services/routing.service.ts` — routes decisions by **event id → stored session id → transport**; never by agent name, project, or terminal. `wait()` is the hook's long-poll; waiters that disconnect stop counting, and waiters pending at hub restart get a grace period to reconnect (`armRecovered`).
  - `transport/` — `SessionTransport` interface; `HookTransport` is the only implementation. New delivery mechanisms implement `SessionTransport` and register in `RoutingService`.
  - `api/` REST routes, `websocket/` pushes bus events to the dashboard, `cli/` holds the daemon manager and `hooks-config.ts` (the `crewdesk configure` installer that edits `~/.claude` and `~/.claude-accounts/*` settings, with backups).
  - `auth.ts` + `server.ts` `remoteAuth` — remote mode: any non-loopback bind requires the access token (`~/.crewdesk/access.token`) as the `crewdesk_auth` cookie (set by `/?token=` login URL) or `Authorization: Bearer`; `/health` and admin shutdown are exempt. The security `onRequest` hook is registered **after** the WebSocket plugin so rejected upgrades get their socket closed. Hooks and CLI read the token file. See `docs/REMOTE.md`.
  - `config.ts` — config from `~/.crewdesk/config.json` overridden by `CREWDESK_*` env vars (`CREWDESK_HOME`, `CREWDESK_PORT`, `CREWDESK_DB`, `CREWDESK_WAITER_GRACE`, ...). Policies live in `~/.crewdesk/policies.yaml`; destructive/chained shell commands are never auto-allowed.
- `apps/web` — React 19 + Vite + Tailwind v4 dashboard (`useHub` hook holds REST + WebSocket state).

Hook behavior per event type (and terminal interplay, e.g. permission dialogs stay live and first answer wins) is documented in `README.md` and `docs/HOOKS.md`; config keys in `docs/CONFIGURATION.md`; REST API in `docs/API.md`.

## Conventions

- CI: `.github/workflows/ci.yml` (Linux/macOS/Windows × Node 22.13/24). Release: `npm version patch` then push the tag; `release.yml` publishes with provenance (needs `NPM_TOKEN` secret) or, if the version is already on npm (local publish), only creates the GitHub release. npm enforces 2FA, so a local `npm publish` needs an OTP or a bypass-2FA token.
- README images use absolute `raw.githubusercontent.com` URLs so they render on npmjs.com too. Never screenshot real sessions: the hook derives the account from `CLAUDE_CONFIG_DIR`, so unset it (the script does).
- Commit messages: no `Co-Authored-By: Claude` trailer (user preference).
