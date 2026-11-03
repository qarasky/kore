import type { ComboboxOption } from "@qarasky/kore-ui";

function offset(zone: string): string {
  try {
    const part = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "longOffset" })
      .formatToParts(new Date())
      .find((p) => p.type === "timeZoneName");
    return part?.value.replace("GMT", "UTC") || "UTC";
  } catch {
    return "";
  }
}

/** Every IANA zone the browser knows, labelled by city, with the current UTC offset. */
export const TIME_ZONES: ComboboxOption[] = (Intl.supportedValuesOf?.("timeZone") ?? ["UTC", "Asia/Almaty", "Europe/Berlin"]).map(
  (zone) => {
    const parts = zone.split("/");
    const city = (parts[parts.length - 1] ?? zone).replace(/_/g, " ");
    return { value: zone, label: city, description: offset(zone), keywords: parts.slice(0, -1) };
  },
);

const PEOPLE: ComboboxOption[] = [
  { value: "u1", label: "Anna Berg", description: "anna@northwind.example" },
  { value: "u2", label: "Dana Lee", description: "dana@northwind.example" },
  { value: "u3", label: "Lena Ivanova", description: "lena@northwind.example" },
  { value: "u4", label: "Marat Sultanov", description: "marat@northwind.example" },
  { value: "u5", label: "Sky Qarasky", description: "sky@qarasky.dev" },
  { value: "u6", label: "Tom Okafor", description: "tom@northwind.example" },
];

/** A fake server search (400ms), to show the async mode. */
export function searchPeople(query: string, signal: AbortSignal): Promise<ComboboxOption[]> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      const q = query.toLowerCase();
      resolve(PEOPLE.filter((p) => !q || p.label.toLowerCase().includes(q) || p.description!.includes(q)));
    }, 400);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new DOMException("aborted", "AbortError"));
    });
  });
}
