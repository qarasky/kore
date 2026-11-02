package dev.qarasky.zero.ui.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withLink
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.text.withStyle
import androidx.compose.runtime.getValue
import androidx.compose.foundation.Canvas
import androidx.compose.animation.core.animateFloat
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import dev.qarasky.zero.R
import dev.qarasky.zero.data.Attachment
import dev.qarasky.zero.data.ChatMessage
import dev.qarasky.zero.data.Source
import dev.qarasky.zero.ui.theme.CodeFont
import dev.qarasky.zero.ui.theme.ZeroColors

/** The Zero mark: a ring of four arcs with the 1 / 0.6 / 0.3 / 0.6 opacity ramp. Drawn, not downloaded. */
@Composable
fun Mark(size: androidx.compose.ui.unit.Dp = 20.dp) {
    Canvas(Modifier.size(size)) {
        val s = this.size.width / 36f
        val stroke = Stroke(width = 6f * s, cap = StrokeCap.Round)
        val r = 14f * s
        val topLeft = Offset((18f - 14f) * s, (18f - 14f) * s)
        val sizeArc = Size(2 * r, 2 * r)
        listOf(-75f to 1f, 15f to 0.6f, 105f to 0.3f, 195f to 0.6f).forEach { (start, a) ->
            drawArc(ZeroColors.Accent.copy(alpha = a), startAngle = start, sweepAngle = 60f, useCenter = false, topLeft = topLeft, size = sizeArc, style = stroke)
        }
    }
}

@Composable
fun Wordmark() {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Mark(22.dp)
        Text(stringResource(R.string.app_name), style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.SemiBold, letterSpacing = (-0.03).sp))
    }
}



@Composable
fun UserBubble(m: ChatMessage) {
    Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        if (m.attachments.isNotEmpty()) AttachmentChips(m.attachments)
        if (m.text.isNotBlank()) Box(Modifier.widthIn(max = 320.dp).background(ZeroColors.Raised, RoundedCornerShape(18.dp)).padding(horizontal = 14.dp, vertical = 9.dp)) {
            Text(m.text, style = MaterialTheme.typography.bodyLarge)
        }
    }
}

@Composable
fun AttachmentChips(items: List<Attachment>) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp, Alignment.End), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        items.forEach {
            Text(it.name, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.labelMedium, color = ZeroColors.Text,
                modifier = Modifier.widthIn(max = 200.dp).background(ZeroColors.Raised, RoundedCornerShape(6.dp)).padding(horizontal = 8.dp, vertical = 5.dp))
        }
    }
}

@Composable
fun AssistantMessage(text: String, sources: List<Source>, status: String? = null) {
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        if (status != null) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(if (status == "searching") stringResource(R.string.searching) else stringResource(R.string.thinking), color = ZeroColors.Muted, style = MaterialTheme.typography.bodySmall)
                Dots()
            }
        }
        if (text.isNotEmpty()) MarkdownText(text)
        if (sources.isNotEmpty()) {
            val uri = LocalUriHandler.current
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                sources.forEach { s ->
                    Text(s.title, maxLines = 1, overflow = TextOverflow.Ellipsis, color = ZeroColors.Muted, style = MaterialTheme.typography.labelSmall,
                        modifier = Modifier.widthIn(max = 220.dp).border(1.dp, ZeroColors.Border, RoundedCornerShape(6.dp)).clickable { runCatching { uri.openUri(s.url) } }.padding(horizontal = 8.dp, vertical = 5.dp))
                }
            }
        }
    }
}

@Composable
private fun Dots() {
    val t = androidx.compose.animation.core.rememberInfiniteTransition(label = "dots")
    Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        repeat(3) { i ->
            val a by t.animateFloat(0.25f, 1f, androidx.compose.animation.core.infiniteRepeatable(androidx.compose.animation.core.tween(600, delayMillis = i * 150), androidx.compose.animation.core.RepeatMode.Reverse), label = "d$i")
            Box(Modifier.size(5.dp).alpha(a).background(ZeroColors.Muted, CircleShape))
        }
    }
}

private fun spans(list: List<Span>): AnnotatedString = buildAnnotatedString {
    list.forEach { s ->
        when (s) {
            is Span.Text -> append(s.text)
            is Span.Bold -> withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) { append(s.text) }
            is Span.Italic -> withStyle(SpanStyle(fontStyle = FontStyle.Italic)) { append(s.text) }
            is Span.Code -> withStyle(SpanStyle(fontFamily = CodeFont, background = ZeroColors.Raised)) { append(s.text) }
            is Span.Link -> withLink(LinkAnnotation.Url(s.url, TextLinkStyles(SpanStyle(color = ZeroColors.Accent, textDecoration = TextDecoration.Underline)))) { append(s.text) }
        }
    }
}

@Composable
fun MarkdownText(text: String) {
    val blocks = remember(text) { parseBlocks(text) }
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        blocks.forEach { b ->
            when (b) {
                is Block.Heading -> Text(spans(b.spans), style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.SemiBold))
                is Block.Paragraph -> Text(spans(b.spans), style = MaterialTheme.typography.bodyLarge)
                is Block.Bullets -> Column(verticalArrangement = Arrangement.spacedBy(4.dp)) { b.items.forEach { Row { Text("•  ", color = ZeroColors.Muted); Text(spans(it), style = MaterialTheme.typography.bodyLarge) } } }
                is Block.Numbered -> Column(verticalArrangement = Arrangement.spacedBy(4.dp)) { b.items.forEachIndexed { i, it -> Row { Text("${i + 1}.  ", color = ZeroColors.Muted); Text(spans(it), style = MaterialTheme.typography.bodyLarge) } } }
                is Block.Quote -> Row { Box(Modifier.size(width = 3.dp, height = 20.dp).background(ZeroColors.BorderStrong)); Text(spans(b.spans), color = ZeroColors.Muted, modifier = Modifier.padding(start = 10.dp)) }
                is Block.Code -> Text(b.text, fontFamily = CodeFont, style = MaterialTheme.typography.bodySmall,
                    modifier = Modifier.fillMaxWidth().background(ZeroColors.Surface, RoundedCornerShape(6.dp)).border(1.dp, ZeroColors.Border, RoundedCornerShape(6.dp)).padding(10.dp))
            }
        }
    }
}
