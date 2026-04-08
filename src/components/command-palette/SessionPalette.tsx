import { useEffect, useState, useCallback, useMemo, type ReactNode } from 'react'
import { defaultFilter } from 'cmdk'
import { useUIStore } from '@/store/ui-store'
import { useProjectsStore } from '@/store/projects-store'
import { useChatStore } from '@/store/chat-store'
import { useAllSessions } from '@/services/chat'
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from '@/components/ui/command'
import type { Session } from '@/types/chat'

/** Format a unix timestamp (seconds) to relative time like "2h ago" */
function formatRelativeTime(timestamp: number): string {
  const ms = timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp
  const diffMs = Date.now() - ms
  if (diffMs < 0) return 'just now'
  const minuteMs = 60_000
  const hourMs = 60 * minuteMs
  const dayMs = 24 * hourMs
  if (diffMs < hourMs) {
    const minutes = Math.max(1, Math.floor(diffMs / minuteMs))
    return `${minutes}m ago`
  }
  if (diffMs < dayMs) {
    const hours = Math.floor(diffMs / hourMs)
    return `${hours}h ago`
  }
  const days = Math.floor(diffMs / dayMs)
  return `${days}d ago`
}

interface FlatSession {
  session: Session
  projectId: string
  projectName: string
  worktreeId: string
  worktreeName: string
  worktreePath: string
}

// Greedy left-to-right subsequence match. Returns indices in `text` where each
// query character lands, or null if the query isn't a subsequence of the text.
// This is independent of cmdk's scorer (which doesn't expose positions) and
// just exists so we can paint the matched glyphs in the result rows.
function fuzzyMatchPositions(text: string, query: string): number[] | null {
  if (!query) return null
  const t = text.toLowerCase()
  const q = query.toLowerCase()
  const positions: number[] = []
  let qi = 0
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) {
      positions.push(i)
      qi++
    }
  }
  return qi === q.length ? positions : null
}

function Highlight({
  text,
  query,
}: {
  text: string
  query: string
}): ReactNode {
  const trimmed = query.trim()
  if (!trimmed) return text
  const positions = fuzzyMatchPositions(text, trimmed)
  if (!positions || positions.length === 0) return text

  const set = new Set(positions)
  const out: ReactNode[] = []
  let buffer = ''
  let bufferIsMatch = false
  for (let i = 0; i < text.length; i++) {
    const isMatch = set.has(i)
    if (i === 0) {
      buffer = text.charAt(i)
      bufferIsMatch = isMatch
      continue
    }
    if (isMatch === bufferIsMatch) {
      buffer += text.charAt(i)
    } else {
      out.push(
        bufferIsMatch ? (
          <mark
            key={out.length}
            className="rounded-[2px] bg-yellow-400/40 text-inherit dark:bg-yellow-400/30"
          >
            {buffer}
          </mark>
        ) : (
          <span key={out.length}>{buffer}</span>
        )
      )
      buffer = text.charAt(i)
      bufferIsMatch = isMatch
    }
  }
  if (buffer) {
    out.push(
      bufferIsMatch ? (
        <mark
          key={out.length}
          className="rounded-[2px] bg-yellow-400/40 text-inherit dark:bg-yellow-400/30"
        >
          {buffer}
        </mark>
      ) : (
        <span key={out.length}>{buffer}</span>
      )
    )
  }
  return <>{out}</>
}

