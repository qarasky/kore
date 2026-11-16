"use client";
import { parseCard } from "@koremind/shared";
import { CodeBlock } from "@qarasky/kore-ui";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CardPlaceholder, RichCard } from "./RichCard";
import { fenceLanguage, hastText, hostOf, numericColumnsPlugin, safeImageSrc, type HastNode } from "@/lib/rich-ui";
import { t } from "@/lib/strings";

/** An assistant answer: Markdown (tables, code with a copy button, images) plus ```card blocks. `live` = still streaming. */
export function Markdown({ text, live = false }: { text: string; live?: boolean }) {
  return (
    <div className="koremind-md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[numericColumnsPlugin]}
        components={{
          a: (p) => <a {...p} target="_blank" rel="noopener noreferrer" />,
          pre: ({ node }) => <Fence node={node as HastNode | undefined} live={live} />,
          table: ({ node: _n, ...p }) => <div className="overflow-x-auto"><table {...p} /></div>,
          img: ({ src, alt }) => <Picture src={typeof src === "string" ? src : undefined} alt={alt ?? ""} />,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

function Fence({ node, live }: { node: HastNode | undefined; live: boolean }) {
  const code = node?.children?.find((c) => c.type === "element" && c.tagName === "code");
  const lang = fenceLanguage(code?.properties?.className);
  const body = code ? hastText(code).replace(/\n$/, "") : "";
  if (lang === "card") {
    const card = parseCard(body);
    if (card) return <RichCard card={card} />;
    if (live) return <CardPlaceholder />; // the JSON is still arriving
  }
  return <CodeBlock language={lang || undefined} value={body} copy={{ label: t.copy, copiedLabel: t.copied, failedLabel: t.copyFailed }} />;
}

function Picture({ src, alt }: { src: string | undefined; alt: string }) {
  const safe = safeImageSrc(src);
  if (!safe) return alt ? <span>{alt}</span> : null;
  return (
    <a href={safe} target="_blank" rel="noopener noreferrer" aria-label={`${t.imageOpen}: ${alt || hostOf(safe)}`} className="relative my-1 block overflow-hidden rounded-overlay border border-border no-underline">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={safe} alt={alt} loading="lazy" referrerPolicy="no-referrer" className="block h-auto w-full" />
      <span className="absolute bottom-2 left-2 rounded-full bg-black/55 px-2.5 py-0.5 text-meta text-white">{hostOf(safe)}</span>
    </a>
  );
}
