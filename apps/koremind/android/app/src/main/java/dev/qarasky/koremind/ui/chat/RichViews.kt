package dev.qarasky.koremind.ui.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import dev.qarasky.koremind.R
import dev.qarasky.koremind.ui.theme.CodeFont
import dev.qarasky.koremind.ui.theme.KoreMindColors
import kotlinx.coroutines.delay

private val CardShape = RoundedCornerShape(12.dp)

// ---- code ----

/** A fenced code block with a Copy button; the label flips to "Copied" for a moment. */
@Composable
fun CodeBlock(text: String, lang: String = "") {
    val clipboard = LocalClipboardManager.current
    var copied by remember { mutableStateOf(false) }
    LaunchedEffect(copied) { if (copied) { delay(1500); copied = false } }
    Column(Modifier.fillMaxWidth().background(KoreMindColors.Surface, RoundedCornerShape(6.dp)).border(1.dp, KoreMindColors.Border, RoundedCornerShape(6.dp))) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Text(lang, color = KoreMindColors.Muted, style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp))
            Text(
                stringResource(if (copied) R.string.copied else R.string.copy), color = KoreMindColors.Muted, style = MaterialTheme.typography.labelSmall,
                modifier = Modifier.clickable { clipboard.setText(AnnotatedString(text)); copied = true }.padding(horizontal = 10.dp, vertical = 6.dp),
            )
        }
        Text(text, fontFamily = CodeFont, style = MaterialTheme.typography.bodySmall, modifier = Modifier.horizontalScroll(rememberScrollState()).padding(start = 10.dp, end = 10.dp, bottom = 10.dp))
    }
}

// ---- images ----

/** An image from an https address, with the site it came from on a chip in the corner. Tapping opens it. */
@Composable
fun RichImage(alt: String, url: String) {
    val uri = LocalUriHandler.current
    val host = imageHost(url)
    Box(Modifier.fillMaxWidth().clip(CardShape).background(KoreMindColors.Raised).clickable(onClickLabel = stringResource(R.string.image_open)) { runCatching { uri.openUri(url) } }) {
        AsyncImage(model = url, contentDescription = alt.ifBlank { null }, contentScale = ContentScale.FillWidth, modifier = Modifier.fillMaxWidth().defaultMinSize(minHeight = 120.dp).heightIn(max = 420.dp))
        if (host.isNotEmpty()) Text(
            host, color = KoreMindColors.Text, fontSize = 12.sp,
            modifier = Modifier.align(Alignment.BottomStart).padding(8.dp).background(KoreMindColors.Bg.copy(alpha = 0.7f), CircleShape).padding(horizontal = 10.dp, vertical = 4.dp),
        )
    }
}

// ---- lists ----

@Composable
fun ListView(items: List<ListItem>) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        items.forEach { it ->
            val marker = if (it.ordered) "${it.number}.  " else if (it.level == 0) "•  " else "–  "
            Row(Modifier.padding(start = (it.level * 18).dp)) {
                Text(marker, color = KoreMindColors.Muted)
                Text(spans(it.spans), style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
            }
        }
    }
}

// ---- tables ----

/**
 * Column widths (dp) for a table that should fit the screen when it can: each column wants its natural width, but they are scaled to
 * the [available] width, a column never goes below [minWidth], and only when even the minimums don't fit does the table scroll sideways.
 */
fun fitColumns(natural: List<Int>, available: Int, minWidth: Int = 88): List<Int> {
    if (natural.isEmpty()) return emptyList()
    val fixed = BooleanArray(natural.size)
    var width = IntArray(natural.size) { 0 }
    while (true) {
        val free = available - fixed.indices.filter { fixed[it] }.sumOf { minWidth }
        val flexNatural = natural.indices.filter { !fixed[it] }.sumOf { natural[it] }
        if (flexNatural == 0) break
        var newlyFixed = false
        for (i in natural.indices) if (!fixed[i]) {
            width[i] = natural[i] * free / flexNatural
            if (width[i] < minWidth) { fixed[i] = true; newlyFixed = true }
        }
        if (!newlyFixed) break
    }
    for (i in natural.indices) if (fixed[i]) width[i] = minWidth
    return width.toList()
}

/**
 * A table that scrolls sideways when it is wider than the screen and fills the width when it is not.
 * [explicit] is the alignment written in the Markdown (null = decide: first column left, number columns right).
 */
