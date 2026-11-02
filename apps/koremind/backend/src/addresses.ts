import type { NetworkInterfaceInfo } from "node:os";

export type Address = { label: "local" | "tailscale" | "domain"; url: string };

const isTailscale = (ip: string) => {
  const [a, b] = ip.split(".").map(Number);
  return a === 100 && b >= 64 && b <= 127; // CGNAT range used by Tailscale
};

export function listAddresses(ifaces: Record<string, NetworkInterfaceInfo[] | undefined>, port: number, env: Record<string, string | undefined>): Address[] {
  const v4 = Object.values(ifaces).flatMap((l) => l ?? []).filter((i) => i.family === "IPv4" && !i.internal).map((i) => i.address);
  const out: Address[] = v4.filter((ip) => !isTailscale(ip)).map((ip) => ({ label: "local" as const, url: `http://${ip}:${port}` }));
  if (!out.length) out.push({ label: "local", url: `http://localhost:${port}` });
  for (const ip of v4.filter(isTailscale)) out.push({ label: "tailscale", url: `http://${ip}:${port}` });
  if (env.ZERO_PUBLIC_URL) out.push({ label: "domain", url: env.ZERO_PUBLIC_URL.replace(/\/$/, "") });
  return out;
}
