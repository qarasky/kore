import { expect, test } from "bun:test";
import { listAddresses } from "../src/addresses";

const nic = (address: string, internal = false, family = "IPv4") => ({ address, internal, family }) as any;

test("lists local IPs, a tailscale address and the public domain", () => {
  const out = listAddresses({ en0: [nic("192.168.1.20"), nic("fe80::1", false, "IPv6")], lo0: [nic("127.0.0.1", true)], utun4: [nic("100.101.102.103")] }, 8787, { KOREMIND_PUBLIC_URL: "https://koremind.example.com" });
  expect(out).toEqual([
    { label: "local", url: "http://192.168.1.20:8787" },
    { label: "tailscale", url: "http://100.101.102.103:8787" },
    { label: "domain", url: "https://koremind.example.com" },
  ]);
});

test("falls back to localhost when there is no network", () => {
  expect(listAddresses({}, 9000, {})).toEqual([{ label: "local", url: "http://localhost:9000" }]);
});

test("bound to loopback, only the public domain (or localhost) is offered: LAN and Tailscale can't reach it", () => {
  const ifaces = { en0: [nic("192.168.1.20")], utun4: [nic("100.101.102.103")] };
  expect(listAddresses(ifaces, 4111, { KOREMIND_PUBLIC_URL: "https://mind-api.example.com/" }, "127.0.0.1")).toEqual([{ label: "domain", url: "https://mind-api.example.com" }]);
  expect(listAddresses(ifaces, 4111, {}, "127.0.0.1")).toEqual([{ label: "local", url: "http://localhost:4111" }]);
});

test("bound to one interface, only that address is offered", () => {
  const ifaces = { en0: [nic("192.168.1.20")], utun4: [nic("100.101.102.103")] };
  expect(listAddresses(ifaces, 8787, {}, "100.101.102.103")).toEqual([{ label: "tailscale", url: "http://100.101.102.103:8787" }]);
  expect(listAddresses(ifaces, 8787, {}, "0.0.0.0")).toHaveLength(2);
});
