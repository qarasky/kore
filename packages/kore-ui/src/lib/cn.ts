import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/** tailwind-merge that knows Kore's custom font-size tokens (so `text-meta` and `text-danger` don't clash). */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["2xs", "meta", "sub", "heading", "title", "brand", "display"] }],
    },
  },
});

/** Join class names (clsx) and let later Tailwind classes win (tailwind-merge). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
