import { TokensManager } from "@/components/settings/TokensManager";
import { api } from "@/lib/api";
import { t } from "@/lib/i18n";
import type { Token } from "@/lib/types";

export const metadata = { title: t("settings.tokens") };

export default async function TokensSettingsPage() {
  const tokens = await api<Token[]>("/api/tokens");
  return <TokensManager initial={tokens} />;
}
