# Remote access

By default Crewdesk listens on `127.0.0.1` only, so the dashboard is reachable from the machine it runs on and nowhere else. Remote mode lets you open it from another machine, for example when Claude Code runs on a server or a VM.

> [!WARNING]
> Anyone who can open the dashboard can approve the commands Claude Code wants to run, or send it new instructions. On the machine where the hub runs, that is the same as a shell. Remote mode protects the dashboard with an access token, but the hub speaks plain HTTP. Use it on a network you trust, or put HTTPS, a VPN or an SSH tunnel in front.

## Pick an option

| Option | Setup | Encrypted | Good for |
|---|---|---|---|
| [SSH tunnel](#option-1-ssh-tunnel-no-remote-mode) | none on the hub | yes (SSH) | one person reaching a server they can SSH into. **Safest.** |
| [Remote mode](#option-2-remote-mode) | `crewdesk start --remote` | no, unless you add HTTPS | a trusted LAN, a VPN such as Tailscale or WireGuard, or behind an HTTPS proxy |
| [Remote mode behind HTTPS](#https-with-a-reverse-proxy) | remote mode + Caddy or nginx | yes (TLS) | a server reachable over the internet |

## Option 1: SSH tunnel (no remote mode)

Keep the hub local and forward its port over SSH. Run this on the machine you browse from:

```bash
ssh -N -L 7777:127.0.0.1:7777 user@your-server
```

Then open **http://127.0.0.1:7777**. No token is needed, because the hub still only sees local connections. VS Code Remote-SSH can forward port 7777 for you.

## Option 2: remote mode

On the machine that runs Claude Code:

```bash
crewdesk restart --remote       # or: crewdesk start --remote
```

```text
! Remote mode: listening on 0.0.0.0:7777. Anyone with the token can approve commands.

Sign in from another machine with:
  http://192.168.1.20:7777/?token=hCADKijV4UbZ…
```

Open one of the printed login URLs on the other machine. The link signs that browser in and removes the token from the address bar. After that, `http://192.168.1.20:7777` works in that browser for 30 days.

`--remote` is saved in `~/.crewdesk/config.json` as `"remote": true`, so `crewdesk restart`, `status`, `token` and the hooks all keep using remote mode. Go back with:

```bash
crewdesk restart --local
```

### Commands

| Command | Does |
|---|---|
| `crewdesk start --remote` / `restart --remote` | Turn remote mode on (saved) and print the login URLs |
| `crewdesk start --local` / `restart --local` | Back to `127.0.0.1` only, no token (saved) |
| `crewdesk token` | Print the login URLs again |
| `crewdesk token --rotate` | New token: every signed-in browser is signed out. Restarts the hub if it is running |
| `crewdesk open` | On the hub machine, opens the dashboard already signed in |
| `crewdesk status` / `doctor` | Show that remote mode is on |

### Open the firewall (only to yourself)

The port also has to be open in the hub machine's firewall. Allow only the address you connect from.

Windows (PowerShell as Administrator):

```powershell
New-NetFirewallRule -DisplayName "Crewdesk 7777" -Direction Inbound -Protocol TCP -LocalPort 7777 -RemoteAddress 203.0.113.10 -Action Allow
```

Linux (ufw):

```bash
sudo ufw allow from 203.0.113.10 to any port 7777 proto tcp
```

### Settings

| Key | Env | Meaning |
|---|---|---|
| `remote` | `CREWDESK_REMOTE` | `true` turns remote mode on. The hub then listens on `0.0.0.0`, unless `host` is set to a specific address |
| `host` | `CREWDESK_HOST` | Any address other than `127.0.0.1`, `localhost` or `::1` turns remote mode on automatically, so the hub is never on the network without the token. Set a private IP to listen on one interface only |

PowerShell has no `VAR=value command` syntax. Use `$env:CREWDESK_REMOTE = "1"; crewdesk restart`, or just `crewdesk restart --remote`.

## HTTPS with a reverse proxy

For anything beyond a trusted LAN, put TLS in front. The hub uses `X-Forwarded-Proto: https` to mark its cookie `Secure`. The proxy must **pass the original `Host` header through**, because the hub checks that the browser's `Origin` matches it. It must also forward WebSocket upgrades on `/ws`.

Caddy does all of this by default:

```caddyfile
crewdesk.example.com {
    reverse_proxy 127.0.0.1:7777
}
```

nginx:

```nginx
location / {
    proxy_pass http://127.0.0.1:7777;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 1h;   # keeps the dashboard WebSocket open
}
```

Then firewall port 7777 off from the outside so only the proxy reaches it, and sign in with `https://crewdesk.example.com/?token=…`.

## How it works

- **Token.** `~/.crewdesk/access.token` holds 256 random bits, created on the first remote start and reused after that. It is written with owner-only permissions on macOS and Linux. On Windows, it is protected by your user profile's permissions.
- **Signing in.** Opening `/?token=…` sets an `HttpOnly`, `SameSite=Strict` cookie, `Secure` behind HTTPS, and redirects to the same page without the token. The sign-in page also has a box where you can paste the token.
- **Every request is checked.** Page loads, API calls and the WebSocket must carry the cookie or an `Authorization: Bearer <token>` header. Tokens are compared in constant time.
- **Open without the token.** `GET /health` (status, uptime and version only) stays open for monitoring, and `POST /api/admin/shutdown` keeps its own per-run token.
- **Cross-site protection.** Requests whose `Origin` is not the hub itself get 403, even with a valid cookie. Responses forbid framing (`X-Frame-Options: DENY`), so another site can't trick you into clicking **Allow**.
- **Hooks and CLI** on the hub machine read the token file automatically. A hook with a missing or wrong token fails open, like every other hook failure, so Claude Code carries on in the terminal. `CREWDESK_TOKEN` overrides the file for a session.
- **Local mode is unchanged.** It needs no token, rejects non-loopback `Host` headers (DNS rebinding) and rejects cross-site `Origin`s.

## Troubleshooting

- **Connection refused or timed out from the other machine.** Check that `crewdesk status` shows remote mode, check the firewall, and check that you are using an IP printed by `crewdesk token`.
- **The sign-in page keeps coming back.** The token was rotated or the cookie expired. Run `crewdesk token` for a fresh login URL.
- **403 behind a proxy.** The proxy is rewriting `Host`. Pass the original one through (`proxy_set_header Host $host`).
- **Sessions stopped appearing after `token --rotate`.** Restart the Claude Code sessions if they run with an old `CREWDESK_TOKEN` override. The token file itself is re-read by every hook call.
