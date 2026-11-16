# Rich messages

What an assistant answer can look like. Web and Android draw the same things from the same rules.

## Markdown

Headings, bold, italic, ~~strikethrough~~, links, quotes, rules, bullet and numbered lists (nested), GFM tables, fenced code (with a language label and a **Copy** button) and images. Tables right-align a column when every cell in it is a number, amount, range or dash (or follow the `:---:` alignment written in the table). Only `https://` images are drawn, with the site's name on a chip in the corner; anything else stays a link. Raw HTML is never rendered.

Not in v1: math, diagrams, syntax colouring.

## Cards

A fenced block tagged `card` holding one JSON object becomes a card:

````
```card
{
  "title": "KuroFi: new dividend policy",
  "badge": { "text": "Approved", "tone": "good" },
  "sections": [
    { "type": "stats", "items": [
      { "label": "Previous annual dividend", "value": "€54,000" },
      { "label": "New annual dividend", "value": "€60,000", "tone": "good" } ] },
    { "type": "table", "columns": ["Shareholder", "Annual"], "rows": [["Skyler (90%)", "€60,000"], ["Total", "€66,667"]], "totalRow": true },
    { "type": "bars", "items": [{ "label": "Deposits", "value": "€703,942", "share": 0.74 }] },
    { "type": "note", "text": "Paid through approved quarterly distributions." }
  ]
}
```
````

| Part | Notes |
|---|---|
| `title`, `subtitle` | optional text |
| `badge` | `{text, tone}`; a card with only a badge is just the pill |
| `tone` | `neutral` (default), `good`, `warn`, `bad`, `info`; an unknown tone is ignored |
| `stats` | 1–4 big numbers: `label`, `value`, optional `tone` (colours the value) |
| `table` | `columns` (≤ 6), `rows` (≤ 40, padded or cut to the column count), `totalRow` makes the last row bold |
| `bars` | ≤ 12 items: `label`, `value`, `share` 0–1 (clamped), optional `tone`; without one the bars cycle green, blue, amber |
| `note` | a muted paragraph |

At most 8 sections. Numbers are accepted for values and read as text. Unknown section types are dropped; a card with nothing usable left is not a card.

**The rules live in one place.** [`shared/src/cards.ts`](../shared/src/cards.ts) (web) and `ui/chat/Card.kt` (Android) apply the same limits and fallbacks, and both test suites run [`shared/fixtures/cards.json`](../shared/fixtures/cards.json). Change a rule in one, change the fixture, and the other fails until it follows.

**Streaming.** While the JSON is still arriving the card shows a placeholder. If the block closes and is not a usable card, it is shown as a plain code block, never as a broken card.

**When the assistant uses one.** The system prompt (`AGENT_SYSTEM` in `backend/src/engine/opencode.ts`) allows a card for a status, or a total with its breakdown, at most two per answer, and says a plain comparison is a Markdown table.
