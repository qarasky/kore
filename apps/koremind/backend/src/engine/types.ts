import type { ProviderConnection, ProviderInfo, SignInStart, SignInStatus } from "@koremind/shared";

export type EngineEvent =
  | { type: "status"; state: "thinking" | "searching" }
  | { type: "delta"; text: string }
  | { type: "source"; title: string; url: string }
  | { type: "done" }
  | { type: "error"; message: string; noProvider?: boolean };

export type ModelRef = { providerId: string; modelId: string };
export type EngineFile = { name: string; mime: string; dataUrl: string };

export type PromptArgs = {
  sessionId: string;
  /** Personalization + memory. Sent as a context block with the first prompt of an engine session only (""= none). */
  system: string;
  text: string;
  files: EngineFile[];
  model: { providerId: string; modelId: string };
  thinking?: string;
  signal: AbortSignal;
};

export interface Engine {
  listProviders(): Promise<ProviderInfo[]>;
  listConnections(): Promise<ProviderConnection[]>;
  startSignIn(providerId: string): Promise<SignInStart>;
  signInStatus(providerId: string, attemptId: string): Promise<SignInStatus>;
  setProviderKey(providerId: string, key: string): Promise<void>;
  removeProviderKey(providerId: string): Promise<void>;
  createSession(model?: { providerId: string; modelId: string }): Promise<string>;
  deleteSession(id: string): Promise<void>;
  prompt(a: PromptArgs): AsyncIterable<EngineEvent>;
  /** One-shot completion in a throwaway session (chat titles and background memory extraction). Runs on `model` when given. */
  complete(a: { kind?: "title" | "memory"; system: string; text: string; model?: ModelRef }): Promise<string>;
  close(): void;
}
