# Installation

Requirements: Node.js 22.13 or newer (the hub uses the built-in `node:sqlite`) and Claude Code 2.1 or newer.

```bash
npm install -g crewdesk
crewdesk configure
crewdesk start
```

Install globally. The hooks written by `configure` point at the installed `crewdesk-hook` script, so a temporary `npx` copy would break them.

From source (needs pnpm 10):

```bash
git clone <this repo> crewdesk && cd crewdesk
pnpm install && pnpm build
npm link
```

Running `crewdesk` with no arguments on first run starts a wizard. It creates the database, configures hooks, starts the hub and opens the dashboard.

## What `configure` changes

1. It detects `~/.claude`, every `~/.claude-accounts/<name>` directory that has a `settings.json` or `.claude.json`, and `$CLAUDE_CONFIG_DIR`.
2. It asks which ones to use. You can skip the prompt with `--all` or `--dir <path>` (repeatable), and preview the changes with `--dry-run`.
3. It backs up each `settings.json` to `~/.crewdesk/backups/<account>-settings-<timestamp>.json`.
4. It adds the hooks, writes the file atomically, re-reads it to check it, and restores the backup on any failure.
5. It never changes hooks it did not install. Its own hooks are recognised by `crewdesk-hook` in the command.

## Uninstall

```bash
crewdesk uninstall            # removes only our hooks, stops the hub, asks about the database
crewdesk uninstall --keep-data   # or --delete-data
npm rm -g crewdesk
```
