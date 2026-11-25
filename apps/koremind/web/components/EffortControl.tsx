"use client";
import { IconButton, Popover, PopoverContent, PopoverTrigger, cn } from "@qarasky/kore-ui";
import { Gauge } from "lucide-react";
import { useModelChoice } from "@/lib/contexts";
import { effortAt, effortIndex, effortLabel, effortStops } from "@/lib/effort";
import { t } from "@/lib/strings";

/** The thinking level of the chosen model: a gauge button next to the model chip that opens a slider. Hidden when the model has no levels. */
export function EffortControl() {
  const { providers, choice, setThinking } = useModelChoice();
  const levels = providers.find((p) => p.id === choice?.providerId)?.models.find((m) => m.id === choice?.modelId)?.thinkingLevels ?? [];
  if (levels.length === 0) return null;

  const stops = effortStops(levels);
  const index = effortIndex(levels, choice?.thinking);
  const current = effortAt(levels, index);
  const label = effortLabel(current);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <IconButton label={`${t.thinkingLevel}: ${label}`} icon={<Gauge className={cn(current && "text-accent")} />} className="data-[state=open]:bg-hover" />
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-64" aria-label={t.thinkingLevel}>
        <div className="mb-3 text-sub font-medium">{label}</div>
        <input
          type="range" min={0} max={stops.length - 1} step={1} value={index}
          aria-label={t.thinkingLevel} aria-valuetext={label}
          onChange={(e) => setThinking(effortAt(levels, Number(e.target.value)))}
          className="h-2 w-full cursor-pointer accent-accent"
        />
        <div aria-hidden className="mt-1 flex justify-between px-1">
          {stops.map((s, i) => <span key={s ?? "default"} className={cn("size-1.5 rounded-full", i <= index ? "bg-accent" : "bg-border-strong")} />)}
        </div>
      </PopoverContent>
    </Popover>
  );
}
