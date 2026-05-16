import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ClipboardCopy,
  Highlighter,
  MessageCirclePlus,
  MessageCircle,
  X,
} from 'lucide-react'
import TurndownService from 'turndown'
import { toast } from 'sonner'
import { useChatStore } from '@/store/chat-store'
import { generateId } from '@/lib/uuid'
import { copyToClipboard } from '@/lib/clipboard'
import type { TextHighlight } from '@/types/chat'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
// [STRAJK FORK] Side-discussion panel coordination.
import { useHighlightThreadsStore } from '@/store/highlight-threads-store'

// [STRAJK FORK] Turndown converts the rendered HTML of a selection back to
// markdown. Configured once at module scope (it's stateless and the cost of
// re-creating it would dwarf actual conversion). Defaults are mostly fine —
// we just opt into fenced code blocks and dash bullets for cleanliness.
const turndownService = new TurndownService({
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
  headingStyle: 'atx',
})
// react-markdown wraps inline code in <code> with no parent <pre>; turndown
// already handles that. Strip <span> wrappers (rehype adds them for syntax
// highlighting) so they don't end up as raw HTML in the output.
turndownService.addRule('stripSpans', {
  filter: ['span'],
  replacement: (content: string) => content,
})

interface HighlightActionPopoverProps {
  sessionId: string
  /** Ref to the scrollable message container */
  containerRef: React.RefObject<HTMLDivElement | null>
}

/**
 * Floating popover that appears when text is selected in a message.
 * Shows a highlighter icon to create a highlight, or an X to remove an existing one.
 */
