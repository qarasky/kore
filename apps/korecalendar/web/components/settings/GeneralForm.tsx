"use client";

import { useState } from "react";
import { useMutate } from "@/hooks/useMutate";
import { t } from "@/lib/i18n";
import { updateTimezone } from "@/lib/mutations";
import { PREF_COOKIES, writePref } from "@/lib/prefs";
import { Field } from "../Field";
import { Select } from "../Select";
import { useShell } from "../ShellContext";
import { TimezoneSelect } from "../TimezoneSelect";
import { SettingsSection } from "./Section";

/** Time zone (saved to the account) and display preferences (cookies). Each change saves at once. */
export function GeneralForm() {
  const { me, prefs } = useShell();
  const { run } = useMutate();
  const [tz, setTz] = useState(me.timezone);

  return (
    <SettingsSection title={t("general.heading")}>
      <div className="flex flex-col gap-5">
        <Field label={t("general.timezone")} hint={t("general.timezoneHint")}>
          <TimezoneSelect
            value={tz}
            ariaLabel={t("general.timezone")}
            onChange={async (next) => {
              const previous = tz;
              setTz(next);
              const ok = await run(() => updateTimezone(next), { message: t("general.saved") });
              if (!ok) setTz(previous);
            }}
          />
        </Field>
        <Field label={t("general.weekStart")}>
          <Select
            aria-label={t("general.weekStart")}
            value={prefs.weekStart}
            options={[
              { value: "mon", label: t("general.mon") },
              { value: "sun", label: t("general.sun") },
              { value: "sat", label: t("general.sat") },
            ]}
            onChange={(v) => {
              writePref(PREF_COOKIES.weekStart, v);
              void run(async () => undefined, { message: t("general.saved") });
            }}
          />
        </Field>
        <Field label={t("general.clock")}>
          <Select
            aria-label={t("general.clock")}
            value={prefs.clock}
            options={[
              { value: "24h", label: t("general.24h") },
              { value: "12h", label: t("general.12h") },
            ]}
            onChange={(v) => {
              writePref(PREF_COOKIES.clock, v);
              void run(async () => undefined, { message: t("general.saved") });
            }}
          />
        </Field>
        <Field label={t("general.motion")} hint={t("general.motionHint")}>
          <Select
            aria-label={t("general.motion")}
            value={prefs.motion}
            options={[
              { value: "system", label: t("general.motionSystem") },
              { value: "reduce", label: t("general.motionReduce") },
              { value: "full", label: t("general.motionFull") },
            ]}
            onChange={(v) => {
              writePref(PREF_COOKIES.motion, v);
              void run(async () => undefined, { message: t("general.saved") });
            }}
          />
        </Field>
      </div>
    </SettingsSection>
  );
}
