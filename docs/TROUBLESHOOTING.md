# Troubleshooting

**Hub not starting:** run `crewdesk doctor`. It checks the port, database, Node version, Claude Code, hooks and build. The log is at `crewdesk logs`.

**A Claude session does not appear:** check that `crewdesk doctor` lists hooks for the account you launched with (`CLAUDE_CONFIG_DIR`). Restart the session or run `/hooks`. Then set `CREWDESK_HOOK_DEBUG=1` and read `~/.crewdesk/logs/hook.log`.

**A question appears but the answer never arrives:** the event stays PENDING or PROCESSING until the hook picks it up. Check the event in History (session id, status, close reason). If the hook timed out, the event is CANCELLED with the reason "Timed out waiting", and Claude asked in the terminal instead.

**A card vanished with "Handled in the terminal":** the hook process ended because someone answered in the terminal, pressed Esc, or the hook timed out. This is the expected "first answer wins" behaviour.

**The dashboard doesn't open from another machine:** by default the hub listens on `127.0.0.1` only. Use an SSH tunnel, or `crewdesk restart --remote` and the printed login URL. See [Remote access](REMOTE.md#troubleshooting).

**The sign-in page keeps coming back (remote mode):** the token was rotated or the 30-day cookie expired. Run `crewdesk token` for a fresh login URL.

**The terminal seems stuck after Claude finishes:** the Stop hook is waiting for a dashboard follow-up. Press **Back to terminal**, lower `idleWaitSeconds`, or set `idlePrompts: false`.
