// ============================================================================
// [STRAJK FORK] Highlight thread state — ephemeral side discussions.
// ============================================================================
//
// Threads live in memory only (MVP). Lost on app restart, which is fine for
// "explain this term" / "clarify this" use cases. The backend Claude process
// is detached and survives the popover being closed and reopened — when the
// user reopens an in-flight thread, the store reflects whatever has streamed
// in so far via `highlight-thread:chunk` events.
//
// Keyed by `threadId` which is also stored as `highlightId` so a click on the
// existing yellow highlight can re-open the same thread.
//
// To revert: delete this file and the `useHighlightThreadEvents` hook + the
// `HighlightThreadPanel` component + the small additions in
// `HighlightActionPopover` and `ChatWindow`.

import { create } from 'zustand'
import { devtools } from 'zustand/middleware'

export type HighlightThreadStatus = 'streaming' | 'done' | 'error' | 'cancelled'

export interface HighlightThread {
  id: string
  sessionId: string
  /** The persisted highlight this thread is anchored to (for revisit). */
  highlightId: string
  /** The text the user highlighted (passed as context to Claude). */
  quotedText: string
  /** Full text of the message the highlight was made in (for disambiguation). */
  messageContext?: string
  /** The user's question. */
  prompt: string
  /** Streamed answer accumulated so far. */
  answer: string
  status: HighlightThreadStatus
  error?: string
  /** Unix ms — used for ordering, not displayed. */
  startedAt: number
}

/**
 * What the floating panel is currently anchored to. Set by the action popover
 * (on "Ask") or by clicking on an existing yellow highlight that has a
 * thread. `null` = panel hidden.
 */
export interface HighlightThreadPanelTarget {
  threadId: string
  highlightId: string
  sessionId: string
  quotedText: string
  /** Full text of the source message (passed to Claude for disambiguation). */
  messageContext?: string
  x: number
  y: number
  /** True for a brand-new thread (panel shows input field first). */
  isNew: boolean
}

interface HighlightThreadsState {
  /** thread_id -> thread */
  threads: Record<string, HighlightThread>
  /** highlight_id -> thread_id (for revisit-by-highlight). */
  threadByHighlight: Record<string, string>
  /** What the floating panel should show, if anything. */
  activePanelTarget: HighlightThreadPanelTarget | null

  startThread: (thread: HighlightThread) => void
  appendChunk: (threadId: string, chunk: string) => void
  markDone: (threadId: string, fullContent?: string) => void
  markError: (threadId: string, error: string) => void
  markCancelled: (threadId: string) => void
  removeThread: (threadId: string) => void
  getThreadByHighlight: (highlightId: string) => HighlightThread | undefined
  openPanel: (target: HighlightThreadPanelTarget) => void
  closePanel: () => void
}

export const useHighlightThreadsStore = create<HighlightThreadsState>()(
  devtools(
    (set, get) => ({
      threads: {},
      threadByHighlight: {},
      activePanelTarget: null,

      openPanel: target =>
        set({ activePanelTarget: target }, false, 'highlightThreads/openPanel'),
      closePanel: () =>
        set({ activePanelTarget: null }, false, 'highlightThreads/closePanel'),

      startThread: thread =>
        set(
          state => ({
            threads: { ...state.threads, [thread.id]: thread },
            threadByHighlight: {
              ...state.threadByHighlight,
              [thread.highlightId]: thread.id,
            },
          }),
          false,
          'highlightThreads/start'
        ),

      appendChunk: (threadId, chunk) =>
        set(
          state => {
            const t = state.threads[threadId]
            if (!t) return state
            return {
              threads: {
                ...state.threads,
                [threadId]: {
                  ...t,
                  answer: t.answer + chunk,
                  // Keep status as streaming even if a stray chunk arrives
                  // after done — defensive, costs nothing.
                  status: t.status === 'done' ? 'done' : 'streaming',
                },
              },
            }
          },
          false,
          'highlightThreads/chunk'
        ),

      markDone: (threadId, fullContent) =>
        set(
          state => {
            const t = state.threads[threadId]
            if (!t) return state
            // Use fullContent if provided AND we somehow missed chunks
            // (e.g. result-only result line with no preceding assistant
            // blocks). Otherwise trust the streamed answer.
            const answer =
              fullContent && fullContent.length > t.answer.length
                ? fullContent
                : t.answer
            return {
              threads: {
                ...state.threads,
                [threadId]: { ...t, answer, status: 'done' },
              },
            }
          },
          false,
          'highlightThreads/done'
        ),

      markError: (threadId, error) =>
        set(
          state => {
            const t = state.threads[threadId]
            if (!t) return state
            return {
              threads: {
                ...state.threads,
                [threadId]: { ...t, status: 'error', error },
              },
            }
          },
          false,
          'highlightThreads/error'
        ),

      markCancelled: threadId =>
        set(
          state => {
            const t = state.threads[threadId]
            if (!t) return state
            return {
              threads: {
                ...state.threads,
                [threadId]: { ...t, status: 'cancelled' },
              },
            }
          },
          false,
          'highlightThreads/cancelled'
        ),

      removeThread: threadId =>
        set(
          state => {
            const t = state.threads[threadId]
            if (!t) return state
            const { [threadId]: _, ...rest } = state.threads
            const { [t.highlightId]: __, ...restByHl } = state.threadByHighlight
            return { threads: rest, threadByHighlight: restByHl }
          },
          false,
          'highlightThreads/remove'
        ),

      getThreadByHighlight: highlightId => {
        const tid = get().threadByHighlight[highlightId]
        return tid ? get().threads[tid] : undefined
      },
    }),
    { name: 'highlight-threads-store' }
  )
)
