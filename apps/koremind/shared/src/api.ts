import { z } from "zod";

/** `ssoLinked` is only present (true) when the account is linked to a Kore ID. */
export const User = z.object({ id: z.string(), email: z.string(), isOwner: z.boolean(), ssoLinked: z.boolean().optional() });
export type User = z.infer<typeof User>;

/** The Kore apps the web UI's app switcher links to (keys are Kore ID app keys). */
export const KoreApps = z.object({ kore: z.string(), koremind: z.string(), korecalendar: z.string(), flatline: z.string() }).partial();
export type KoreApps = z.infer<typeof KoreApps>;
/**
 * `sso` = Kore ID sign-in is configured; `passwordLogin` = email + password still works. Older servers omit both.
 * `koreId.accountUrl` = the Kore ID account page (only with Kore ID); `apps` = other Kore apps for the app switcher (KOREMIND_KORE_APPS).
 */
export const Health = z.object({
  name: z.literal("koremind"), version: z.string(), setupRequired: z.boolean(), sso: z.boolean().default(false), passwordLogin: z.boolean().default(true),
  koreId: z.object({ issuer: z.string(), accountUrl: z.string() }).optional(), apps: KoreApps.optional(),
});
export type Health = z.infer<typeof Health>;

export const AuthRequest = z.object({ email: z.string().email(), password: z.string().min(8) });
export type AuthRequest = z.infer<typeof AuthRequest>;
/** Start of a Kore ID sign-in. `challenge` is the client's own PKCE challenge (base64url SHA-256 of a secret verifier it keeps). */
export const SsoStart = z.object({
  challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  platform: z.enum(["web", "android"]),
  /** Web only: the page to come back to. Its origin must be allowed by the server (KOREMIND_WEB_ORIGINS). */
  returnTo: z.string().url().optional(),
});
export type SsoStart = z.infer<typeof SsoStart>;
export const SsoStartResponse = z.object({ url: z.string() });
export type SsoStartResponse = z.infer<typeof SsoStartResponse>;
export const SsoExchange = z.object({ ticket: z.string().min(1), verifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/) });
export type SsoExchange = z.infer<typeof SsoExchange>;
export const LogoutResponse = z.object({ ok: z.literal(true), logoutUrl: z.string().optional() });
export type LogoutResponse = z.infer<typeof LogoutResponse>;
export const AuthResponse = z.object({ token: z.string(), user: User });
export type AuthResponse = z.infer<typeof AuthResponse>;

export const ModelInfo = z.object({
  id: z.string(),
  name: z.string(),
  vision: z.boolean(),
  thinkingLevels: z.array(z.string()),
  isDefault: z.boolean(),
  /** True when every price tier of the model is zero (OpenCode free models, OpenRouter ":free"). */
  free: z.boolean(),
});
export type ModelInfo = z.infer<typeof ModelInfo>;
/** ready = usable now; needs_connection = no key / not signed in; disabled = turned off in the user's Settings. */
export const ProviderStatus = z.enum(["ready", "needs_connection", "disabled"]);
export type ProviderStatus = z.infer<typeof ProviderStatus>;
export const ProviderInfo = z.object({
  id: z.string(),
  name: z.string(),
  connected: z.boolean(),
  status: ProviderStatus,
  /** KoreMind's suggested providers (Groq, OpenRouter); they are listed first and tagged "Recommended". */
  recommended: z.boolean().default(false),
  /** Empty unless status is "ready". Already filtered by the user's "free models only" choice. */
  models: z.array(ModelInfo),
});
export type ProviderInfo = z.infer<typeof ProviderInfo>;

/** A provider the owner can connect in Settings. `signin` = browser sign-in (Codex uses ChatGPT). */
export const ProviderConnection = z.object({
  id: z.string(),
  name: z.string(),
  connected: z.boolean(),
  methods: z.array(z.enum(["key", "signin"])),
  recommended: z.boolean().default(false),
  /** Providers with paid and free models can be limited to free ones (OpenCode, OpenRouter). */
  supportsFreeFilter: z.boolean(),
});
export type ProviderConnection = z.infer<typeof ProviderConnection>;
export const SignInStart = z.object({ attemptId: z.string(), url: z.string(), instructions: z.string() });
export type SignInStart = z.infer<typeof SignInStart>;
export const SignInStatus = z.object({ status: z.enum(["pending", "complete", "failed"]) });
export type SignInStatus = z.infer<typeof SignInStatus>;

