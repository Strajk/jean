// ============================================================================
// [STRAJK FORK] Floating panel for "Ask about highlighted text" side-discussion.
// ============================================================================
//
// Mounted once in `ChatWindow`. Visibility is driven by Zustand state set by
// `HighlightActionPopover` (when "Ask" is clicked) or by clicking on an
// existing yellow highlight that has a thread.
//
// Closing the panel does NOT cancel the underlying Claude process — the
// thread keeps streaming in the background and is reflected in the store.
// Reopening shows the up-to-date state.

import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, X, Send, Trash2 } from 'lucide-react'
import { invoke } from '@/lib/transport'
import { Markdown } from '@/components/ui/markdown'
import {
  useHighlightThreadsStore,
  type HighlightThread,
} from '@/store/highlight-threads-store'

interface Props {
  /** Selected Claude model from chat settings (for new threads). */
  defaultModel?: string
}

export function HighlightThreadPanel({ defaultModel }: Props) {
  const target = useHighlightThreadsStore(state => state.activePanelTarget)
  const onClose = useHighlightThreadsStore(state => state.closePanel)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  // Subscribe to the matching thread (if any) so streaming updates re-render.
  const thread = useHighlightThreadsStore(state =>
    target ? state.threads[target.threadId] : undefined
  )

  // Reset draft when a different highlight is opened.
  useEffect(() => {
    if (target?.isNew) {
      setDraft('')
      // Focus the input shortly after mount so the user can type immediately.
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [target?.threadId, target?.isNew])

  // Esc closes the panel (does NOT cancel the running thread — by design).
  useEffect(() => {
    if (!target) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [target, onClose])

  // Outside click closes the panel.
  useEffect(() => {
    if (!target) return
    const handleMouseDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    // Slight delay so the click that opened the panel doesn't immediately close it.
    const t = setTimeout(
      () => document.addEventListener('mousedown', handleMouseDown),
      0
    )
    return () => {
      clearTimeout(t)
      document.removeEventListener('mousedown', handleMouseDown)
    }
  }, [target, onClose])

  const handleSubmit = useCallback(async () => {
    if (!target || !draft.trim()) return
    const prompt = draft.trim()

    // Optimistically populate the store so the UI flips to "streaming" mode
    // before the Tauri round-trip completes.
    const newThread: HighlightThread = {
      id: target.threadId,
      sessionId: target.sessionId,
      highlightId: target.highlightId,
      quotedText: target.quotedText,
      messageContext: target.messageContext,
      prompt,
      answer: '',
      status: 'streaming',
      startedAt: Date.now(),
    }
    useHighlightThreadsStore.getState().startThread(newThread)
    setDraft('')

    try {
      await invoke('start_highlight_thread', {
        threadId: target.threadId,
        prompt,
        quotedText: target.quotedText,
        messageContext: target.messageContext,
        model: defaultModel,
      })
    } catch (e) {
      useHighlightThreadsStore.getState().markError(target.threadId, String(e))
    }
  }, [target, draft, defaultModel])

  const handleCancel = useCallback(async () => {
    if (!target) return
    try {
      await invoke('cancel_highlight_thread', { threadId: target.threadId })
    } catch (e) {
      console.warn('Failed to cancel highlight thread:', e)
    }
    useHighlightThreadsStore.getState().markCancelled(target.threadId)
  }, [target])

  const handleRemove = useCallback(() => {
    if (!target) return
    useHighlightThreadsStore.getState().removeThread(target.threadId)
    onClose()
  }, [target, onClose])

  if (!target) return null

  // Default panel size — also acts as the initial size for resizing. The user
  // can drag the bottom-right corner (`resize: both`) to grow/shrink it; the
  // browser writes inline width/height that win over class names on subsequent
  // renders, so the resized size persists across re-renders for as long as
  // the panel is mounted (lost on close — fine for an MVP).
  const PANEL_WIDTH = 460
  const PANEL_HEIGHT = 460
  const left = Math.min(
    Math.max(8, target.x - PANEL_WIDTH / 2),
    window.innerWidth - PANEL_WIDTH - 8
  )
  // Show below the selection if there's room, otherwise above.
  const showBelow = target.y + PANEL_HEIGHT + 40 < window.innerHeight
  const top = showBelow
    ? target.y + 28
    : Math.max(8, target.y - PANEL_HEIGHT - 8)

  const isStreaming = thread?.status === 'streaming'
  const isDone = thread?.status === 'done'
  const isError = thread?.status === 'error'
  const isCancelled = thread?.status === 'cancelled'
  const showInput = !thread || (target.isNew && !thread)

  return (
    <div
      ref={panelRef}
      // z-[90] sits above the sidebar (z-50ish), titlebar (z-[60]), and the
      // shadcn popover/tooltip layer (z-[80]). The panel is anchored to a
      // floating position so we want it to dominate everything visually.
      // `resize` enables the native bottom-right resize handle. CSS resize
      // requires overflow != visible — the inner body has its own scroll
      // container, so we set overflow-hidden on the outer.
      className="fixed z-[90] flex flex-col rounded-lg border border-border bg-popover shadow-xl resize overflow-hidden"
      style={{
        left,
        top,
        width: PANEL_WIDTH,
        height: PANEL_HEIGHT,
        minWidth: 320,
        minHeight: 240,
        maxWidth: 'calc(100vw - 16px)',
        maxHeight: 'calc(100vh - 16px)',
      }}
      role="dialog"
      aria-label="Ask about highlighted text"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="size-1.5 rounded-full bg-yellow-500" />
          <span>Ask about selection</span>
          {isStreaming && (
            <Loader2 className="size-3 animate-spin text-muted-foreground" />
          )}
        </div>
        <div className="flex items-center gap-1">
          {(isDone || isError || isCancelled) && (
            <button
              type="button"
              onClick={handleRemove}
              className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-muted cursor-pointer"
              aria-label="Discard thread"
              title="Discard thread"
            >
              <Trash2 className="size-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted cursor-pointer"
            aria-label="Close"
          >
            <X className="size-3.5" />
          </button>
        </div>
      </div>

      {/* Quoted text — small, dim, single source of context.
          `select-text cursor-text` opts out of the global `user-select: none`
          that `body.native-app` applies. */}
      <div className="px-3 py-2 border-b border-border bg-muted/40">
        <div className="text-[11px] text-muted-foreground italic line-clamp-3 whitespace-pre-wrap break-words select-text cursor-text">
          “{target.quotedText}”
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-3 text-sm select-text cursor-text">
        {thread && (
          <>
            <div className="text-xs font-medium text-foreground mb-2">
              {thread.prompt}
            </div>
            {thread.answer && (
              <div className="text-foreground/90">
                {/* Reuse the project Markdown renderer (handles GFM, tables,
                    code, etc.). `streaming` prop tells it to tolerate
                    half-arrived markdown like an unclosed code fence. */}
                <Markdown streaming={isStreaming}>{thread.answer}</Markdown>
                {isStreaming && (
                  <span className="inline-block w-1 h-4 ml-0.5 align-text-bottom bg-foreground/50 animate-pulse" />
                )}
              </div>
            )}
            {!thread.answer && isStreaming && (
              <div className="text-xs text-muted-foreground italic">
                Thinking…
              </div>
            )}
            {isError && (
              <div className="text-xs text-destructive mt-2">
                Error: {thread.error ?? 'unknown'}
              </div>
            )}
            {isCancelled && (
              <div className="text-xs text-muted-foreground italic mt-2">
                Cancelled.
              </div>
            )}
          </>
        )}
        {showInput && (
          <div className="text-xs text-muted-foreground italic">
            What would you like to know about this text?
          </div>
        )}
      </div>

      {/* Footer: input or actions */}
      <div className="border-t border-border p-2">
        {showInput && (
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleSubmit()
                }
              }}
              placeholder="Ask… (Enter to send, Shift+Enter for newline)"
              rows={2}
              className="flex-1 resize-none rounded border border-input bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!draft.trim()}
              className="p-1.5 rounded bg-primary text-primary-foreground enabled:hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              aria-label="Send"
            >
              <Send className="size-3.5" />
            </button>
          </div>
        )}
        {isStreaming && (
          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleCancel}
              className="text-xs text-muted-foreground hover:text-destructive px-2 py-1 cursor-pointer"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
