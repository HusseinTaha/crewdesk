#!/usr/bin/env node
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const entry = fileURLToPath(new URL("../apps/server/dist/cli.js", import.meta.url));
if (!existsSync(entry)) {
  console.error("crewdesk is not built yet. Run `pnpm install && pnpm build` in the repository.");
  process.exit(1);
}
// Node 22 warns that node:sqlite is experimental on every command. Hide just that warning; it has to be
// installed here, before the bundle (whose node:sqlite import is hoisted) is loaded.
const emitWarning = process.emitWarning.bind(process);
process.emitWarning = (warning, ...rest) => {
  const type = typeof rest[0] === "string" ? rest[0] : rest[0]?.type ?? warning?.name;
  if (type === "ExperimentalWarning" && /sqlite/i.test(String(warning?.message ?? warning))) return;
  return emitWarning(warning, ...rest);
};

const { main } = await import(pathToFileURL(entry).href);
await main(process.argv.slice(2)).catch((err) => {
  console.error(err?.message ?? err);
  process.exit(1);
});