export function HighlightActionPopover({
  sessionId,
  containerRef,
}: HighlightActionPopoverProps) {
  const [popover, setPopover] = useState<{
    x: number
    y: number
    type: 'add' | 'remove'
    // For 'add': selection info
    messageId?: string
    text?: string
    startOffset?: number
    // For 'remove': highlight to remove
    highlightId?: string
  } | null>(null)

  const popoverRef = useRef<HTMLDivElement>(null)
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Cancel any pending dismiss when the mouse enters the popover
  const handlePopoverMouseEnter = useCallback(() => {
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current)
      dismissTimerRef.current = null
    }
  }, [])

  // Start dismiss timer when the mouse leaves the popover
  const handlePopoverMouseLeave = useCallback(() => {
    dismissTimerRef.current = setTimeout(() => {
      setPopover(prev => (prev?.type === 'remove' ? null : prev))
    }, 300)
  }, [])

  // Handle text selection for adding highlights.
  // NOTE: We register the handler unconditionally on `document` and read
  // containerRef.current lazily inside the handler. This avoids a race where
  // the effect runs before ScrollArea mounts (containerRef.current is null)
  // and the handler is never registered.
  useEffect(() => {
    const handleSelectionChange = () => {
      const container = containerRef.current
      if (!container) return

      const selection = window.getSelection()
      if (!selection || selection.isCollapsed || !selection.rangeCount) {
        // Don't dismiss if mouse is over the popover
        if (popoverRef.current?.matches(':hover')) return
        setPopover(null)
        return
      }

      const range = selection.getRangeAt(0)
      if (!range || !container.contains(range.commonAncestorContainer)) {
        return
      }

      // Find the message element containing the selection
      const messageEl = findMessageElement(range.commonAncestorContainer)
      if (!messageEl) return

      const messageId = messageEl.getAttribute('data-message-id')
      if (!messageId) return

      const selectedText = selection.toString().trim()
      if (!selectedText || selectedText.length < 2) return

      // Compute the character offset within the message content
      const startOffset = getTextOffset(
        messageEl,
        range.startContainer,
        range.startOffset
      )

      // Position the popover near the end of the selection (viewport-fixed coords)
      const rect = range.getBoundingClientRect()
      const { x, y } = clampPopoverPosition(rect)

      setPopover({
        x,
        y,
        type: 'add',
        messageId,
        text: selectedText,
        startOffset,
      })
    }

    document.addEventListener('selectionchange', handleSelectionChange)
    return () =>
      document.removeEventListener('selectionchange', handleSelectionChange)
  }, [containerRef, sessionId])

  // Handle mouse enter on existing highlights to show remove button
  useEffect(() => {
    let lastCheck = 0
    const handleMouseMove = (e: MouseEvent) => {
      const container = containerRef.current
      if (!container) return
      // Throttle to ~60fps
      const now = Date.now()
      if (now - lastCheck < 16) return
      lastCheck = now

      // Don't show remove popover when there's an active text selection
      const selection = window.getSelection()
      if (selection && !selection.isCollapsed) return

      if (!CSS.highlights) return

      const highlight = CSS.highlights.get('user-highlight')
      if (!highlight) return

      const highlights =
        useChatStore.getState().sessionHighlights[sessionId] ?? []
      if (highlights.length === 0) return

      // Check each highlight range to see if the mouse is over it
      for (const abstractRange of highlight) {
        if (!(abstractRange instanceof Range)) continue
        const rects = abstractRange.getClientRects()
        for (const rect of rects) {
          if (
            e.clientX >= rect.left &&
            e.clientX <= rect.right &&
            e.clientY >= rect.top &&
            e.clientY <= rect.bottom
          ) {
            // Find which highlight this range belongs to
            const rangeText = abstractRange.toString()
            const matchingHighlight = highlights.find(h => h.text === rangeText)
            if (!matchingHighlight) continue

            // Cancel any pending dismiss -- mouse is back on a highlight
            if (dismissTimerRef.current) {
              clearTimeout(dismissTimerRef.current)
              dismissTimerRef.current = null
            }
            const { x, y } = clampPopoverPosition(rect)
            setPopover({
              x,
              y,
              type: 'remove',
              highlightId: matchingHighlight.id,
            })
            return
          }
        }
      }

      // Mouse not over any highlight -- dismiss with grace period
      if (!dismissTimerRef.current) {
        dismissTimerRef.current = setTimeout(() => {
          dismissTimerRef.current = null
          // Re-check: don't dismiss if mouse is now over the popover
          if (popoverRef.current?.matches(':hover')) return
          setPopover(prev => (prev?.type === 'remove' ? null : prev))
        }, 300)
      }
    }

    document.addEventListener('mousemove', handleMouseMove)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      if (dismissTimerRef.current) {
        clearTimeout(dismissTimerRef.current)
        dismissTimerRef.current = null
      }
    }
  }, [containerRef, sessionId])

  // Dismiss when clicking outside
  useEffect(() => {
    if (!popover) return

    const handleMouseDown = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node)
      ) {
        // Small delay to let selection handlers fire first
        setTimeout(() => {
          const selection = window.getSelection()
          if (!selection || selection.isCollapsed) {
            setPopover(null)
          }
        }, 100)
      }
    }

    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [popover])

  const handleAdd = useCallback(() => {
    if (popover?.type !== 'add' || !popover.messageId || !popover.text) return

    const highlight: TextHighlight = {
      id: generateId(),
      message_id: popover.messageId,
      text: popover.text,
      start_offset: popover.startOffset ?? 0,
    }

    useChatStore.getState().addHighlight(sessionId, highlight)

    // Clear the selection
    window.getSelection()?.removeAllRanges()
    setPopover(null)
  }, [popover, sessionId])

  const handleRemove = useCallback(() => {
    if (popover?.type !== 'remove' || !popover.highlightId) return

    useChatStore.getState().removeHighlight(sessionId, popover.highlightId)
    setPopover(null)
  }, [popover, sessionId])

  // [STRAJK FORK] "Ask about this": create a highlight to anchor the thread,
  // then open the side panel. The highlight serves as a re-entry point for
  // revisiting the thread later (hover -> "Open thread").
  const handleAsk = useCallback(() => {
    if (popover?.type !== 'add' || !popover.messageId || !popover.text) return

    // Pull the rendered message text straight from the DOM. This is what the
    // user sees (post-markdown), and gives Claude full context to disambiguate
    // pronouns / references in the highlighted snippet. Cheap (no chat-store
    // coupling) and consistent with how `useTextHighlights` finds messages.
    const messageEl = containerRef.current?.querySelector(
      `[data-message-id="${popover.messageId}"]`
    )
    const rawContext = messageEl?.textContent?.trim() ?? ''
    // Cap to avoid sending the whole world if someone highlights inside an
    // unusually huge assistant turn. ~8k chars ≈ 2k tokens — generous but bounded.
    const messageContext = rawContext.slice(0, 8000)

    const highlightId = generateId()
    const highlight: TextHighlight = {
      id: highlightId,
      message_id: popover.messageId,
      text: popover.text,
      start_offset: popover.startOffset ?? 0,
    }
    useChatStore.getState().addHighlight(sessionId, highlight)

    useHighlightThreadsStore.getState().openPanel({
      threadId: highlightId, // Reuse highlight id as thread id for 1:1 mapping.
      highlightId,
      sessionId,
      quotedText: popover.text,
      messageContext: messageContext || undefined,
      x: popover.x,
      y: popover.y,
      isNew: true,
    })

    window.getSelection()?.removeAllRanges()
    setPopover(null)
  }, [popover, sessionId, containerRef])

  // [STRAJK FORK] Copy selection as markdown. We can't use `popover.text`
  // (that's already plain text via selection.toString()) — we need the HTML
  // of the selection to recover bold/code/links/etc. Pull it from the live
  // window selection range, then run it through turndown.
  const handleCopyMarkdown = useCallback(async () => {
    if (popover?.type !== 'add') return
    const selection = window.getSelection()
    let markdown = popover.text ?? ''
    if (selection && selection.rangeCount > 0 && !selection.isCollapsed) {
      const range = selection.getRangeAt(0)
      const fragment = range.cloneContents()
      const wrapper = document.createElement('div')
      wrapper.appendChild(fragment)
      const html = wrapper.innerHTML
      try {
        markdown = turndownService.turndown(html).trim()
      } catch (e) {
        // Fall back silently to plain text; markdown extraction is a nice-to-have.
        console.warn('turndown failed, falling back to plain text', e)
      }
    }

    try {
      await copyToClipboard(markdown)
      toast.success('Copied as markdown')
    } catch (e) {
      toast.error(`Copy failed: ${e}`)
    }

    window.getSelection()?.removeAllRanges()
    setPopover(null)
  }, [popover])

  // [STRAJK FORK] Open existing thread anchored to a hovered highlight.
  const handleOpenThread = useCallback(() => {
    if (popover?.type !== 'remove' || !popover.highlightId) return
    const highlights =
      useChatStore.getState().sessionHighlights[sessionId] ?? []
    const hl = highlights.find(h => h.id === popover.highlightId)
    if (!hl) return
    const tid = useHighlightThreadsStore.getState().threadByHighlight[hl.id]
    if (!tid) return
    useHighlightThreadsStore.getState().openPanel({
      threadId: tid,
      highlightId: hl.id,
      sessionId,
      quotedText: hl.text,
      x: popover.x,
      y: popover.y,
      isNew: false,
    })
    setPopover(null)
  }, [popover, sessionId])

  // Subscribe so we re-render when a thread appears/disappears for the
  // currently hovered highlight (controls visibility of "Open thread" button).
  const hoveredHasThread = useHighlightThreadsStore(state =>
    popover?.type === 'remove' && popover.highlightId
      ? Boolean(state.threadByHighlight[popover.highlightId])
      : false
  )

  if (!popover) return null

  return (
    <div
      ref={popoverRef}
      className="fixed z-50 flex items-center gap-1"
      style={{
        left: popover.x,
        top: popover.y,
      }}
      onMouseEnter={handlePopoverMouseEnter}
      onMouseLeave={handlePopoverMouseLeave}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={popover.type === 'add' ? handleAdd : handleRemove}
            className={`p-1 rounded-md shadow-md border border-border cursor-pointer transition-colors ${
              popover.type === 'remove'
                ? 'bg-destructive hover:bg-destructive/90 text-destructive-foreground'
                : 'bg-yellow-500 hover:bg-yellow-600 text-white'
            }`}
          >
            {popover.type === 'remove' ? (
              <X className="size-3.5" />
            ) : (
              <Highlighter className="size-3.5" />
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent>
          {popover.type === 'remove' ? 'Remove highlight' : 'Highlight text'}
        </TooltipContent>
      </Tooltip>

      {/* [STRAJK FORK] Side-discussion entry points. */}
      {popover.type === 'add' && (
        <>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={handleAsk}
                className="p-1 rounded-md shadow-md border border-border cursor-pointer transition-colors bg-blue-500 hover:bg-blue-600 text-white"
              >
                <MessageCirclePlus className="size-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Ask about this</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={handleCopyMarkdown}
                className="p-1 rounded-md shadow-md border border-border cursor-pointer transition-colors bg-slate-600 hover:bg-slate-700 text-white"
              >
                <ClipboardCopy className="size-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Copy as markdown</TooltipContent>
          </Tooltip>
        </>
      )}
      {popover.type === 'remove' && hoveredHasThread && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={handleOpenThread}
              className="p-1 rounded-md shadow-md border border-border cursor-pointer transition-colors bg-blue-500 hover:bg-blue-600 text-white"
            >
              <MessageCircle className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Open thread</TooltipContent>
        </Tooltip>
      )}
    </div>
  )
}

