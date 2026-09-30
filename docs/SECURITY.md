# Security

- **Local only by default:** the hub binds to `127.0.0.1`.
- **Remote mode needs a token:** with `--remote`, or any non-loopback `host`, every request except `/health` must carry the access token from `~/.crewdesk/access.token`, either as the `HttpOnly`, `SameSite=Strict` cookie set by the login URL or as `Authorization: Bearer`. The hub refuses to start on the network without a token. Cross-site `Origin`s get 403, and framing is forbidden. The hub speaks plain HTTP, so use a trusted network, a VPN, an SSH tunnel or an HTTPS proxy. See [Remote access](REMOTE.md).
- **Browser protection:** requests with a non-loopback `Host` header (DNS rebinding) or a cross-site `Origin` are rejected with 403, so a web page open in your browser cannot approve permissions.
- **No remote execution:** the browser never executes anything through the hub. The WebSocket is push-only, and the API only records decisions for requests that Claude Code itself created.
- **Validation:** every payload is validated (Zod), including session and event id formats. Malformed JSON gets 400. Bodies are capped at 1 MB.
- **Explicit auto-decisions only:** nothing is decided automatically unless you write a policy rule. Destructive or chained shell commands always need a human, and allowing a destructive command needs a second confirmation.
- **Graceful shutdown:** `crewdesk stop` uses a random per-run token stored in `hub.token`.
- **Hooks fail open:** they never block Claude Code when the hub is unavailable.
- **Not supported:** user accounts or per-person permissions. Everyone signed in with the token has full control, so rotate it (`crewdesk token --rotate`) if it leaks.
