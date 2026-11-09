import type { Metadata } from "next";

import { TokensView } from "@/components/tokens/tokens-view";
export const metadata: Metadata = { title: "Tokens · KoreMonitor" };

export default function TokensPage() {
    return <TokensView />;
}
