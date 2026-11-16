package dev.qarasky.koremind.ui.chat

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.MutableTransitionState
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
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
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Create
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.key
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
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
import androidx.compose.ui.text.style.TextAlign
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
import dev.qarasky.koremind.R
import dev.qarasky.koremind.data.Activity
import dev.qarasky.koremind.data.Attachment
import dev.qarasky.koremind.data.ChatMessage
import dev.qarasky.koremind.data.Source
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.draw.clip
import androidx.compose.material3.IconButton
import androidx.compose.material3.TextButton
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.DropdownMenu
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.ExperimentalFoundationApi
import android.content.ClipboardManager
import android.content.ClipData
import androidx.compose.foundation.layout.heightIn
import dev.qarasky.koremind.data.sourceHost
import dev.qarasky.koremind.data.dedupeSources
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.draw.rotate
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.material.icons.filled.KeyboardArrowDown
import dev.qarasky.koremind.ui.KoreMindButton
import dev.qarasky.koremind.ui.theme.CodeFont
import dev.qarasky.koremind.ui.theme.enterExpand
import dev.qarasky.koremind.ui.theme.exitShrink
import dev.qarasky.koremind.ui.theme.LocalMotion
import dev.qarasky.koremind.ui.theme.layoutSpec
import dev.qarasky.koremind.ui.theme.quickSpec
import dev.qarasky.koremind.ui.theme.KoreMindColors

