// ============================================================================
// [STRAJK FORK] Scratchpad — per-session and per-project markdown notes panel.
// ============================================================================
//
// Cmd+J toggles the session-scoped scratchpad; Shift+Cmd+J toggles the
// project-scoped one. Both share this component and just point at a different
// storage key.
//
// Submit-selection mechanic: when the user has a non-empty selection inside
// the textarea and presses Cmd+Enter, the selected slice is dispatched to
// ChatWindow via the `scratchpad:submit-text` event (which routes through the
// regular chat send pipeline so model/mode/MCP settings are honoured), the
// selection is removed from the pad, and the panel closes. Useful for "draft
// in markdown, send pieces as I'm ready".
//
// Why a custom event rather than calling the chat store directly: the chat
// send pipeline lives inside ChatWindow's hooks (refs to model/mode/etc.) and
// recreating that surface here would mean keeping two copies in sync.

import { useCallback, useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { invoke } from '@/lib/transport'
import { useUIStore } from '@/store/ui-store'
import { useChatStore } from '@/store/chat-store'
import { useProjectsStore } from '@/store/projects-store'
import { logger } from '@/lib/logger'
import { cn } from '@/lib/utils'
import { scratchpadQueryKeys } from '@/services/scratchpads'

const AUTOSAVE_DEBOUNCE_MS = 400

function resolveScopeId(scope: 'session' | 'project'): string | null {
  if (scope === 'project') {
    return useProjectsStore.getState().selectedProjectId
  }
  // Session scope: prefer the session backing the chat modal (if open),
  // otherwise the active session in the chat view. Without an active session
  // there's nothing to attach the scratchpad to — caller falls back to a
  // toast. We deliberately don't auto-pick "the most recent session" because
  // that surprises users; an empty-state hint is clearer.
  const ui = useUIStore.getState()
  const chat = useChatStore.getState()
  const wid = ui.sessionChatModalOpen
    ? (ui.sessionChatModalWorktreeId ?? chat.activeWorktreeId)
    : chat.activeWorktreeId
  if (!wid) return null
  return chat.activeSessionIds[wid] ?? null
}

export function Scratchpad() {
  const scope = useUIStore(state => state.scratchpadOpen)
  const setScratchpadOpen = useUIStore(state => state.setScratchpadOpen)
  const queryClient = useQueryClient()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [content, setContent] = useState('')
  const [scopeId, setScopeId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  // Track the scope+id that the current `content` belongs to, so the
  // autosave effect doesn't accidentally persist a freshly-loaded value back
  // to the file (and clobber concurrent writes from another window).
  const loadedKeyRef = useRef<string | null>(null)

  // Resolve scope id when scratchpad opens. We re-resolve on every open so
  // moving between sessions/projects doesn't show a stale pad.
  useEffect(() => {
    if (!scope) return
    const id = resolveScopeId(scope)
    setScopeId(id)
  }, [scope])

  // Load content for the current scope.
  useEffect(() => {
    if (!scope || !scopeId) {
      setContent('')
      loadedKeyRef.current = null
      return
    }
    let cancelled = false
    setLoading(true)
    invoke<string>('read_scratchpad', { scope, scopeId })
      .then(value => {
        if (cancelled) return
        setContent(value ?? '')
        loadedKeyRef.current = `${scope}:${scopeId}`
      })
      .catch(err => {
        logger.error('Scratchpad: read failed', { error: String(err) })
        if (!cancelled) {
          setContent('')
          loadedKeyRef.current = `${scope}:${scopeId}`
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [scope, scopeId])

  // Debounced autosave. We compare the current scope key to the loaded key
  // so the initial "load" doesn't trigger a write.
  useEffect(() => {
    if (!scope || !scopeId) return
    const key = `${scope}:${scopeId}`
    if (loadedKeyRef.current !== key) return
    const handle = setTimeout(() => {
      invoke('write_scratchpad', { scope, scopeId, content })
        .then(() => {
          // Refresh sidebar indicator dot — non-empty status may have flipped.
          queryClient.invalidateQueries({ queryKey: scratchpadQueryKeys.all })
        })
        .catch(err => {
          logger.error('Scratchpad: write failed', { error: String(err) })
        })
    }, AUTOSAVE_DEBOUNCE_MS)
    return () => clearTimeout(handle)
  }, [content, scope, scopeId, queryClient])

  // Autofocus the textarea when the panel opens or scope switches.
  useEffect(() => {
    if (!scope || loading) return
    const id = window.setTimeout(() => {
      textareaRef.current?.focus()
    }, 0)
    return () => window.clearTimeout(id)
  }, [scope, loading])

  const close = useCallback(() => setScratchpadOpen(null), [setScratchpadOpen])

  // Esc closes the panel (textarea must allow Escape to bubble).
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        close()
        return
      }
      // Cmd+Enter on a non-empty selection: submit the selection as a chat
      // message and remove it from the pad. If the selection is empty, fall
      // through (and let the keybinding system handle plan-approval etc.).
      const isMod = e.metaKey || e.ctrlKey
      if (isMod && e.key === 'Enter') {
        const ta = textareaRef.current
        if (!ta) return
        const start = ta.selectionStart ?? 0
        const end = ta.selectionEnd ?? 0
        if (start === end) return // No selection — let other handlers run.
        const selected = content.slice(start, end).trim()
        if (!selected) return
        e.preventDefault()
        e.stopPropagation()

        // Dispatch into ChatWindow's send pipeline. ChatWindow has the
        // refs (model/mode/etc.) needed to build a proper QueuedMessage.
        window.dispatchEvent(
          new CustomEvent('scratchpad:submit-text', {
            detail: { text: selected },
          })
        )

        // Remove the selection from the pad. We splice rather than just
        // clearing so the user keeps any "later" notes that came after.
        const next = content.slice(0, start) + content.slice(end)
        setContent(next)
        // Persist synchronously before closing: the debounced autosave
        // effect would otherwise be cancelled by the unmount on close(),
        // and the spliced selection would reappear on next open.
        if (scope && scopeId) {
          invoke('write_scratchpad', {
            scope,
            scopeId,
            content: next,
          })
            .then(() => {
              queryClient.invalidateQueries({
                queryKey: scratchpadQueryKeys.all,
              })
            })
            .catch(err => {
              logger.error('Scratchpad: write-on-submit failed', {
                error: String(err),
              })
            })
        }
        close()
      }
    },
    [content, close, scope, scopeId, queryClient]
  )

  if (!scope) return null

  const heading = scope === 'session' ? 'Session scratchpad' : 'Project scratchpad'
  const emptyMessage =
    scope === 'session'
      ? 'Open a session to start a scratchpad. Notes are saved per session.'
      : 'Select a project to start a scratchpad. Notes are saved per project.'

  return (
    <>
      {/* Click-outside backdrop. Transparent so the chat behind stays
          visible — a scratchpad is meant to sit alongside the conversation,
          not replace it. */}
      <div
        className="fixed inset-0 z-40"
        onClick={close}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-label={heading}
        className={cn(
          'fixed right-4 bottom-4 top-16 z-50 flex w-[min(560px,calc(100vw-2rem))] flex-col',
          'rounded-lg border border-border bg-popover text-popover-foreground shadow-2xl'
        )}
        onClick={e => e.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
          <div className="flex flex-col">
            <span className="text-sm font-medium">{heading}</span>
            <span className="text-[11px] text-muted-foreground">
              {scope === 'session'
                ? 'Cmd+J · scoped to current session'
                : 'Shift+Cmd+J · scoped to current project'}
            </span>
          </div>
          <button
            type="button"
            onClick={close}
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            aria-label="Close scratchpad"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {!scopeId ? (
          <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">
            {emptyMessage}
          </div>
        ) : (
          <>
            <textarea
              ref={textareaRef}
              data-scratchpad-textarea=""
              value={content}
              onChange={e => setContent(e.target.value)}
              onKeyDown={handleKeyDown}
              spellCheck={false}
              placeholder={
                scope === 'session'
                  ? 'Markdown notes for this session…'
                  : 'Markdown notes for this project…'
              }
              className={cn(
                'flex-1 resize-none border-0 bg-transparent p-3 font-mono text-sm leading-relaxed outline-none',
                'placeholder:text-muted-foreground/60'
              )}
            />
            <footer className="border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
              <span className="font-medium">⌘↵</span> on a selection → send as
              user message and remove from pad
            </footer>
          </>
        )}
      </div>
    </>
  )
}
