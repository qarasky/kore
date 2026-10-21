import { spawn, type ChildProcess } from "node:child_process";

/**
 * Runs `cmd` as the long-lived server of a harness script: forwards
 * SIGINT/SIGTERM to it, runs `cleanup` once, and exits with its status.
 */
export function serve(cmd: string, args: string[], env: NodeJS.ProcessEnv, cleanup = () => {}) {
  const child: ChildProcess = spawn(cmd, args, { stdio: "inherit", env });
  let cleaned = false;
  const done = () => {
    if (!cleaned) {
      cleaned = true;
      cleanup();
    }
  };
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => {
      child.kill("SIGTERM");
    });
  }
  child.on("exit", (code, signal) => {
    done();
    process.exit(code ?? (signal ? 0 : 1));
  });
  process.on("exit", () => {
    child.kill("SIGKILL");
    done();
  });
}
