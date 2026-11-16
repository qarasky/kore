package dev.qarasky.koremind

import dev.qarasky.koremind.ui.chat.Block
import dev.qarasky.koremind.ui.chat.Align
import dev.qarasky.koremind.ui.chat.ListItem
import dev.qarasky.koremind.ui.chat.imageHost
import dev.qarasky.koremind.ui.chat.Span
import dev.qarasky.koremind.ui.chat.parseBlocks
import dev.qarasky.koremind.ui.chat.parseInline
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
                Block.Code("val x = 1", "kotlin"),
            ),
            blocks,
        )
    }

    @Test fun `parseBlocks keeps an unclosed code fence as code`() {
        assertEquals(listOf(Block.Code("partial")), parseBlocks("```\npartial"))
    }

    // ---- rich blocks ----

    @Test fun `parseInline reads strikethrough`() {
        assertEquals(listOf(Span.Text("a "), Span.Strike("b"), Span.Text(" c")), parseInline("a ~~b~~ c"))
    }

    @Test fun `a horizontal rule is a rule and not a bullet`() {
        assertEquals(listOf(Block.Paragraph(listOf(Span.Text("a"))), Block.Rule, Block.Rule, Block.Rule, Block.Paragraph(listOf(Span.Text("b")))), parseBlocks("a\n\n---\n\n***\n\n___\n\nb"))
    }

    @Test fun `numbered lists keep their numbers across a blank line and indented continuation lines`() {
        val blocks = parseBlocks("1. First\n   more of first\n\n2. Second")
        assertEquals(listOf(Block.Numbered(listOf(listOf(Span.Text("First more of first"))), 1), Block.Numbered(listOf(listOf(Span.Text("Second"))), 2)), blocks)
    }

    @Test fun `nested and mixed lists become one list with levels`() {
        val blocks = parseBlocks("1. Plan\n   - step a\n   - step b\n2. Ship")
        assertEquals(
            listOf(Block.ListBlock(listOf(
                ListItem(0, true, 1, listOf(Span.Text("Plan"))),
                ListItem(1, false, 0, listOf(Span.Text("step a"))),
                ListItem(1, false, 0, listOf(Span.Text("step b"))),
                ListItem(0, true, 2, listOf(Span.Text("Ship"))),
            ))),
            blocks,
        )
    }

    @Test fun `a GFM table has a header, alignments and rows`() {
        val md = "| Name | Amount |\n|:--|--:|\n| Skyler | €60,000 |\n| **Total** | €66,667 |\n\nafter"
        val b = parseBlocks(md)
        val t = b[0] as Block.Table
        assertEquals(listOf(listOf(Span.Text("Name")), listOf(Span.Text("Amount"))), t.header)
        assertEquals(listOf(Align.Left, Align.Right), t.aligns)
        assertEquals(listOf(listOf(Span.Text("Skyler")), listOf(Span.Text("€60,000"))), t.rows[0])
        assertEquals(listOf(Span.Bold("Total")), t.rows[1][0])
        assertEquals(Block.Paragraph(listOf(Span.Text("after"))), b[1])
    }

    @Test fun `a table without alignment markers has no explicit alignment`() {
        val t = parseBlocks("a | b\n--- | ---\n1 | 2")[0] as Block.Table
        assertEquals(listOf(Align.None, Align.None), t.aligns)
        assertEquals(1, t.rows.size)
    }

    @Test fun `a half-typed last row is padded while streaming`() {
        val t = parseBlocks("| a | b | c |\n|---|---|---|\n| 1 | 2 | 3 |\n| 4 |")[0] as Block.Table
        assertEquals(2, t.rows.size)
        assertEquals(listOf("4", "", ""), t.rows[1].map { cell -> cell.joinToString("") { (it as Span.Text).text } })
    }

    @Test fun `a lone line with a pipe is just a paragraph`() {
        assertEquals(listOf(Block.Paragraph(listOf(Span.Text("a | b")))), parseBlocks("a | b"))
    }

    @Test fun `an image on its own line is an image block, https only`() {
        assertEquals(listOf(Block.Image("Moon", "https://tensor.art/x.png")), parseBlocks("![Moon](https://tensor.art/x.png)"))
        assertEquals(listOf(Block.Paragraph(listOf(Span.Link("a", "http://x.test/a.png")))), parseBlocks("![a](http://x.test/a.png)")) // not https: a link, never a fetched image
    }

    @Test fun `image host is the site without www`() {
        assertEquals("tensor.art", imageHost("https://www.tensor.art/p/1.png"))
        assertEquals("cdn.example.com", imageHost("https://cdn.example.com/a.png"))
        assertEquals("", imageHost("not a url"))
    }

    private val goodCard = "{\"title\":\"T\",\"sections\":[{\"type\":\"note\",\"text\":\"n\"}]}"

    @Test fun `a closed card fence with usable JSON is a card`() {
        val b = parseBlocks("Here:\n\n```card\n$goodCard\n```\n\nDone")
        assertEquals(3, b.size)
        assertEquals("T", (b[1] as Block.Card).card.title)
    }

    @Test fun `an open card fence is pending while the model is still typing`() {
        assertEquals(listOf(Block.CardPending), parseBlocks("```card\n{\"title\": \"T\", \"sec"))
    }

    @Test fun `a closed card fence that is not a card stays a plain code block`() {
        assertEquals(listOf(Block.Code("{ nope }", "card")), parseBlocks("```card\n{ nope }\n```"))
    }

    @Test fun `other fences keep their language`() {
        assertEquals(listOf(Block.Code("x", "yaml")), parseBlocks("```yaml\nx\n```"))
    }
}
