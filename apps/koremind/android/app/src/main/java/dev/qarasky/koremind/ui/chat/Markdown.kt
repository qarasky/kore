package dev.qarasky.koremind.ui.chat

sealed interface Span {
    data class Text(val text: String) : Span
    data class Bold(val text: String) : Span
    data class Italic(val text: String) : Span
    data class Code(val text: String) : Span
    data class Link(val text: String, val url: String) : Span
}

sealed interface Block {
    data class Heading(val level: Int, val spans: List<Span>) : Block
    data class Paragraph(val spans: List<Span>) : Block
    data class Bullets(val items: List<List<Span>>) : Block
    data class Numbered(val items: List<List<Span>>) : Block
    data class Quote(val spans: List<Span>) : Block
    data class Code(val text: String) : Block
}

private val inline = Regex("""\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)]\((https?://[^)\s]+)\)|(?<![*\w])\*([^*\s][^*]*?)\*(?![*\w])""")

fun parseInline(text: String): List<Span> {
    val out = mutableListOf<Span>()
    var last = 0
    for (m in inline.findAll(text)) {
        if (m.range.first > last) out += Span.Text(text.substring(last, m.range.first))
        out += when {
            m.groups[1] != null -> Span.Bold(m.groupValues[1])
            m.groups[2] != null -> Span.Code(m.groupValues[2])
            m.groups[3] != null -> Span.Link(m.groupValues[3], m.groupValues[4])
            else -> Span.Italic(m.groupValues[5])
        }
        last = m.range.last + 1
    }
    if (last < text.length) out += Span.Text(text.substring(last))
    return if (out.isEmpty()) listOf(Span.Text(text)) else out
}

private val bullet = Regex("""^\s*[-*+]\s+(.*)$""")
private val numbered = Regex("""^\s*\d+[.)]\s+(.*)$""")

fun parseBlocks(markdown: String): List<Block> {
    val lines = markdown.replace("\r\n", "\n").split("\n")
    val blocks = mutableListOf<Block>()
    var i = 0
    while (i < lines.size) {
        val line = lines[i]
        when {
            line.isBlank() -> i++
            line.trimStart().startsWith("```") -> {
                val code = mutableListOf<String>()
                i++
                while (i < lines.size && !lines[i].trimStart().startsWith("```")) { code += lines[i]; i++ }
                i++ // closing fence (or end of input while the model is still typing)
                blocks += Block.Code(code.joinToString("\n"))
            }
            Regex("""^#{1,6}\s+""").containsMatchIn(line) -> {
                val level = line.takeWhile { it == '#' }.length
                blocks += Block.Heading(level, parseInline(line.drop(level).trim())); i++
            }
            bullet.matches(line) -> {
                val items = mutableListOf<List<Span>>()
                while (i < lines.size && bullet.matches(lines[i])) { items += parseInline(bullet.find(lines[i])!!.groupValues[1]); i++ }
                blocks += Block.Bullets(items)
            }
            numbered.matches(line) -> {
                val items = mutableListOf<List<Span>>()
                while (i < lines.size && numbered.matches(lines[i])) { items += parseInline(numbered.find(lines[i])!!.groupValues[1]); i++ }
                blocks += Block.Numbered(items)
            }
            line.trimStart().startsWith(">") -> {
                val q = mutableListOf<String>()
                while (i < lines.size && lines[i].trimStart().startsWith(">")) { q += lines[i].trimStart().removePrefix(">").trim(); i++ }
                blocks += Block.Quote(parseInline(q.joinToString(" ")))
            }
            else -> {
                val p = mutableListOf<String>()
                while (i < lines.size && lines[i].isNotBlank() && !lines[i].trimStart().startsWith("```") && !bullet.matches(lines[i]) && !numbered.matches(lines[i]) && !Regex("""^#{1,6}\s+""").containsMatchIn(lines[i])) { p += lines[i].trim(); i++ }
                blocks += Block.Paragraph(parseInline(p.joinToString(" ")))
            }
        }
    }
    return blocks
}
