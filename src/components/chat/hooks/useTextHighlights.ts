import { useCallback, useEffect, useRef } from 'react'
import { useChatStore } from '@/store/chat-store'
import type { TextHighlight } from '@/types/chat'

const HIGHLIGHT_NAME = 'user-highlight'

/**
 * Manages rendering of user-created text highlights using the CSS Custom Highlight API.
 * Re-applies highlights whenever the message list re-renders (scrolling, new messages, etc.).
 *
 * @param sessionId - Current session ID
 * @param containerRef - Ref to the scrollable message container
 */
export function useTextHighlights(
  sessionId: string | undefined,
  containerRef: React.RefObject<HTMLDivElement | null>
) {
  const prevHighlightsRef = useRef<TextHighlight[]>([])

  // Apply highlights by walking the DOM and matching text
  const applyHighlights = useCallback(() => {
    if (!CSS.highlights || !containerRef.current || !sessionId) return

    const highlights =
      useChatStore.getState().sessionHighlights[sessionId] ?? []

    if (highlights.length === 0) {
      CSS.highlights.delete(HIGHLIGHT_NAME)
      return
    }

    const container = containerRef.current
    const ranges: Range[] = []

    // Group highlights by message_id for efficient DOM traversal
    const byMessage = new Map<string, TextHighlight[]>()
    for (const h of highlights) {
      const list = byMessage.get(h.message_id) ?? []
      list.push(h)
      byMessage.set(h.message_id, list)
    }

    for (const [messageId, messageHighlights] of byMessage) {
      // Find the message container element
      const messageEl = container.querySelector(
        `[data-message-id="${messageId}"]`
      )
      if (!messageEl) continue

      for (const highlight of messageHighlights) {
        const range = findTextRange(messageEl, highlight.text)
        if (range) {
          ranges.push(range)
        }
      }
    }

    if (ranges.length > 0) {
      CSS.highlights.set(HIGHLIGHT_NAME, new Highlight(...ranges))
    } else {
      CSS.highlights.delete(HIGHLIGHT_NAME)
    }
  }, [sessionId, containerRef])

  // Re-apply when highlights change in store
  useEffect(() => {
    if (!sessionId) return

    const unsubscribe = useChatStore.subscribe(state => {
      const current = state.sessionHighlights[sessionId] ?? []
      if (current !== prevHighlightsRef.current) {
        prevHighlightsRef.current = current
        // Small delay to let DOM settle after React render
        requestAnimationFrame(() => applyHighlights())
      }
    })

    return unsubscribe
  }, [sessionId, applyHighlights])

  // Re-apply on mount and when session changes.
  //
  // The bare 100ms timeout was racy: when navigating back to a session whose
  // messages haven't been rendered yet, `applyHighlights` runs but
  // `querySelector('[data-message-id]')` returns null, so highlights silently
  // never apply. The chat-store subscription doesn't rescue us because
  // `sessionHighlights[sessionId]` reference doesn't change between visits.
  //
  // Fix: watch the scroll container for new `[data-message-id]` elements and
  // re-apply when they appear. Throttled via rAF so a burst of message
  // renders doesn't thrash. The initial 100ms timeout is kept as a fast path
  // for the common case where messages are already in the DOM.
  useEffect(() => {
    if (!sessionId) return

    const timer = setTimeout(() => applyHighlights(), 100)

    let rafHandle = 0
    const scheduleApply = () => {
      if (rafHandle) return
      rafHandle = requestAnimationFrame(() => {
        rafHandle = 0
        applyHighlights()
      })
    }

    let observer: MutationObserver | null = null
    if (containerRef.current && typeof MutationObserver !== 'undefined') {
      observer = new MutationObserver(mutations => {
        // Only react to nodes that look like message containers — avoids
        // re-running on every text-stream chunk inside an existing message.
        for (const m of mutations) {
          for (const node of m.addedNodes) {
            if (
              node instanceof Element &&
              (node.hasAttribute('data-message-id') ||
                node.querySelector?.('[data-message-id]'))
            ) {
              scheduleApply()
              return
            }
          }
        }
      })
      observer.observe(containerRef.current, {
        childList: true,
        subtree: true,
      })
    }

    return () => {
      clearTimeout(timer)
      if (rafHandle) cancelAnimationFrame(rafHandle)
      observer?.disconnect()
      CSS.highlights?.delete(HIGHLIGHT_NAME)
    }
  }, [sessionId, applyHighlights, containerRef])

  // Expose manual re-apply for use after scroll/load-more
  return { applyHighlights }
}

/**
 * Find a text range in the DOM that matches the given text string.
 * Uses TreeWalker to walk text nodes and find the first occurrence.
 */
function findTextRange(container: Element, searchText: string): Range | null {
  const walker = document.createTreeWalker(
    container,
    NodeFilter.SHOW_TEXT,
    null
  )

  // Collect all text nodes and build a concatenated string
  const textNodes: Text[] = []
  const offsets: number[] = [] // cumulative offset of each text node
  let totalText = ''

  let node: Text | null
  while ((node = walker.nextNode() as Text | null)) {
    const content = node.textContent ?? ''
    offsets.push(totalText.length)
    totalText += content
    textNodes.push(node)
  }

  // Find the search text in the concatenated string
  const matchIndex = totalText.indexOf(searchText)
  if (matchIndex === -1) return null

  // Map the match back to DOM ranges
  const matchEnd = matchIndex + searchText.length
  let startNode: Text | null = null
  let startOffset = 0
  let endNode: Text | null = null
  let endOffset = 0

  for (let i = 0; i < textNodes.length; i++) {
    const nodeStart = offsets[i] ?? 0
    const node = textNodes[i]
    if (!node) continue
    const nodeEnd = nodeStart + (node.textContent?.length ?? 0)

    if (!startNode && matchIndex < nodeEnd) {
      startNode = node
      startOffset = matchIndex - nodeStart
    }
    if (matchEnd <= nodeEnd) {
      endNode = node
      endOffset = matchEnd - nodeStart
      break
    }
  }

  if (!startNode || !endNode) return null

  try {
    const range = new Range()
    range.setStart(startNode, startOffset)
    range.setEnd(endNode, endOffset)
    return range
  } catch {
    return null
  }
}
