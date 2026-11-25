/** Chat titles: ask the chosen model for a short one, then make the answer safe to show in a list. */
export const TITLE_SYSTEM = "You name chats so a person can find them later in a list. Reply with a title of at most 5 words that says what the chat is about, in the same language as the user. Reply with the title only: no quotes, no trailing punctuation, no explanation.";

export const titlePrompt = (userText: string, assistantText: string) =>
  `User: ${userText.slice(0, 400)}\n\nAssistant: ${assistantText.slice(0, 400)}`;

/** Returns a clean one-line title, or null when the model gave nothing usable. */
export function cleanTitle(raw: string): string | null {
  const line = raw.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  const t = line
    .replace(/^(title\s*:\s*)/i, "")
    .replace(/^[#>*\-\s]+/, "")
    .replace(/^["'`\u201c\u2018]+|["'`\u201d\u2019]+$/g, "")
    .replace(/[.!?:;,\s]+$/, "")
    .replace(/\s+/g, " ")
    .slice(0, 60)
    .trim();
  if (!t || /^[{\[]/.test(t)) return null;
  return t;
}
