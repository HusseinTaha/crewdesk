// The published package's version (root package.json), inlined at build time; `npm version` keeps it current.
import pkg from "../../../package.json" with { type: "json" };

export const VERSION: string = pkg.version;
