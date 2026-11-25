package dev.qarasky.koremind.data

const val MAX_UPLOAD_BYTES = 20L * 1024 * 1024

/** Same wording as the server. Unknown sizes pass; the server still checks. */
fun uploadSizeError(size: Long?): String? =
    if (size != null && size > MAX_UPLOAD_BYTES) "That file is too large. The limit is ${MAX_UPLOAD_BYTES / 1024 / 1024} MB." else null
