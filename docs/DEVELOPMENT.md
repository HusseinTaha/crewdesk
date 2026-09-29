# Development

```text
apps/server     Fastify hub: api/, services/, transport/ (SessionTransport + HookTransport), db/, websocket/, cli/
apps/web        React 19 + Vite + Tailwind v4 dashboard
packages/shared Types, Zod schemas, operation/risk helpers
packages/hook   crewdesk-hook bridge (bundled, no zod, fast startup)
bin/            crewdesk and crewdesk-hook launchers
test/e2e        Playwright specs (real hub + real hook processes)
test/live       Opt-in tests against a real `claude -p`
```

| Command | Does |
|---|---|
| `pnpm dev` | Hub (tsx watch) + Vite on :5173, proxied to the hub |
| `pnpm build` | Builds all packages |
| `pnpm test` | Vitest: API, routing, persistence, policies, installer, hook bridge |
| `pnpm test:e2e` | Playwright. Needs `pnpm build` first |
| `pnpm test:live` | Real Claude Code sessions. Uses tokens; hooks are passed via `--settings` |
| `pnpm typecheck` | Type-checks every package |

To add a new delivery mechanism, implement `SessionTransport` (`apps/server/src/transport/transport.ts`) and register it in `RoutingService`.
