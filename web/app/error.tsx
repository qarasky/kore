"use client";

import { ErrorView } from "@/components/error-view";

// `retry()` (Next 16.3+) re-fetches the Server Component payload, which is
// what an API outage needs; `reset()` would only re-render the stale error.
export default function ErrorPage({ error, retry }: { error: unknown; retry: () => void }) {
  return <ErrorView error={error} retry={retry} />;
}
