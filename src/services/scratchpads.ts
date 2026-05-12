// [STRAJK FORK] Query hooks for scratchpad indicator dots.
//
// The Scratchpad panel itself owns the read/write of the active pad; this
// service only powers the "does this session/project have notes?" UI signal.

import { useQuery } from '@tanstack/react-query'
import { invoke } from '@/lib/transport'

export type ScratchpadScope = 'session' | 'project'

export const scratchpadQueryKeys = {
  all: ['scratchpads'] as const,
  nonEmpty: (scope: ScratchpadScope) =>
    ['scratchpads', 'non-empty', scope] as const,
}

/**
 * Returns the set of ids (session ids or project ids depending on scope)
 * whose scratchpad file has at least one non-whitespace character.
 *
 * Cached per-scope. Invalidated globally by the `cache:invalidate` event
 * with key `scratchpads` (emitted from the Rust write_scratchpad dispatch).
 */
export function useNonEmptyScratchpads(scope: ScratchpadScope) {
  return useQuery({
    queryKey: scratchpadQueryKeys.nonEmpty(scope),
    queryFn: async () => {
      const ids = await invoke<string[]>('list_non_empty_scratchpads', {
        scope,
      })
      return new Set(ids)
    },
    // Notes change rarely from outside the app, but cheap to refetch on
    // focus so a write from another window updates the dot.
    staleTime: 30_000,
  })
}
