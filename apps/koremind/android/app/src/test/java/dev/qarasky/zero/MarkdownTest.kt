package dev.qarasky.zero

import dev.qarasky.zero.ui.chat.Block
import dev.qarasky.zero.ui.chat.Span
import dev.qarasky.zero.ui.chat.parseBlocks
import dev.qarasky.zero.ui.chat.parseInline
import org.junit.Assert.assertEquals
import org.junit.Test

class MarkdownTest {
    @Test fun `parseInline handles bold code and links`() {
        assertEquals(
            listOf(Span.Text("a "), Span.Bold("b"), Span.Text(" "), Span.Code("c"), Span.Text(" "), Span.Link("d", "http://e")),
            parseInline("a **b** `c` [d](http://e)"),
        )
    }

    @Test fun `parseInline leaves unmatched markers as text`() {
        assertEquals(listOf(Span.Text("2 * 3 ** 4")), parseInline("2 * 3 ** 4"))
    }

    @Test fun `parseBlocks recognises headings lists and fenced code`() {
        val blocks = parseBlocks("# Title\n\nSome text\n\n- one\n- two\n\n```kotlin\nval x = 1\n```\n")
        assertEquals(
            listOf(
                Block.Heading(1, listOf(Span.Text("Title"))),
                Block.Paragraph(listOf(Span.Text("Some text"))),
                Block.Bullets(listOf(listOf(Span.Text("one")), listOf(Span.Text("two")))),
                Block.Code("val x = 1"),
            ),
            blocks,
        )
    }

    @Test fun `parseBlocks keeps an unclosed code fence as code`() {
        assertEquals(listOf(Block.Code("partial")), parseBlocks("```\npartial"))
    }
}
