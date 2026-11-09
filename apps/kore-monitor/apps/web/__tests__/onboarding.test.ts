import { describe, expect, it } from "vitest";

import {
    TOKEN_FAMILIES,
    installCommand,
    onboardingLink,
    onboardingMessage,
    serverMonitorPayload,
} from "@/lib/onboarding";
import { expiresAt } from "@/lib/token-row";

describe("onboardingLink", () => {
    it("points at the runbook with the token, without a doubled slash", () => {
        expect(onboardingLink("https://uptime.example/", "kmon_op_abc")).toBe(
            "https://uptime.example/add-push-server.md?token=kmon_op_abc"
        );
    });

    it("encodes anything unsafe in a query", () => {
        expect(onboardingLink("https://u.example", "a+b&c")).toBe(
            "https://u.example/add-push-server.md?token=a%2Bb%26c"
        );
    });
});

describe("installCommand", () => {
    it("uses the push token to download and to configure, as the runbook does", () => {
        expect(installCommand("https://u.example", "kmon_agent_push_x")).toBe(
            "curl -fsSL 'https://u.example/agent/install.sh?token=kmon_agent_push_x' \\\n" +
                "  | sudo bash -s -- --server 'https://u.example' --token 'kmon_agent_push_x'"
        );
    });
});

describe("onboardingMessage", () => {
    it("carries the link and says when it stops working", () => {
        const text = onboardingMessage("https://u.example/add-push-server.md?token=t", "2026-12-09");
        expect(text).toContain("https://u.example/add-push-server.md?token=t");
        expect(text).toContain("It works until 2026-12-09.");
        expect(text).toContain("full operator access");
    });

    it("says so when it never expires", () => {
        expect(onboardingMessage("l", "never")).toContain("It does not expire.");
    });
});

describe("serverMonitorPayload", () => {
    it("makes the push monitor the runbook makes", () => {
        expect(serverMonitorPayload("web-01")).toEqual({
            name: "web-01",
            type: "push",
            interval: 20,
            maxretries: 2,
            retryInterval: 180,
        });
    });
});

describe("TOKEN_FAMILIES", () => {
    it("lists the three prefixes the backend issues", () => {
        expect(TOKEN_FAMILIES.map((f) => f.prefix)).toEqual(["kmon_op_", "kmon_agent_push_", "kmon_agent_backup_"]);
    });
});

describe("expiresAt 7d", () => {
    it("is seven days out", () => {
        expect(expiresAt("7d", Date.parse("2026-11-09T10:00:00Z"))).toBe("2026-11-16T10:00:00.000Z");
    });
});
