import { spawn, type ChildProcess } from "node:child_process";

export type Proc = { cmd: string; args: string[]; env: NodeJS.ProcessEnv };

/**
 * Runs `procs` as the long-lived servers of a harness script: forwards
 * SIGINT/SIGTERM to them, stops all when any exits, runs `cleanup` once, and
 * exits with the first child's status.
 */
export function serve(procs: Proc[], cleanup = () => {}) {
  const children: ChildProcess[] = procs.map((p) =>
    spawn(p.cmd, p.args, { stdio: "inherit", env: p.env }),
  );
  let cleaned = false;
  const done = () => {
    if (!cleaned) {
      cleaned = true;
      cleanup();
    }
  };
  const killAll = (sig: NodeJS.Signals) => {
    for (const c of children) if (c.exitCode === null && c.signalCode === null) c.kill(sig);
  };
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => killAll("SIGTERM"));
  }
  for (const child of children) {
    child.on("exit", (code, signal) => {
      killAll("SIGTERM");
      done();
      process.exit(code ?? (signal ? 0 : 1));
    });
  }
  process.on("exit", () => {
    killAll("SIGKILL");
    done();
  });
}
