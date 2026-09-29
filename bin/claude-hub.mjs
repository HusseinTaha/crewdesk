#!/usr/bin/env node
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const entry = fileURLToPath(new URL("../apps/server/dist/cli.js", import.meta.url));
if (!existsSync(entry)) {
  console.error("claude-hub is not built yet. Run `pnpm install && pnpm build` in the repository.");
  process.exit(1);
}
const { main } = await import(pathToFileURL(entry).href);
await main(process.argv.slice(2)).catch((err) => {
  console.error(err?.message ?? err);
  process.exit(1);
});
