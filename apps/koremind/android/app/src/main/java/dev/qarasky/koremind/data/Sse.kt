package dev.qarasky.koremind.data

import java.io.ByteArrayOutputStream

/** Incremental server-sent-events parser. Buffers bytes so multibyte characters can be split across chunks. */
class SseParser {
    private var buf = ByteArray(0)

    fun feed(chunk: ByteArray): List<StreamEvent> {
        buf += chunk
        val out = mutableListOf<StreamEvent>()
        while (true) {
            val i = indexOfFrameEnd(buf)
            if (i < 0) break
            val frame = String(buf, 0, i, Charsets.UTF_8)
            buf = buf.copyOfRange(i + 2, buf.size)
            val line = frame.lineSequence().firstOrNull { it.startsWith("data: ") } ?: continue
            parseStreamEvent(line.removePrefix("data: "))?.let(out::add)
        }
        return out
    }

    private fun indexOfFrameEnd(b: ByteArray): Int {
        for (k in 0 until b.size - 1) if (b[k] == '\n'.code.toByte() && b[k + 1] == '\n'.code.toByte()) return k
        return -1
    }
}
