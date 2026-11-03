export type Config = { port: number; dataDir: string; host: "0.0.0.0" };

export function loadConfig(env: Record<string, string | undefined>): Config {
  return { port: Number(env.KOREMIND_PORT ?? 8787), dataDir: env.KOREMIND_DATA_DIR ?? "./data", host: "0.0.0.0" };
}
