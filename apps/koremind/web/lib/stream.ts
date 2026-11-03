import { StreamEvent } from "@koremind/shared";

/** Parses a server-sent-events body into typed events. Tolerates chunks split anywhere. */
export async function* parseStream(body: ReadableStream<Uint8Array>): AsyncGenerator<StreamEvent> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i: number;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const frame = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const line = frame.split("\n").find((l) => l.startsWith("data: "));
        if (!line) continue;
        try {
          const ev = StreamEvent.safeParse(JSON.parse(line.slice(6)));
          if (ev.success) yield ev.data;
        } catch { /* malformed frame */ }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
