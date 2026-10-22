"use client";

import { useRef, useState, type ChangeEvent } from "react";
import { api } from "@/lib/api";
import { checkLoginImageFile, LOGIN_IMAGE_TYPES, loginImageError, loginImageSrc, type Branding } from "@/lib/branding";
import { t } from "@/lib/i18n";
import { LoginArt } from "../LoginArt";
import { useToast } from "../Toast";
import { primaryButton, secondaryButton } from "./fields";

/** Admin Settings: the picture next to the login form (upload / reset). */
export function LoginImageCard({ initial }: { initial: Branding | null }) {
  const [branding, setBranding] = useState<Branding | null>(initial);
  const [pending, setPending] = useState<"upload" | "reset" | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const src = loginImageSrc(branding);

  async function onPick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const problem = checkLoginImageFile(file);
    if (problem) {
      toast.show({ message: t(problem), tone: "error" });
      return;
    }
    const body = new FormData();
    body.append("file", file);
    setPending("upload");
    try {
      setBranding(await api<Branding>("/api/admin/branding/login-image", { method: "POST", body }));
      toast.show({ message: t("branding.uploaded") });
    } catch (err) {
      toast.show({ message: t(loginImageError(err)), tone: "error" });
    } finally {
      setPending(null);
    }
  }

  async function reset() {
    setPending("reset");
    try {
      setBranding(await api<Branding>("/api/admin/branding/login-image", { method: "DELETE" }));
      toast.show({ message: t("branding.resetDone") });
    } catch (err) {
      toast.show({ message: t(loginImageError(err)), tone: "error" });
    } finally {
      setPending(null);
    }
  }

  return (
    <section aria-labelledby="login-image-heading" data-testid="login-image-card" className="mx-auto max-w-[640px] px-6 pb-8">
      <div className="space-y-4 border-t border-border pt-6">
        <div>
          <h2 id="login-image-heading" className="text-title font-semibold tracking-[-0.01em]">
            {t("branding.title")}
          </h2>
          <p className="mt-1 text-meta text-muted">{t("branding.hint")}</p>
        </div>
        <figure className="relative aspect-video w-full max-w-[400px] overflow-hidden rounded-ui border border-border bg-[#111522]">
          {src ? (
            // eslint-disable-next-line @next/next/no-img-element -- served by the API, not next/image
            <img
              key={src}
              src={src}
              alt={t("branding.preview")}
              data-testid="login-image-preview"
              className="absolute inset-0 size-full object-cover"
            />
          ) : (
            <LoginArt className="absolute inset-0 size-full" />
          )}
          <figcaption className="absolute bottom-2 left-2 rounded-ui bg-black/60 px-2 py-0.5 text-meta" data-testid="login-image-kind">
            {src ? t("branding.custom") : t("branding.default")}
          </figcaption>
        </figure>
        <p className="text-meta text-warning">{t("branding.public")}</p>
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={inputRef}
            type="file"
            accept={LOGIN_IMAGE_TYPES.join(",")}
            onChange={onPick}
            className="hidden"
            data-testid="login-image-input"
          />
          <button
            type="button"
            disabled={pending !== null}
            aria-busy={pending === "upload" || undefined}
            onClick={() => inputRef.current?.click()}
            className={primaryButton}
          >
            {pending === "upload" ? t("branding.uploading") : t("branding.upload")}
          </button>
          {src && (
            <button type="button" disabled={pending !== null} onClick={reset} className={secondaryButton}>
              {t("branding.reset")}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
