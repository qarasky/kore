/**
 * Adding servers: the three credential families, the onboarding link that
 * carries an operator token, and the install command that carries a push
 * token. Pure helpers, so the Tokens page and its tests share the strings.
 */

/** What each credential family is for, in the order the Tokens page lists them. */
export const TOKEN_FAMILIES = [
    {
        id: "operator",
        title: "Operator tokens",
        prefix: "kmon_op_",
        use: "Scripts, integrations and AI agents that set things up.",
        reach: "Full operator access to the API. Treat it like a password.",
    },
    {
        id: "servers",
        title: "Server agent tokens",
        prefix: "kmon_agent_push_",
        use: "The agent on one server, in /etc/superboard/config.json.",
        reach: "Reports that one server and downloads agent updates. Nothing else.",
    },
    {
        id: "backups",
        title: "Backup agent tokens",
        prefix: "kmon_agent_backup_",
        use: "The backup agent on one server.",
        reach: "Uploads that agent's backups. Nothing else.",
    },
] as const;

export type TokenFamily = (typeof TOKEN_FAMILIES)[number]["id"];

/** The push monitor a new server gets, matching docs/provisioning.md. */
export function serverMonitorPayload(name: string): Record<string, unknown> {
    return { name, type: "push", interval: 20, maxretries: 2, retryInterval: 180 };
}

/** The runbook link, with the operator token that the reader (or their AI agent) works with. */
export function onboardingLink(origin: string, token: string): string {
    return `${trim(origin)}/add-push-server.md?token=${encodeURIComponent(token)}`;
}

/** The install command for one server: its push token both downloads the agent and configures it. */
export function installCommand(origin: string, pushToken: string): string {
    const base = trim(origin);
    return (
        `curl -fsSL '${base}/agent/install.sh?token=${encodeURIComponent(pushToken)}' \\\n` +
        `  | sudo bash -s -- --server '${base}' --token '${pushToken}'`
    );
}

/** A ready-to-send note for whoever adds the servers. `expires` is a date or "never". */
export function onboardingMessage(link: string, expires: string): string {
    const until = expires === "never" ? "It does not expire." : `It works until ${expires}.`;
    return [
        "To add our servers to KoreMonitor, open this link or give it to your AI agent:",
        "",
        link,
        "",
        "It has everything needed to install the agent on each server and add its websites.",
        `The token in it has full operator access, so keep it private. ${until}`,
    ].join("\n");
}

const trim = (origin: string) => origin.replace(/\/+$/, "");
