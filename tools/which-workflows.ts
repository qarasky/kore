// Which workflows does a pull request (or a push to main) run, given the files it changes? Reads
// each workflow's `on.<event>.paths`; a workflow without a paths filter runs on every such event.
// Tag pushes are not modelled: GitHub does not evaluate path filters for them.
// Usage: bun tools/which-workflows.ts <changed-file>...   (or: git diff --name-only main | xargs bun tools/which-workflows.ts)
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const WORKFLOWS = join(import.meta.dir, "../.github/workflows");

/** GitHub's path globs: `**` crosses directories, `*` and `?` stay within one segment. */
export function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === "*" && glob[i + 1] === "*") {
      re += ".*";
      i++;
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

export function workflowsFor(files: string[], dir = WORKFLOWS, event: "pull_request" | "push" = "pull_request"): string[] {
  const hits: string[] = [];
  for (const name of readdirSync(dir).filter((f) => f.endsWith(".yml")).sort()) {
    const raw = (Bun.YAML.parse(readFileSync(join(dir, name), "utf8")) as { on?: unknown }).on;
    // `on:` is a string, a list of event names, or a map of events to their filters.
    const on: Record<string, unknown> =
      typeof raw === "string" ? { [raw]: null } : Array.isArray(raw) ? Object.fromEntries(raw.map((e) => [e, null])) : ((raw as Record<string, unknown>) ?? {});
    if (!(event in on)) continue;
    const filter = on[event] as { paths?: string[]; branches?: string[] } | null;
    if (event === "push" && filter?.branches && !filter.branches.includes("main")) continue;
    if (event === "push" && !filter?.branches && (filter as { tags?: unknown } | null)?.tags) continue; // tags only
    const paths = filter?.paths;
    const res = (paths ?? ["**"]).map(globToRegExp);
    if (files.some((f) => res.some((r) => r.test(f)))) hits.push(name.replace(/\.yml$/, ""));
  }
  return hits;
}

if (import.meta.main) console.log(workflowsFor(process.argv.slice(2)).join("\n"));
