"use client";

import { createContext, useContext, type ComponentType, type ReactNode, type Ref } from "react";

/** Props kore-ui passes to a link. Next's `Link` and a plain `<a>` both accept them. */
export type LinkProps = {
  href: string;
  className?: string;
  children?: ReactNode;
  onClick?: React.MouseEventHandler<HTMLAnchorElement>;
  ref?: Ref<HTMLAnchorElement>;
  target?: string;
  rel?: string;
  title?: string;
  "aria-current"?: React.AriaAttributes["aria-current"];
  "aria-label"?: string;
} & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href">;

/** A component that renders a link, e.g. Next's `Link`. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type LinkComponent = ComponentType<any>;

function PlainLink({ ref, ...props }: LinkProps) {
  return <a ref={ref} {...props} />;
}

const LinkContext = createContext<LinkComponent>(PlainLink);

/** Sets the link component kore-ui uses for in-app links (default: a plain `<a>`). */
export function LinkProvider({ component, children }: { component: LinkComponent; children: ReactNode }) {
  return <LinkContext value={component}>{children}</LinkContext>;
}

/** The link component to use: an explicit override, else the provider's, else `<a>`. */
export function useLinkComponent(override?: LinkComponent): LinkComponent {
  const fromContext = useContext(LinkContext);
  return override ?? fromContext;
}

/** True for links that leave the app (full URL or protocol-relative). */
export function isExternalHref(href: string): boolean {
  return /^([a-z][a-z\d+.-]*:|\/\/)/i.test(href);
}

export { PlainLink };