/**
 * [STRAJK FORK] Clamp the action-popover anchor position to stay inside the
 * viewport. The popover renders right of `x` and 32px above `rect.top`, so:
 *   - `x` must leave room for ~POPOVER_WIDTH on the right.
 *   - `y` must leave room above; if the selection is at the very top of the
 *     viewport, flip the popover to BELOW the selection instead.
 */
function clampPopoverPosition(rect: {
  top: number
  bottom: number
  right: number
}): { x: number; y: number } {
  // Conservative width estimate: 3 buttons × ~28px + gaps + a little slack.
  const POPOVER_WIDTH = 130
  const POPOVER_HEIGHT = 32
  const MARGIN = 8

  const x = Math.max(
    MARGIN,
    Math.min(rect.right, window.innerWidth - POPOVER_WIDTH - MARGIN)
  )

  // Prefer above the selection, but flip below if there isn't 32px of space.
  const aboveY = rect.top - POPOVER_HEIGHT
  const y =
    aboveY < MARGIN
      ? Math.min(rect.bottom + 4, window.innerHeight - POPOVER_HEIGHT - MARGIN)
      : aboveY

  return { x, y }
}

/** Walk up the DOM to find the nearest element with data-message-id */
function findMessageElement(node: Node): Element | null {
  let current: Node | null = node
  while (current) {
    if (current instanceof Element && current.hasAttribute('data-message-id')) {
      return current
    }
    current = current.parentNode
  }
  return null
}

/** Compute the text offset of a position within a message element */
function getTextOffset(
  container: Element,
  targetNode: Node,
  targetOffset: number
): number {
  const walker = document.createTreeWalker(
    container,
    NodeFilter.SHOW_TEXT,
    null
  )

  let offset = 0
  let node: Text | null
  while ((node = walker.nextNode() as Text | null)) {
    if (node === targetNode) {
      return offset + targetOffset
    }
    offset += node.textContent?.length ?? 0
  }
  return offset
}
