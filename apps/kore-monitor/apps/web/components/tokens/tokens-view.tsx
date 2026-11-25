"use client";

import { Card, PageBody, PageHeader, Tabs, TabsContent, TabsList, TabsTrigger } from "@qarasky/kore-ui";
import { useState } from "react";

import { TOKEN_FAMILIES, type TokenFamily } from "@/lib/onboarding";

import { AddServersDialog } from "./add-servers-dialog";
import { BackupTokens } from "./backup-tokens";
import { ServerTokens } from "./server-tokens";
import { TokensList } from "./tokens-list";

/** What one family is for and how far it reaches, above its list. */
function FamilyCard({ id }: { id: TokenFamily }) {
    const family = TOKEN_FAMILIES.find((f) => f.id === id)!;
    return (
        <Card className="mb-6 grid gap-1 p-4 sm:grid-cols-[1fr_auto] sm:items-start sm:gap-x-6">
            <div className="min-w-0">
                <p>{family.use}</p>
                <p className="text-meta text-muted">{family.reach}</p>
            </div>
            <code className="text-meta text-muted sm:pt-0.5">{family.prefix}…</code>
        </Card>
    );
}

/**
 * The Tokens page: the three credential families side by side, each with what
 * it is for, plus "Add servers", the one task that needs a token most often.
 * People sign in with Kore ID; nothing here signs in to the web app.
 */
export function TokensView() {
    const [tab, setTab] = useState<TokenFamily>("operator");
    // Bumped when "Add servers" mints an operator token, so that list refetches.
    const [minted, setMinted] = useState(0);

    return (
        <>
            <PageHeader title="Tokens" actions={<AddServersDialog onTokenMinted={() => setMinted((n) => n + 1)} />} />
            <PageBody>
                <p className="mb-4 text-meta text-muted">
                    Tokens are for machines. People sign in with Kore ID, never with a token.
                </p>
                <Tabs value={tab} onValueChange={(v) => setTab(v as TokenFamily)}>
                    <TabsList variant="underline" aria-label="Token kinds" className="mb-6">
                        {TOKEN_FAMILIES.map((family) => (
                            <TabsTrigger key={family.id} value={family.id}>
                                {family.title}
                            </TabsTrigger>
                        ))}
                    </TabsList>
                    <TabsContent value="operator">
                        <FamilyCard id="operator" />
                        <TokensList reloadKey={minted} />
                    </TabsContent>
                    <TabsContent value="servers">
                        <FamilyCard id="servers" />
                        <ServerTokens />
                    </TabsContent>
                    <TabsContent value="backups">
                        <FamilyCard id="backups" />
                        <BackupTokens />
                    </TabsContent>
                </Tabs>
            </PageBody>
        </>
    );
}
