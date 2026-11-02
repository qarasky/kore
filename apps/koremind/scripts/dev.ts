// One command to run Zero: backend (port 8787) and the web UI (port 3210) as separate processes.
import { existsSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const procs: ReturnType<typeof Bun.spawn>[] = [];
procs.push(Bun.spawn(["bun", "run", join(root, "backend/src/index.ts")], { stdout: "inherit", stderr: "inherit", env: process.env }));
if (existsSync(join(root, "web/package.json"))) {
  const mode = process.env.ZERO_WEB_MODE === "dev" ? "dev" : "start";
  if (mode === "start" && !existsSync(join(root, "web/.next"))) {
    await Bun.spawn(["bun", "run", "build"], { cwd: join(root, "web"), stdout: "inherit", stderr: "inherit" }).exited;
  }
  procs.push(Bun.spawn(["bun", "run", mode, "-p", process.env.ZERO_WEB_PORT ?? "3210"], { cwd: join(root, "web"), stdout: "inherit", stderr: "inherit", env: process.env }));
  console.log(`Zero web UI: http://localhost:${process.env.ZERO_WEB_PORT ?? "3210"}`);
}
const stop = () => { for (const p of procs) p.kill(); process.exit(0); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
await Promise.race(procs.map((p) => p.exited));
stop();
