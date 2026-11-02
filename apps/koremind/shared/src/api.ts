import { z } from "zod";

export const User = z.object({ id: z.string(), email: z.string(), isOwner: z.boolean() });
export type User = z.infer<typeof User>;

export const Health = z.object({ name: z.literal("zero"), version: z.string(), setupRequired: z.boolean() });
export type Health = z.infer<typeof Health>;

export const AuthRequest = z.object({ email: z.string().email(), password: z.string().min(8) });
export type AuthRequest = z.infer<typeof AuthRequest>;
export const AuthResponse = z.object({ token: z.string(), user: User });
export type AuthResponse = z.infer<typeof AuthResponse>;

export const ModelInfo = z.object({
  id: z.string(),
  name: z.string(),
  vision: z.boolean(),
  thinkingLevels: z.array(z.string()),
  isDefault: z.boolean(),
});
export type ModelInfo = z.infer<typeof ModelInfo>;
export const ProviderInfo = z.object({
  id: z.string(),
  name: z.string(),
  connected: z.boolean(),
  models: z.array(ModelInfo),
});
export type ProviderInfo = z.infer<typeof ProviderInfo>;

export const ChatSummary = z.object({ id: z.string(), title: z.string(), updatedAt: z.number() });
export type ChatSummary = z.infer<typeof ChatSummary>;

export const Attachment = z.object({ id: z.string(), name: z.string(), mime: z.string(), size: z.number() });
export type Attachment = z.infer<typeof Attachment>;
export const Source = z.object({ title: z.string(), url: z.string() });
export type Source = z.infer<typeof Source>;
export const ChatMessage = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant"]),
  text: z.string(),
  attachments: z.array(Attachment),
  sources: z.array(Source),
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
  z.object({
    type: z.literal("error"),
    code: z.enum(["no_provider", "attachment_too_large", "engine", "aborted"]),
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
});
export type Settings = z.infer<typeof Settings>;
export const defaultSettings: Settings = { memoryEnabled: true, displayName: "", tone: "", about: "" };
