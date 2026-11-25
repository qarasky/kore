import type { Metadata } from "next";

import { PageHeader } from "@qarasky/kore-ui";
import { ServersList } from "@/components/servers/servers-list";
import { AddServersDialog } from "@/components/tokens/add-servers-dialog";

export const metadata: Metadata = { title: "Servers · KoreMonitor" };

export default function ServersPage() {
    return (
        <>
            <PageHeader title="Servers" actions={<AddServersDialog />} />
            <ServersList />
        </>
    );
}
