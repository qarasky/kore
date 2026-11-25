package dev.qarasky.koremind.ui.chat

sealed interface Span {
    data class Text(val text: String) : Span
    data class Bold(val text: String) : Span
    data class Italic(val text: String) : Span
    data class Strike(val text: String) : Span
    data class Code(val text: String) : Span
    data class Link(val text: String, val url: String) : Span
}

enum class Align { None, Left, Center, Right }

/** One line of a list that mixes levels or kinds. [number] is the number as written (0 for a bullet). */
data class ListItem(val level: Int, val ordered: Boolean, val number: Int, val spans: List<Span>)

private typealias CardModel = Card

sealed interface Block {
    data class Heading(val level: Int, val spans: List<Span>) : Block
    data class Paragraph(val spans: List<Span>) : Block
    data class Bullets(val items: List<List<Span>>) : Block
    /** [start] is the first number as written, so a list split by a blank line keeps counting. */
    data class Numbered(val items: List<List<Span>>, val start: Int = 1) : Block
    /** A list with nested levels or both kinds of marker. A flat bullet or numbered list is Bullets / Numbered. */
    data class ListBlock(val items: List<ListItem>) : Block
    data class Quote(val spans: List<Span>) : Block
    data class Code(val text: String, val lang: String? = null) : Block
    data object Rule : Block
    data class Table(val header: List<List<Span>>, val aligns: List<Align>, val rows: List<List<List<Span>>>) : Block
    data class Image(val alt: String, val url: String) : Block
    data class Card(val card: CardModel) : Block
    /** A ```card fence that is still being typed: shown as a calm placeholder until it closes. */
    data object CardPending : Block
}

/** An image that is not a block of its own (or not https) reads as a link with its description. */
private val inline = Regex("""\*\*(.+?)\*\*|`([^`]+)`|!?\[([^\]]+)]\((https?://[^)\s]+)\)|(?<![*\w])\*([^*\s][^*]*?)\*(?![*\w])|~~(.+?)~~""")

fun parseInline(text: String): List<Span> {
    val out = mutableListOf<Span>()
    var last = 0
    for (m in inline.findAll(text)) {
        if (m.range.first > last) out += Span.Text(text.substring(last, m.range.first))
        out += when {
            m.groups[1] != null -> Span.Bold(m.groupValues[1])
            m.groups[2] != null -> Span.Code(m.groupValues[2])
            m.groups[3] != null -> Span.Link(m.groupValues[3], m.groupValues[4])
            m.groups[6] != null -> Span.Strike(m.groupValues[6])
            else -> Span.Italic(m.groupValues[5])
        }
        last = m.range.last + 1
    }
    if (last < text.length) out += Span.Text(text.substring(last))
    return if (out.isEmpty()) listOf(Span.Text(text)) else out
}

private val bullet = Regex("""^(\s*)[-*+]\s+(.*)$""")
private val numbered = Regex("""^(\s*)(\d+)[.)]\s+(.*)$""")
private val heading = Regex("""^#{1,6}\s+""")
private val rule = Regex("""^\s{0,3}([-*_])(?:\s*\1){2,}\s*$""")
private val imageLine = Regex("""^!\[([^\]]*)]\((https://[^)\s]+)\)$""")
private val tableSeparator = Regex("""^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$""")

/** The site an image comes from, shown on its corner chip: the host without "www.". Empty when the address is not a URL. */
fun imageHost(url: String): String = runCatching { java.net.URI(url).host?.removePrefix("www.") }.getOrNull() ?: ""

private fun indentOf(line: String): Int = line.takeWhile { it == ' ' || it == '\t' }.sumOf { if (it == '\t') 4 else 1 }

private fun isListLine(line: String) = bullet.matches(line) || numbered.matches(line)

/** Cells of a table row; leading and trailing pipes are optional and `\|` is a literal pipe. */
private fun splitRow(line: String): List<String> {
    var s = line.trim()
    if (s.startsWith("|")) s = s.drop(1)
    if (s.endsWith("|") && !s.endsWith("\\|")) s = s.dropLast(1)
    val cells = mutableListOf<String>()
    val cur = StringBuilder()
    var i = 0
    while (i < s.length) {
        val c = s[i]
        if (c == '\\' && i + 1 < s.length && s[i + 1] == '|') { cur.append('|'); i += 2; continue }
        if (c == '|') { cells += cur.toString().trim(); cur.clear() } else cur.append(c)
        i++
    }
    cells += cur.toString().trim()
    return cells
}

private fun alignOf(cell: String): Align = when {
    cell.startsWith(":") && cell.endsWith(":") && cell.length > 1 -> Align.Center
    cell.endsWith(":") -> Align.Right
    cell.startsWith(":") -> Align.Left
    else -> Align.None
}