export function SessionPalette() {
  const sessionPaletteOpen = useUIStore(state => state.sessionPaletteOpen)
  const setSessionPaletteOpen = useUIStore(
    state => state.setSessionPaletteOpen
  )
  const [search, setSearch] = useState('')

  // Lazy-load sessions only when palette is open
  const { data: allSessions } = useAllSessions(sessionPaletteOpen)

  // Flatten, filter archived, sort by updated_at desc
  const flatSessions = useMemo((): FlatSession[] => {
    if (!allSessions?.entries) return []

    const result: FlatSession[] = []
    for (const entry of allSessions.entries) {
      for (const session of entry.sessions) {
        if (session.archived_at) continue
        result.push({
          session,
          projectId: entry.project_id,
          projectName: entry.project_name,
          worktreeId: entry.worktree_id,
          worktreeName: entry.worktree_name,
          worktreePath: entry.worktree_path,
        })
      }
    }

    result.sort((a, b) => b.session.updated_at - a.session.updated_at)
    return result
  }, [allSessions])

  // Group by project for display
  const groupedSessions = useMemo(() => {
    const groups = new Map<string, FlatSession[]>()
    for (const item of flatSessions) {
      const existing = groups.get(item.projectName)
      if (existing) {
        existing.push(item)
      } else {
        groups.set(item.projectName, [item])
      }
    }
    return groups
  }, [flatSessions])

  const handleSelect = useCallback(
    (item: FlatSession) => {
      setSessionPaletteOpen(false)
      setSearch('')

      const currentProjectId =
        useProjectsStore.getState().selectedProjectId

      // Clear active worktree so we land on ProjectCanvasView
      useChatStore.getState().clearActiveWorktree()

      const crossProject = currentProjectId !== item.projectId

      if (crossProject) {
        // Race-condition safe: store intent in Zustand, then switch project.
        // ProjectCanvasView consumes the intent on mount.
        useUIStore
          .getState()
          .markWorktreeForAutoOpenSession(item.worktreeId, item.session.id)
        useProjectsStore.getState().selectProject(item.projectId)
      } else {
        // Same project — set the active session, then fire event for the
        // already-mounted ProjectCanvasView.
        useChatStore
          .getState()
          .setActiveSession(item.worktreeId, item.session.id)
        setTimeout(() => {
          window.dispatchEvent(
            new CustomEvent('open-session-modal', {
              detail: {
                sessionId: item.session.id,
                worktreeId: item.worktreeId,
                worktreePath: item.worktreePath,
              },
            })
          )
        }, 50)
      }
    },
    [setSessionPaletteOpen]
  )

  const handleOpenChange = useCallback(
    (open: boolean) => {
      setSessionPaletteOpen(open)
      if (!open) setSearch('')
    },
    [setSessionPaletteOpen]
  )

  // Effective per-field queries for highlighting. With `>`, the left half
  // applies to the project name and the right half to session/worktree text.
  // Without `>`, the same query is tried against both fields — whichever
  // happens to match gets highlighted (the other field is left untouched).
  const { projectQuery, sessionQuery } = useMemo(() => {
    const delim = search.indexOf('>')
    if (delim < 0) return { projectQuery: search, sessionQuery: search }
    return {
      projectQuery: search.slice(0, delim).trim(),
      sessionQuery: search.slice(delim + 1).trim(),
    }
  }, [search])

  // `>` splits the query into a project filter (left) and a session filter
  // (right). Each side is fuzzy-matched independently using cmdk's default
  // scorer, against `keywords[0]` (project) and `keywords[1]` (session +
  // worktree) respectively. Without `>`, fall back to cmdk's default behavior
  // so single-token searches keep working as before.
  const filter = useCallback(
    (value: string, search: string, keywords?: string[]): number => {
      const delim = search.indexOf('>')
      if (delim < 0) return defaultFilter(value, search, keywords)

      const projQuery = search.slice(0, delim).trim()
      const sessQuery = search.slice(delim + 1).trim()
      const projText = keywords?.[0] ?? ''
      const sessText = keywords?.[1] ?? ''

      const projScore = projQuery ? defaultFilter(projText, projQuery) : 1
      const sessScore = sessQuery ? defaultFilter(sessText, sessQuery) : 1
      return projScore && sessScore ? projScore * sessScore : 0
    },
    []
  )

  // Cmd+P keybinding (with !shiftKey guard to avoid conflict with Cmd+Shift+P)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'p' && (e.metaKey || e.ctrlKey) && !e.shiftKey) {
        e.preventDefault()
        setSessionPaletteOpen(!sessionPaletteOpen)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [sessionPaletteOpen, setSessionPaletteOpen])

  return (
    <CommandDialog
      open={sessionPaletteOpen}
      onOpenChange={handleOpenChange}
      title="Go to Session"
      description="Search sessions across all projects"
      className="top-4 translate-y-0 sm:top-[50%] sm:translate-y-[-50%] sm:max-w-2xl"
      disablePointerSelection
      filter={filter}
    >
      <CommandInput
        placeholder="Search sessions..."
        value={search}
        onValueChange={setSearch}
      />
      <CommandList className="max-h-[800px]">
        <CommandEmpty>No sessions found.</CommandEmpty>

        {Array.from(groupedSessions.entries()).map(
          ([projectName, sessions]) => (
            <CommandGroup
              key={projectName}
              heading={<Highlight text={projectName} query={projectQuery} />}
            >
              {sessions.map(item => (
                <CommandItem
                  key={`${item.worktreeId}-${item.session.id}`}
                  value={`${item.session.name} ${item.worktreeName} ${item.projectName}`}
                  keywords={[
                    item.projectName,
                    `${item.session.name} ${item.worktreeName}`,
                  ]}
                  onSelect={() => handleSelect(item)}
                >
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="truncate">
                      <Highlight
                        text={item.session.name}
                        query={sessionQuery}
                      />
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      <Highlight
                        text={item.worktreeName}
                        query={sessionQuery}
                      />
                    </span>
                  </div>
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                    {formatRelativeTime(item.session.updated_at)}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          )
        )}
      </CommandList>
    </CommandDialog>
  )
}
