"use client";

import { ImageOff } from "lucide-react";
import { memo, type ComponentProps } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { t } from "@/lib/i18n";
import { safeLinkHref } from "@/lib/preview";

/** Links keep only safe URLs (see `safeLinkHref`); the rest become plain text.
 *  External ones open in a new tab without referrer or opener. */
function SafeLink({ href, children, title }: ComponentProps<"a"> & { node?: unknown }) {
  const safe = safeLinkHref(href);
  if (!safe) return <span data-link-removed="">{children}</span>;
  if (!safe.external) return <a href={safe.href}>{children}</a>;
  return (
    <a href={safe.href} title={title} target="_blank" rel="noopener noreferrer nofollow">
      {children}
    </a>
  );
}

/** Images are never fetched: a remote one would leak the reader's IP, and
 *  the app loads nothing from other hosts. The alt text stands in. */
function BlockedImage({ alt }: ComponentProps<"img"> & { node?: unknown }) {
  const label = alt ? t("preview.imageBlocked", { alt }) : t("preview.imageBlockedNoAlt");
  return (
    <span data-image-placeholder="" className="kore-md-image" title={label}>
      <ImageOff aria-hidden="true" className="size-3.5" />
      {label}
    </span>
  );
}

const components: Components = { a: SafeLink, img: BlockedImage };

/**
 * Markdown via `react-markdown` + GFM. There is no `rehype-raw`, so raw HTML
 * in the source is shown as literal text and never becomes elements.
 */
export const MarkdownView = memo(function MarkdownView({ text }: { text: string }) {
  return (
    <div data-testid="markdown-view" className="kore-md mx-auto max-w-[760px] px-6 py-5">
      <Markdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </Markdown>
    </div>
  );
});