export const ChatSummary = z.object({ id: z.string(), title: z.string(), updatedAt: z.number() });
export type ChatSummary = z.infer<typeof ChatSummary>;

export const Attachment = z.object({ id: z.string(), name: z.string(), mime: z.string(), size: z.number() });
export type Attachment = z.infer<typeof Attachment>;
export const Source = z.object({ title: z.string(), url: z.string() });
export type Source = z.infer<typeof Source>;
/** What the assistant did with notes during a turn. `chat` is set when another chat's notes were involved. */
export const Activity = z.object({ kind: z.enum(["saved", "read", "edited", "denied"]), title: z.string(), chat: z.string().optional() });
export type Activity = z.infer<typeof Activity>;
export const ChatMessage = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant"]),
  text: z.string(),
  attachments: z.array(Attachment),
  sources: z.array(Source),
  activity: z.array(Activity).default([]),
  createdAt: z.number(),
});
export type ChatMessage = z.infer<typeof ChatMessage>;

export const SendMessageRequest = z.object({
  text: z.string(),
  attachmentIds: z.array(z.string()),
  model: z.object({ providerId: z.string(), modelId: z.string() }),
  thinking: z.string().optional(),
});
export type SendMessageRequest = z.infer<typeof SendMessageRequest>;

export const StreamEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("status"), state: z.enum(["thinking", "searching"]) }),
  z.object({ type: z.literal("delta"), text: z.string() }),
  z.object({ type: z.literal("source"), title: z.string(), url: z.string() }),
  z.object({ type: z.literal("done"), messageId: z.string() }),
  /** The assistant used (or was refused) the notes tools. Also stored on the assistant message. */
  z.object({ type: z.literal("activity"), kind: z.enum(["saved", "read", "edited", "denied"]), title: z.string(), chat: z.string().optional() }),
  /** The assistant wants to use another chat's notes. The stream stays open until the user answers or it expires. */
  z.object({ type: z.literal("approval"), id: z.string(), action: z.enum(["read", "edit"]), chat: z.string() }),
  z.object({ type: z.literal("approval_closed"), id: z.string(), outcome: z.enum(["allowed", "denied", "expired"]) }),
  /** Sent after `done` on a new chat, once the chosen model has named it. Best effort. */
  z.object({ type: z.literal("title"), title: z.string() }),
  z.object({
    type: z.literal("error"),
    code: z.enum(["no_provider", "attachment_too_large", "engine", "aborted", "model_not_allowed"]),
    message: z.string(),
  }),
]);
export type StreamEvent = z.infer<typeof StreamEvent>;

export const MemoryEntry = z.object({ id: z.string(), text: z.string(), updatedAt: z.number() });
export type MemoryEntry = z.infer<typeof MemoryEntry>;

export const Settings = z.object({
  memoryEnabled: z.boolean(),
  displayName: z.string(),
  tone: z.string(),
  about: z.string(),
  /** Provider ids the user turned off. They stay connected but disappear from the model picker. */
  disabledProviders: z.array(z.string()).default([]),
  /** Provider ids limited to free models (only meaningful where ProviderConnection.supportsFreeFilter). */
  freeOnlyProviders: z.array(z.string()).default([]),
});
export type Settings = z.infer<typeof Settings>;
export const defaultSettings: Settings = { memoryEnabled: true, displayName: "", tone: "", about: "", disabledProviders: [], freeOnlyProviders: [] };

/** Pairing: a signed-in session shows a QR code; a new device scans it to connect and sign in as the same account. */
export const PairStart = z.object({
  code: z.string(),
  expiresAt: z.number(),
  /** Addresses of the backend, best first (local network, Tailscale, domain). */
  urls: z.array(z.string()),
  /** What the QR code contains: koremind://pair?c=<code>&u=<url>&u=<url>... */
  link: z.string(),
});
export type PairStart = z.infer<typeof PairStart>;
export const PairRedeem = z.object({ code: z.string().min(1) });
export type PairRedeem = z.infer<typeof PairRedeem>;
export const ApprovalAnswer = z.object({ allow: z.boolean() });
export type ApprovalAnswer = z.infer<typeof ApprovalAnswer>;