/** A header line followed by a separator line with the same number of cells starts a table. */
private fun isTableStart(lines: List<String>, i: Int): Boolean {
    if (i + 1 >= lines.size || !lines[i].contains('|') || !tableSeparator.matches(lines[i + 1]) || !lines[i + 1].contains('-')) return false
    return splitRow(lines[i]).size == splitRow(lines[i + 1]).size
}

fun parseBlocks(markdown: String): List<Block> {
    val lines = markdown.replace("\r\n", "\n").split("\n")
    val blocks = mutableListOf<Block>()
    var i = 0
    while (i < lines.size) {
        val line = lines[i]
        when {
            line.isBlank() -> i++
            line.trimStart().startsWith("```") -> {
                val lang = line.trimStart().removePrefix("```").trim().takeWhile { !it.isWhitespace() }.ifEmpty { null }
                val code = mutableListOf<String>()
                i++
                while (i < lines.size && !lines[i].trimStart().startsWith("```")) { code += lines[i]; i++ }
                val closed = i < lines.size
                i++ // closing fence (or end of input while the model is still typing)
                val text = code.joinToString("\n")
                blocks += when {
                    lang.equals("card", ignoreCase = true) ->
                        if (!closed) Block.CardPending else parseCard(text)?.let { Block.Card(it) } ?: Block.Code(text, lang)
                    else -> Block.Code(text, lang)
                }
            }
            heading.containsMatchIn(line) -> {
                val level = line.takeWhile { it == '#' }.length
                blocks += Block.Heading(level, parseInline(line.drop(level).trim())); i++
            }
            rule.matches(line) -> { blocks += Block.Rule; i++ }
            imageLine.matches(line.trim()) -> {
                val m = imageLine.find(line.trim())!!
                blocks += Block.Image(m.groupValues[1], m.groupValues[2]); i++
            }
            isTableStart(lines, i) -> {
                val header = splitRow(line)
                val aligns = splitRow(lines[i + 1]).map(::alignOf)
                i += 2
                val rows = mutableListOf<List<List<Span>>>()
                while (i < lines.size && lines[i].isNotBlank() && lines[i].contains('|')) {
                    val cells = splitRow(lines[i])
                    rows += header.indices.map { c -> parseInline(cells.getOrElse(c) { "" }) }
                    i++
                }
                blocks += Block.Table(header.map(::parseInline), aligns, rows)
            }
            isListLine(line) -> {
                val items = mutableListOf<ListItem>()
                val raw = mutableListOf<String>()
                val indents = ArrayDeque<Int>()
                while (i < lines.size) {
                    val l = lines[i]
                    val b = bullet.find(l)
                    val n = numbered.find(l)
                    if (b != null || n != null) {
                        val indent = indentOf(l)
                        while (indents.isNotEmpty() && indent < indents.last()) indents.removeLast()
                        if (indents.isEmpty() || indent > indents.last()) indents.addLast(indent)
                        val body = if (n != null) n.groupValues[3] else b!!.groupValues[2]
                        raw += body
                        items += ListItem(indents.size - 1, n != null, n?.groupValues?.get(2)?.toIntOrNull() ?: 0, parseInline(body))
                    } else if (l.isNotBlank() && indentOf(l) >= 2 && items.isNotEmpty() && !l.trimStart().startsWith("```") && !heading.containsMatchIn(l.trimStart())) {
                        // An indented line under an item continues it.
                        raw[raw.lastIndex] = raw.last() + " " + l.trim()
                        items[items.lastIndex] = items.last().copy(spans = parseInline(raw.last()))
                    } else break
                    i++
                }
                val flat = items.all { it.level == 0 } && items.all { it.ordered == items[0].ordered }
                blocks += when {
                    !flat -> Block.ListBlock(items)
                    items[0].ordered -> Block.Numbered(items.map { it.spans }, items[0].number)
                    else -> Block.Bullets(items.map { it.spans })
                }
            }
            line.trimStart().startsWith(">") -> {
                val q = mutableListOf<String>()
                while (i < lines.size && lines[i].trimStart().startsWith(">")) { q += lines[i].trimStart().removePrefix(">").trim(); i++ }
                blocks += Block.Quote(parseInline(q.joinToString(" ")))
            }
            else -> {
                val p = mutableListOf<String>()
                while (i < lines.size && lines[i].isNotBlank() && !lines[i].trimStart().startsWith("```") && !isListLine(lines[i]) && !heading.containsMatchIn(lines[i]) &&
                    !rule.matches(lines[i]) && !imageLine.matches(lines[i].trim()) && !isTableStart(lines, i)) { p += lines[i].trim(); i++ }
                if (p.isEmpty()) { p += line.trim(); i++ } // a line that no block above claimed: never loop on it
                blocks += Block.Paragraph(parseInline(p.joinToString(" ")))
            }
        }
    }
    return blocks
}