/** The KoreMind mark: a ring of four arcs with the 1 / 0.6 / 0.3 / 0.6 opacity ramp. Drawn, not downloaded. */
@Composable
fun Mark(size: androidx.compose.ui.unit.Dp = 20.dp) {
    Canvas(Modifier.size(size)) {
        val s = this.size.width / 36f
        val stroke = Stroke(width = 6f * s, cap = StrokeCap.Round)
        val r = 14f * s
        val topLeft = Offset((18f - 14f) * s, (18f - 14f) * s)
        val sizeArc = Size(2 * r, 2 * r)
        listOf(-75f to 1f, 15f to 0.6f, 105f to 0.3f, 195f to 0.6f).forEach { (start, a) ->
            drawArc(KoreMindColors.Accent.copy(alpha = a), startAngle = start, sweepAngle = 60f, useCenter = false, topLeft = topLeft, size = sizeArc, style = stroke)
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



/**
 * Your message. A long press opens Copy and Edit; Edit turns the bubble into a field and sends a new version.
 * An edited message shows "‹ 2 / 3 ›" to switch between its versions.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun UserBubble(m: ChatMessage, busy: Boolean = false, onEdit: (id: String, text: String) -> Unit = { _, _ -> }, onVariant: (id: String) -> Unit = {}) {
    var menu by remember { mutableStateOf(false) }
    var editing by rememberSaveable(m.id) { mutableStateOf<String?>(null) }
    val context = LocalContext.current
    val haptic = LocalHapticFeedback.current
    val saved = !m.id.startsWith("local-")
    val shape = RoundedCornerShape(18.dp)
    Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        if (m.attachments.isNotEmpty()) AttachmentChips(m.attachments)
        val draft = editing
        if (draft != null) {
            val focus = remember { FocusRequester() }
            LaunchedEffect(Unit) { focus.requestFocus() }
            val submit = {
                val t = draft.trim()
                if (t.isNotEmpty() && !busy) { editing = null; if (t != m.text.trim()) onEdit(m.id, t) }
            }
            Column(Modifier.fillMaxWidth().background(KoreMindColors.Raised, shape).border(1.dp, KoreMindColors.Accent, shape).padding(start = 14.dp, end = 6.dp, top = 10.dp, bottom = 2.dp)) {
                BasicTextField(
                    draft, { editing = it }, Modifier.fillMaxWidth().padding(end = 8.dp).focusRequester(focus),
                    textStyle = MaterialTheme.typography.bodyLarge.copy(color = KoreMindColors.Text), cursorBrush = SolidColor(KoreMindColors.Accent),
                )
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                    TextButton(onClick = { editing = null }) { Text(stringResource(R.string.cancel), color = KoreMindColors.Muted) }
                    TextButton(onClick = submit, enabled = !busy && draft.isNotBlank()) { Text(stringResource(R.string.send), color = if (!busy && draft.isNotBlank()) KoreMindColors.Accent else KoreMindColors.Muted) }
                }
            }
        } else if (m.text.isNotBlank()) Box {
            Box(
                Modifier.widthIn(max = 320.dp).clip(shape).background(KoreMindColors.Raised)
                    .combinedClickable(onClick = {}, onLongClick = { haptic.performHapticFeedback(HapticFeedbackType.LongPress); menu = true }, onLongClickLabel = stringResource(R.string.message_actions))
                    .padding(horizontal = 14.dp, vertical = 9.dp),
            ) { Text(m.text, style = MaterialTheme.typography.bodyLarge) }
            DropdownMenu(menu, onDismissRequest = { menu = false }, containerColor = KoreMindColors.Raised) {
                DropdownMenuItem(text = { Text(stringResource(R.string.copy)) }, onClick = {
                    menu = false
                    context.getSystemService(ClipboardManager::class.java)?.setPrimaryClip(ClipData.newPlainText("message", m.text))
                })
                if (saved) DropdownMenuItem(text = { Text(stringResource(R.string.edit_message)) }, enabled = !busy, onClick = { menu = false; editing = m.text })
            }
        }
        if (draft == null) variantPosition(m)?.let { (index, count) ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = { variantAt(m, -1)?.let(onVariant) }, enabled = !busy && index > 1, modifier = Modifier.size(32.dp)) {
                    Icon(Icons.AutoMirrored.Filled.KeyboardArrowLeft, stringResource(R.string.previous_version), Modifier.size(18.dp), tint = KoreMindColors.Muted)
                }
                Text("$index / $count", color = KoreMindColors.Muted, style = MaterialTheme.typography.labelMedium,
                    modifier = Modifier.semantics { contentDescription = context.getString(R.string.version_of, index, count) })
                IconButton(onClick = { variantAt(m, 1)?.let(onVariant) }, enabled = !busy && index < count, modifier = Modifier.size(32.dp)) {
                    Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, stringResource(R.string.next_version), Modifier.size(18.dp), tint = KoreMindColors.Muted)
                }
            }
        }
    }
}

@Composable
fun AttachmentChips(items: List<Attachment>) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp, Alignment.End), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        items.forEach {
            Text(it.name, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.labelMedium, color = KoreMindColors.Text,
                modifier = Modifier.widthIn(max = 200.dp).background(KoreMindColors.Raised, RoundedCornerShape(6.dp)).padding(horizontal = 8.dp, vertical = 5.dp))
        }
    }
}

@Composable
fun AssistantMessage(
    text: String, sources: List<Source>, status: String? = null,
    activity: List<Activity> = emptyList(), approvals: List<PendingApproval> = emptyList(), expired: Boolean = false,
    animateChips: Boolean = false, onApproval: (id: String, allow: Boolean) -> Unit = { _, _ -> },
) {
    val on = LocalMotion.current
    Column(Modifier.fillMaxWidth().animateContentSize(layoutSpec(on)), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        // Thinking, searching and the first words cross-fade into each other instead of jumping.
        AnimatedContent(status, label = "status", transitionSpec = { fadeIn(quickSpec(on)) togetherWith fadeOut(quickSpec(on)) }) { st ->
            if (st != null) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(stringResource(when (st) { "searching" -> R.string.searching; "reconnecting" -> R.string.reconnecting; else -> R.string.thinking }), color = KoreMindColors.Muted, style = MaterialTheme.typography.bodySmall)
                    Dots()
                }
            }
        }
        ApprovalCards(approvals, onApproval)
        AnimatedVisibility(expired, enter = enterExpand(on), exit = exitShrink(on)) {
            Text(stringResource(R.string.approval_expired), color = KoreMindColors.Muted, style = MaterialTheme.typography.bodySmall)
        }
        if (text.isNotEmpty()) MarkdownText(text)
        if (activity.isNotEmpty()) ActivityChips(activity, animateChips)
        if (sources.isNotEmpty()) SourcesList(sources)
    }
}

/** Search sources, folded under one "Sources (N)" row so they never push the answer away. */
@Composable
private fun SourcesList(sources: List<Source>) {
    val on = LocalMotion.current
    val list = remember(sources) { dedupeSources(sources) }
    var open by rememberSaveable { mutableStateOf(false) }
    val turn by animateFloatAsState(if (open) 180f else 0f, quickSpec(on), label = "chevron")
    val uri = LocalUriHandler.current
    val label = stringResource(R.string.sources_count, list.size)
    Column {
        Row(
            Modifier.heightIn(min = 36.dp).clickable { open = !open }.semantics { stateDescription = if (open) "expanded" else "collapsed" }.padding(end = 4.dp),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Text(label, color = KoreMindColors.Muted, style = MaterialTheme.typography.labelMedium)
            Icon(Icons.Filled.KeyboardArrowDown, null, Modifier.size(18.dp).rotate(turn), tint = KoreMindColors.Muted)
        }
        AnimatedVisibility(open, enter = enterExpand(on), exit = exitShrink(on)) {
            Column(Modifier.fillMaxWidth().border(1.dp, KoreMindColors.Border, RoundedCornerShape(6.dp))) {
                list.forEachIndexed { i, s ->
                    if (i > 0) Box(Modifier.fillMaxWidth().height(1.dp).background(KoreMindColors.Border))
                    Row(
                        Modifier.fillMaxWidth().clickable { runCatching { uri.openUri(s.url) } }.heightIn(min = 44.dp).padding(horizontal = 12.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Text(s.title.ifBlank { sourceHost(s.url) }, Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyMedium)
                        Text(sourceHost(s.url), color = KoreMindColors.Muted, maxLines = 1, style = MaterialTheme.typography.labelSmall)
                    }
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
            Box(Modifier.size(5.dp).alpha(a).background(KoreMindColors.Muted, CircleShape))
        }
    }
}

internal fun spans(list: List<Span>): AnnotatedString = buildAnnotatedString {
    list.forEach { s ->
        when (s) {
            is Span.Text -> append(s.text)
            is Span.Bold -> withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) { append(s.text) }
            is Span.Italic -> withStyle(SpanStyle(fontStyle = FontStyle.Italic)) { append(s.text) }
            is Span.Strike -> withStyle(SpanStyle(textDecoration = TextDecoration.LineThrough)) { append(s.text) }
            is Span.Code -> withStyle(SpanStyle(fontFamily = CodeFont, background = KoreMindColors.Raised)) { append(s.text) }
            is Span.Link -> withLink(LinkAnnotation.Url(s.url, TextLinkStyles(SpanStyle(color = KoreMindColors.Accent, textDecoration = TextDecoration.Underline)))) { append(s.text) }
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
                is Block.Bullets -> ListView(b.items.map { ListItem(0, false, 0, it) })
                is Block.Numbered -> ListView(b.items.mapIndexed { i, it -> ListItem(0, true, b.start + i, it) })
                is Block.ListBlock -> ListView(b.items)
                is Block.Quote -> Row { Box(Modifier.size(width = 3.dp, height = 20.dp).background(KoreMindColors.BorderStrong)); Text(spans(b.spans), color = KoreMindColors.Muted, modifier = Modifier.padding(start = 10.dp)) }
                is Block.Code -> CodeBlock(b.text, b.lang.orEmpty())
                is Block.Rule -> Box(Modifier.fillMaxWidth().height(1.dp).background(KoreMindColors.Border))
                is Block.Table -> DataTable(
                    b.header.map(::spans), b.rows.map { r -> r.map(::spans) },
                    b.aligns.map { when (it) { Align.Left -> TextAlign.Start; Align.Center -> TextAlign.Center; Align.Right -> TextAlign.End; Align.None -> null } },
                )
                is Block.Image -> RichImage(b.alt, b.url)
                is Block.Card -> CardView(b.card)
                is Block.CardPending -> CardPlaceholder()
            }
        }
    }
}

/** What the assistant did with notes this turn: small chips in the same style as sources. */
@Composable
fun ActivityChips(items: List<Activity>, animate: Boolean) {
    val on = LocalMotion.current && animate
    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        items.forEachIndexed { i, a ->
            val label = activityLabel(a)
            // Chips pop in once when they first appear; chips of finished messages are simply there.
            val visible = remember { MutableTransitionState(!on) }
            LaunchedEffect(Unit) { visible.targetState = true }
            AnimatedVisibility(visible, enter = if (on) fadeIn(quickSpec(true)) + scaleIn(quickSpec(true), initialScale = 0.9f) else androidx.compose.animation.EnterTransition.None) {
                Row(
                    Modifier.widthIn(max = 280.dp).border(1.dp, KoreMindColors.Border, RoundedCornerShape(6.dp)).padding(horizontal = 8.dp, vertical = 5.dp),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp),
                ) {
                    Icon(
                        when (a.kind) {
                            "saved" -> Icons.Filled.Create; "edited" -> Icons.Filled.Edit; "read", "memory_read" -> Icons.Filled.Search
                            "memory_saved", "memory_updated" -> Icons.Filled.Person; "memory_deleted" -> Icons.Filled.Delete; else -> Icons.Filled.Lock
                        },
                        null, Modifier.size(12.dp), tint = KoreMindColors.Muted,
                    )
                    Text(stringResource(label.res, *label.args.toTypedArray()), maxLines = 1, overflow = TextOverflow.Ellipsis, color = KoreMindColors.Muted, style = MaterialTheme.typography.labelSmall)
                }
            }
        }
    }
}

/** One card per pending request, same look as the "connect a provider" box. A card shrinks away when answered or closed. */
@Composable
fun ApprovalCards(approvals: List<PendingApproval>, onAnswer: (id: String, allow: Boolean) -> Unit) {
    val on = LocalMotion.current
    // Keep a card on screen while its exit animation plays.
    var shown by remember { mutableStateOf(approvals) }
    LaunchedEffect(approvals) {
        shown = shown + approvals.filter { a -> shown.none { it.id == a.id } }
        kotlinx.coroutines.delay(280)
        shown = shown.filter { s -> approvals.any { it.id == s.id } }
    }
    shown.forEach { a ->
        key(a.id) {
            val label = approvalLabel(a)
            AnimatedVisibility(approvals.any { it.id == a.id }, enter = enterExpand(on), exit = exitShrink(on)) {
                Column(
                    Modifier.fillMaxWidth().border(1.dp, KoreMindColors.Warning.copy(alpha = 0.4f), RoundedCornerShape(6.dp)).background(KoreMindColors.Surface, RoundedCornerShape(6.dp)).padding(12.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Text(stringResource(label.res, *label.args.toTypedArray()), style = MaterialTheme.typography.bodyMedium)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        KoreMindButton(stringResource(R.string.approval_allow), onClick = { onAnswer(a.id, true) })
                        KoreMindButton(stringResource(R.string.approval_deny), ghost = true, onClick = { onAnswer(a.id, false) })
                    }
                }
            }
        }
    }
}
