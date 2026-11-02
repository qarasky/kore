package dev.qarasky.zero

import dev.qarasky.zero.data.Activity
import dev.qarasky.zero.data.StreamEvent
import dev.qarasky.zero.ui.chat.ChatUiState
import dev.qarasky.zero.ui.chat.PendingApproval
import dev.qarasky.zero.ui.chat.activityLabel
import dev.qarasky.zero.ui.chat.approvalLabel
import dev.qarasky.zero.ui.chat.beginTurn
import dev.qarasky.zero.ui.chat.dismissApproval
import dev.qarasky.zero.ui.chat.endsTurn
import dev.qarasky.zero.ui.chat.reduce
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ChatNotesReducerTest {
    private fun run(vararg events: StreamEvent): ChatUiState =
        events.fold(beginTurn(ChatUiState(), "hi", emptyList())) { s, e -> reduce(s, e) }

    @Test fun `an approval request becomes pending in the draft and keeps the turn open`() {
        val s = run(StreamEvent.Approval("a1", "read", "Lisbon trip"))
        assertEquals(listOf(PendingApproval("a1", "read", "Lisbon trip")), s.draft?.approvals)
        assertFalse(endsTurn(StreamEvent.Approval("a1", "read", "x")))
        assertFalse(endsTurn(StreamEvent.ApprovalClosed("a1", "allowed")))
        assertFalse(endsTurn(StreamEvent.Noted(Activity("saved", "t"))))
    }

    @Test fun `a repeated approval id is not added twice`() {
        val s = run(StreamEvent.Approval("a1", "read", "X"), StreamEvent.Approval("a1", "read", "X"))
        assertEquals(1, s.draft?.approvals?.size)
    }

    @Test fun `closing an approval removes it, and later events keep flowing`() {
        val s = run(StreamEvent.Approval("a1", "edit", "X"), StreamEvent.ApprovalClosed("a1", "allowed"), StreamEvent.Delta("ok"))
        assertTrue(s.draft!!.approvals.isEmpty())
        assertFalse(s.draft!!.expired)
        assertEquals("ok", s.draft!!.text)
    }

    @Test fun `an expired approval removes the card and leaves a transient note`() {
        val s = run(StreamEvent.Approval("a1", "read", "X"), StreamEvent.ApprovalClosed("a1", "expired"))
        assertTrue(s.draft!!.approvals.isEmpty())
        assertTrue(s.draft!!.expired)
    }

    @Test fun `closing an unknown approval changes nothing`() {
        val before = run(StreamEvent.Delta("x"))
        assertEquals(before, reduce(before, StreamEvent.ApprovalClosed("nope", "denied")))
    }

    @Test fun `tapping allow or deny dismisses the card at once`() {
        val s = run(StreamEvent.Approval("a1", "read", "X"), StreamEvent.Approval("a2", "edit", "Y"))
        assertEquals(listOf("a2"), dismissApproval(s, "a1").draft?.approvals?.map { it.id })
        assertEquals(s.copy(draft = null), dismissApproval(s.copy(draft = null), "a1"))
    }

    @Test fun `activity accumulates in the draft and is stored on the finished message`() {
        val s = run(
            StreamEvent.Noted(Activity("saved", "Plan")), StreamEvent.Delta("Done."),
            StreamEvent.Noted(Activity("read", "Budget", "Lisbon trip")), StreamEvent.Done("m1"),
        )
        assertNull(s.draft)
        assertEquals(listOf(Activity("saved", "Plan"), Activity("read", "Budget", "Lisbon trip")), s.messages.last().activity)
    }

    @Test fun `a reply with only activity and no text is still kept when the stream errors`() {
        val s = run(StreamEvent.Noted(Activity("saved", "Plan")), StreamEvent.Error("engine", "boom"))
        assertEquals("assistant", s.messages.last().role)
        assertEquals(listOf(Activity("saved", "Plan")), s.messages.last().activity)
    }

    @Test fun `activity labels use the agreed wording`() {
        assertEquals(R.string.activity_saved to listOf("Trip"), activityLabel(Activity("saved", "Trip")).let { it.res to it.args })
        assertEquals(R.string.activity_edited to listOf("Trip"), activityLabel(Activity("edited", "Trip")).let { it.res to it.args })
        assertEquals(R.string.activity_read_other to listOf("Lisbon"), activityLabel(Activity("read", "Budget", "Lisbon")).let { it.res to it.args })
        assertEquals(R.string.activity_read to emptyList<String>(), activityLabel(Activity("read", "Budget")).let { it.res to it.args })
        assertEquals(R.string.activity_denied to listOf("Lisbon"), activityLabel(Activity("denied", "Budget", "Lisbon")).let { it.res to it.args })
        assertEquals(R.string.activity_denied to listOf("Budget"), activityLabel(Activity("denied", "Budget")).let { it.res to it.args })
    }

    @Test fun `approval text names the action and the chat`() {
        assertEquals(R.string.approval_read to listOf("Lisbon"), approvalLabel(PendingApproval("a", "read", "Lisbon")).let { it.res to it.args })
        assertEquals(R.string.approval_edit to listOf("Lisbon"), approvalLabel(PendingApproval("a", "edit", "Lisbon")).let { it.res to it.args })
    }
}
