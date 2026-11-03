import type { ReactNode } from "react";
import { SettingsFrame } from "@/components/settings/SettingsFrame";

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return <SettingsFrame>{children}</SettingsFrame>;
}
