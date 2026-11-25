// Fails unless react, react-dom and next are each installed exactly once in the workspace.
// Two copies of React (one for an app, another for kore-ui) break hooks at runtime.
// Usage: bun tools/check-single-copy.ts
import { readdirSync, realpathSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const names = ["react", "react-dom", "next"];
const found = new Map<string, Set<string>>(names.map((n) => [n, new Set()]));

function walk(dir: string) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    if (entry.name === ".git" || entry.name === ".next" || entry.name === ".turbo") continue;
    const path = join(dir, entry.name);
    if (entry.isSymbolicLink() && !statSync(path, { throwIfNoEntry: false })?.isDirectory()) continue;
    if (entry.name === "node_modules") scanNodeModules(path);
    else if (!entry.isSymbolicLink()) walk(path);
  }
}

function scanNodeModules(nm: string) {
  for (const name of names) {
    const pkg = join(nm, name, "package.json");
    if (existsSync(pkg)) found.get(name)!.add(realpathSync(join(nm, name)));
  }
  // Nested node_modules (e.g. node_modules/foo/node_modules/react).
  for (const entry of readdirSync(nm, { withFileTypes: true })) {
    const sub = entry.name.startsWith("@") ? readdirSync(join(nm, entry.name)).map((s) => join(entry.name, s)) : [entry.name];
    for (const s of sub) {
      const nested = join(nm, s, "node_modules");
      if (existsSync(nested)) scanNodeModules(nested);
    }
  }
}

walk(root);
let ok = true;
for (const [name, paths] of found) {
  if (paths.size !== 1) {
    ok = false;
    console.error(`${name}: ${paths.size} copies${paths.size ? ":\n  " + [...paths].join("\n  ") : ""}`);
  }
}
if (ok) console.log(`one copy each of ${names.join(", ")}`);
process.exit(ok ? 0 : 1);
