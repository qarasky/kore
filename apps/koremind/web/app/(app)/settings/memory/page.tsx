"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Memory now lives inside Settings. This keeps old links working. */
export default function MemoryRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace("/settings#memory"); }, [router]);
  return null;
}
