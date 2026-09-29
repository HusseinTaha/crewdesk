import { defineConfig } from "tsup";

export default defineConfig({
  entry: { hook: "src/cli.ts" },
  format: ["esm"],
  platform: "node",
  target: "node22",
  outDir: "dist",
  clean: true,
  removeNodeProtocol: false,
  noExternal: [/.*/],
});
