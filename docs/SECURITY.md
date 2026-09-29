# Security

- **Local only:** the hub binds to `127.0.0.1` by default.
- **Browser protection:** requests with a non-loopback `Host` header (DNS rebinding) or a cross-site `Origin` are rejected with 403, so a web page open in your browser cannot approve permissions.
- **No remote execution:** the browser never executes anything through the hub. The WebSocket is push-only, and the API only records decisions for requests that Claude Code itself created.
- **Validation:** every payload is validated (Zod), including session and event id formats. Malformed JSON gets 400. Bodies are capped at 1 MB.
- **Explicit auto-decisions only:** nothing is decided automatically unless you write a policy rule. Destructive or chained shell commands always need a human, and allowing a destructive command needs a second confirmation.
- **Graceful shutdown:** `claude-hub stop` uses a random per-run token stored in `hub.token`.
- **Hooks fail open:** they never block Claude Code when the hub is unavailable.
- **Not yet supported:** authentication and remote access. Do not bind to `0.0.0.0` on an untrusted network.
