import { expect, test } from "bun:test";
import { normalizeBackendUrl } from "../lib/backend-url";

test("normalizeBackendUrl adds http, strips slash, rejects garbage", () => {
  expect(normalizeBackendUrl("192.168.1.20:8787")).toBe("http://192.168.1.20:8787");
  expect(normalizeBackendUrl("  localhost:8787/ ")).toBe("http://localhost:8787");
  expect(normalizeBackendUrl("https://zero.example.com/")).toBe("https://zero.example.com");
  expect(normalizeBackendUrl("http://zero.example.com/base/?x=1#y")).toBe("http://zero.example.com/base");
  expect(normalizeBackendUrl("")).toBeNull();
  expect(normalizeBackendUrl("not a url!!")).toBeNull();
  expect(normalizeBackendUrl("ftp://host")).toBeNull();
});
