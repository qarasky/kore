export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/** Same wording as the server, so people get the message before wasting an upload. */
export const uploadSizeError = (size: number): string | null =>
  size > MAX_UPLOAD_BYTES ? `That file is too large. The limit is ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.` : null;
