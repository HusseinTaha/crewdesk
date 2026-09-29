#!/usr/bin/env node
// Claude Code hook bridge. Must never break Claude Code: any failure exits 0 silently.
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const entry = fileURLToPath(new URL("../packages/hook/dist/hook.js", import.meta.url));
if (existsSync(entry)) await import(pathToFileURL(entry).href);
else process.exit(0);
