import { mkdirSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import { listAddresses } from "./addresses";
import { loadConfig } from "./config";
import { openDb } from "./db";
import { FakeEngine } from "./engine/fake";
import { createOpencodeEngine } from "./engine/opencode";
import { createApp } from "./http";
import { createServices } from "./services";

const config = loadConfig(process.env);
mkdirSync(config.dataDir, { recursive: true });
const engine = process.env.ZERO_FAKE_ENGINE
  ? new FakeEngine({ reply: (a) => [{ type: "delta", text: `(fake engine) You said: ${a.text}` }], delayMs: 20, titleReply: "Fake engine chat", completeDelayMs: 400 })
  : await createOpencodeEngine({ dataDir: config.dataDir, bin: process.env.ZERO_OPENCODE_BIN });

const version = (await Bun.file(join(import.meta.dir, "../package.json")).json()).version ?? "0.1.0";
let servicePort = config.port;
const services = createServices({ db: openDb(join(config.dataDir, "zero.sqlite")), dataDir: config.dataDir, engine, version, addresses: () => listAddresses(networkInterfaces(), servicePort, process.env).map((a) => a.url) });
const app = createApp(services, { trustProxy: process.env.ZERO_TRUST_PROXY === "1" });

const server = Bun.serve({
  hostname: config.host,
  port: config.port,
  idleTimeout: 255,
  fetch: (req, srv) => app.fetch(req, srv.requestIP(req)?.address),
});

servicePort = server.port ?? config.port;
console.log(`Zero backend ${version} is running${process.env.ZERO_FAKE_ENGINE ? " (fake engine)" : ""}. Point the apps at:`);
for (const a of listAddresses(networkInterfaces(), server.port ?? config.port, process.env)) console.log(`  ${a.label.padEnd(9)} ${a.url}`);

const stop = () => { engine.close(); server.stop(); process.exit(0); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