@Composable
fun DataTable(header: List<AnnotatedString>, rows: List<List<AnnotatedString>>, explicit: List<TextAlign?> = emptyList(), boldLastRow: Boolean = false) {
    val cols = header.size
    val cell = { r: List<AnnotatedString>, c: Int -> r.getOrNull(c) ?: AnnotatedString("") }
    val plain = rows.map { r -> (0 until cols).map { cell(r, it).text } }
    val aligns = (0 until cols).map { c -> explicit.getOrNull(c) ?: if (c > 0 && isNumericColumn(plain, c)) TextAlign.End else TextAlign.Start }
    // Width follows the longest cell, roughly: a Text can't be measured before layout, and a table needs equal columns on every row.
    val natural = (0 until cols).map { c -> ((rows.map { cell(it, c).length } + header[c].length).max() * 8 + 28).coerceIn(64, 220) }
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        val widths: List<Dp> = fitColumns(natural, maxWidth.value.toInt()).map { it.dp }
        Column(Modifier.horizontalScroll(rememberScrollState())) {
            @Composable fun line(cells: List<AnnotatedString>, weight: FontWeight, color: Color) {
                Row {
                    (0 until cols).forEach { c ->
                        Text(cells.getOrNull(c) ?: AnnotatedString(""), color = color, fontWeight = weight, textAlign = aligns[c], style = MaterialTheme.typography.bodyMedium,
                            modifier = Modifier.width(widths[c]).padding(horizontal = 8.dp, vertical = 8.dp))
                    }
                }
                Box(Modifier.width(widths.fold(0.dp) { a, b -> a + b }).height(1.dp).background(KoreMindColors.Border))
            }
            line(header, FontWeight.SemiBold, KoreMindColors.Text)
            rows.forEachIndexed { i, r -> line(r, if (boldLastRow && i == rows.lastIndex) FontWeight.SemiBold else FontWeight.Normal, KoreMindColors.Text) }
        }
    }
}

// ---- cards ----

private fun toneColor(t: Tone?): Color = when (t) {
    Tone.Good -> KoreMindColors.StatusUp
    Tone.Info -> KoreMindColors.Accent
    Tone.Warn -> KoreMindColors.Warning
    Tone.Bad -> KoreMindColors.Danger
    Tone.Neutral, null -> KoreMindColors.Muted
}

private val barCycle = listOf(Tone.Good, Tone.Info, Tone.Warn)

@Composable
private fun Pill(b: CardBadge) {
    val c = toneColor(b.tone)
    Text(b.text, color = c, fontSize = 12.sp, maxLines = 1, modifier = Modifier.background(c.copy(alpha = 0.14f), CircleShape).padding(horizontal = 10.dp, vertical = 4.dp))
}

@Composable
private fun Divider() { Box(Modifier.fillMaxWidth().height(1.dp).background(KoreMindColors.Border)) }

@Composable
private fun SectionView(s: CardSection) {
    when (s) {
        is CardSection.Stats -> Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            s.items.chunked(2).forEach { row ->
                Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                    row.forEach { st ->
                        Column(Modifier.weight(1f)) {
                            Text(st.label, color = KoreMindColors.Muted, fontSize = 13.sp)
                            Text(st.value, color = if (st.tone == null || st.tone == Tone.Neutral) KoreMindColors.Text else toneColor(st.tone), fontSize = 28.sp, fontWeight = FontWeight.SemiBold, lineHeight = 34.sp)
                        }
                    }
                    if (row.size < 2 && s.items.size > 1) Spacer(Modifier.weight(1f))
                }
            }
        }
        is CardSection.Table -> DataTable(s.columns.map { AnnotatedString(it) }, s.rows.map { r -> r.map { AnnotatedString(it) } }, boldLastRow = s.totalRow)
        is CardSection.Bars -> Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            s.items.forEachIndexed { i, b ->
                val fill = toneColor(b.tone ?: barCycle[i % barCycle.size])
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Text(b.label, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
                        Text(b.value, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
                    }
                    Box(Modifier.fillMaxWidth().height(8.dp).clip(RoundedCornerShape(4.dp)).background(KoreMindColors.Raised)) {
                        Box(Modifier.fillMaxWidth(b.share.toFloat()).fillMaxHeight().background(fill))
                    }
                }
            }
        }
        is CardSection.Note -> Text(s.text, color = KoreMindColors.Muted, style = MaterialTheme.typography.bodySmall)
    }
}

/** A rich card: header (title, subtitle, badge) over sections (stats, table, bars, note). A card with only a badge is just the pill. */
@Composable
fun CardView(card: Card) {
    val header = card.title != null || card.subtitle != null || card.badge != null
    if (card.title == null && card.subtitle == null && card.sections.isEmpty()) { card.badge?.let { Pill(it) }; return }
    Column(Modifier.fillMaxWidth().background(KoreMindColors.Surface, CardShape).border(1.dp, KoreMindColors.Border, CardShape).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        if (header) Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                card.title?.let { Text(it, fontSize = 15.sp, fontWeight = FontWeight.SemiBold) }
                card.subtitle?.let { Text(it, color = KoreMindColors.Muted, fontSize = 13.sp) }
            }
            card.badge?.let { Pill(it) }
        }
        card.sections.forEachIndexed { i, s ->
            if (i > 0 || header) Divider()
            SectionView(s)
        }
    }
}

/** What a ```card block looks like until its JSON is complete. */
@Composable
fun CardPlaceholder() {
    Column(Modifier.fillMaxWidth().background(KoreMindColors.Raised, CardShape).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(stringResource(R.string.card_building), color = KoreMindColors.Muted, fontSize = 13.sp)
        Box(Modifier.fillMaxWidth(0.6f).height(10.dp).background(KoreMindColors.Border, RoundedCornerShape(5.dp)))
    }
}
