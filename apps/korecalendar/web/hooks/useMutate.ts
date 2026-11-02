"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { useToast, type ToastOptions } from "@/components/Toast";
import { errorMessage } from "@/lib/errors";

/**
 * Runs an API mutation: shows a toast with the mapped error message when it
 * fails, and on success optionally toasts and refreshes the server data.
 * `run` resolves to the mutation's result, or `undefined` after a failure.
 */
export function useMutate() {
  const router = useRouter();
  const toast = useToast();
  const [pending, setPending] = useState(false);

  const run = useCallback(
    async <T,>(fn: () => Promise<T>, success?: { message: string; options?: ToastOptions }): Promise<T | undefined> => {
      setPending(true);
      try {
        const result = await fn();
        if (success) toast(success.message, success.options);
        router.refresh();
        return result;
      } catch (e) {
        toast(errorMessage(e), { kind: "error" });
        return undefined;
      } finally {
        setPending(false);
      }
    },
    [router, toast],
  );

  return { run, pending };
}
