/**
 * Browser downloads through a hidden form posted into a hidden iframe, so the
 * browser streams the response straight to disk (no buffering in JS) and the
 * page itself never navigates. Browser-only.
 *
 * A download never fires the iframe's `load` event; an error response (a
 * JSON body rendered as a document) does, which is how failures surface.
 */
import { downloadHref } from "./nodes";

const FRAME_NAME = "kore-download";
let pendingLoad: (() => void) | null = null;

function frame(): HTMLIFrameElement {
  let f = document.querySelector<HTMLIFrameElement>(`iframe[name="${FRAME_NAME}"]`);
  if (!f) {
    f = document.createElement("iframe");
    f.name = FRAME_NAME;
    f.hidden = true;
    f.tabIndex = -1;
    f.setAttribute("aria-hidden", "true");
    document.body.append(f);
  }
  return f;
}

function submit(method: "GET" | "POST", action: string, fields: [string, string][], onError: () => void) {
  const f = frame();
  if (pendingLoad) f.removeEventListener("load", pendingLoad);
  const onLoad = () => {
    // The iframe's initial about:blank load is not a response of ours.
    if (f.contentWindow?.location.href === "about:blank") return;
    f.removeEventListener("load", onLoad);
    pendingLoad = null;
    onError();
  };
  pendingLoad = onLoad;
  f.addEventListener("load", onLoad);

  const form = document.createElement("form");
  form.method = method;
  form.action = action;
  form.target = FRAME_NAME;
  form.hidden = true;
  for (const [name, value] of fields) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    form.append(input);
  }
  document.body.append(form);
  form.submit();
  form.remove();
}

/** One file as itself (`GET /api/nodes/{id}/download`). */
export function downloadFile(id: string, onError: () => void): void {
  submit("GET", downloadHref(id), [], onError);
}

/** Several nodes, or folders, as one zip (`POST /api/download/zip`). */
export function downloadZip(ids: string[], onError: () => void): void {
  submit(
    "POST",
    "/api/download/zip",
    ids.map((id) => ["ids", id]),
    onError,
  );
}
