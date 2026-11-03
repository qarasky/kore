"use client";

import { Button, IconButton, Input } from "@qarasky/kore-ui";
import { Check, Circle, Eye, EyeOff } from "lucide-react";
import { useId, useState } from "react";
import { t } from "@/lib/i18n";
import { generatePassword, passwordHints } from "@/lib/password";

// kore-ui has no password field: an Input with a show/hide IconButton (and an
// optional generator and strength hints), for use inside a kore-ui Field.

/**
 * Password input with show/hide, and for new passwords an optional generator
 * (which reveals the generated value so it can be read or copied) and the
 * strength hints. `autoComplete` is `new-password` unless it is the current
 * password, so browsers never autofill an old one into a new-password field.
 */
export function PasswordInput({
  value,
  onChange,
  current = false,
  generate = false,
  hints = false,
  disabled,
  id,
  autoFocus,
  autoComplete,
  placeholder,
  invalid,
}: {
  /** Mark it invalid outside a Field (inside one, the Field's error does it). */
  invalid?: boolean;
  id?: string;
  autoFocus?: boolean;
  /** Overrides the default (current-password / new-password). */
  autoComplete?: string;
  placeholder?: string;
  value: string;
  onChange: (value: string, generated: boolean) => void;
  current?: boolean;
  generate?: boolean;
  hints?: boolean;
  disabled?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const hintsId = `${useId()}-strength`;
  const h = passwordHints(value);
  const items: [boolean, string][] = [
    [h.minLength, t("password.hint.minLength")],
    [h.long, t("password.hint.long")],
    [h.mixed, t("password.hint.mixed")],
  ];
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-2">
        <Input
          type={visible ? "text" : "password"}
          id={id}
          autoFocus={autoFocus}
          placeholder={placeholder}
          aria-invalid={invalid || undefined}
          autoComplete={autoComplete ?? (current ? "current-password" : "new-password")}
          spellCheck={false}
          autoCapitalize="off"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value, false)}
          aria-describedby={hints ? hintsId : undefined}
          className="font-mono"
        />
        <IconButton
          variant="secondary"
          size="md"
          aria-pressed={visible}
          label={visible ? t("password.hide") : t("password.show")}
          icon={visible ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
          onClick={() => setVisible((v) => !v)}
          disabled={disabled}
        />
        {generate && (
          <Button
            aria-label={t("password.generateLabel")}
            disabled={disabled}
            onClick={() => {
              setVisible(true);
              onChange(generatePassword(), true);
            }}
          >
            {t("password.generate")}
          </Button>
        )}
      </div>
      {hints && (
        <ul id={hintsId} aria-label={t("password.hints")} className="flex flex-col gap-0.5 text-meta">
          {items.map(([met, label]) => (
            <li key={label} data-met={met} className={`flex items-center gap-1.5 ${met ? "text-text" : "text-muted"}`}>
              {met ? (
                <Check aria-hidden className="size-3.5 text-accent" />
              ) : (
                <Circle aria-hidden className="size-3.5" />
              )}
              {label}
              <span className="sr-only">{met ? t("password.hintMet") : t("password.hintUnmet")}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

