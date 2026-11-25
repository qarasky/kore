import { AppFrame } from "@/components/AppFrame";
import { BrowserProvider } from "@/components/BrowserContext";
import { UploadProvider } from "@/components/UploadContext";
import { api } from "@/lib/api";
import { getAuthConfig } from "@/lib/authConfig";
import type { Usage } from "@/lib/nodes";
import { requireUser } from "@/lib/session";

/** App shell (kore-ui AppShell): top bar, sidebar, content panel. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const usage = await api<Usage>("/api/me/usage");
  const auth = await getAuthConfig();
  const koreId = {
    accountUrl: auth.oidc && auth.issuer ? `${auth.issuer}/account` : undefined,
    apps: auth.oidc ? auth.apps : undefined,
  };

  return (
    <BrowserProvider>
      <UploadProvider>
        <AppFrame user={{ email: user.email, role: user.role }} usage={usage} koreId={koreId}>
          {children}
        </AppFrame>
      </UploadProvider>
    </BrowserProvider>
  );
}
