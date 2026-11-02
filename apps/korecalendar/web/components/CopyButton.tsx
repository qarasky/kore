"use client";

import { useState } from "react";
import { t } from "@/lib/i18n";
import { Button } from "./Button";

/** Copies `value` to the clipboard and says so for a moment. */
export function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      small
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          // Clipboard unavailable (insecure context): the value is selectable on screen.
        }
      }}
    >
      {copied ? t("tokens.copied") : t("tokens.copy")}
    </Button>
  );
}
