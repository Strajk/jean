// ============================================================================
// [STRAJK FORK] Wires Rust `highlight-thread:*` events into the Zustand store.
// Mount once near the app root (we mount it in ChatWindow).
// ============================================================================

import { useEffect } from 'react'
import { listen } from '@/lib/transport'
import { useHighlightThreadsStore } from '@/store/highlight-threads-store'

interface ChunkEvent {
  thread_id: string
  content: string
}
interface DoneEvent {
  thread_id: string
  full_content: string
}
interface ErrorEvent {
  thread_id: string
  error: string
}
interface CancelledEvent {
  thread_id: string
}

export function useHighlightThreadEvents(): void {
  useEffect(() => {
    const unlisteners: (() => void)[] = []

    listen<ChunkEvent>('highlight-thread:chunk', e => {
      useHighlightThreadsStore
        .getState()
        .appendChunk(e.payload.thread_id, e.payload.content)
    }).then(unlisten => unlisteners.push(unlisten))

    listen<DoneEvent>('highlight-thread:done', e => {
      useHighlightThreadsStore
        .getState()
        .markDone(e.payload.thread_id, e.payload.full_content)
    }).then(unlisten => unlisteners.push(unlisten))

    listen<ErrorEvent>('highlight-thread:error', e => {
      useHighlightThreadsStore
        .getState()
        .markError(e.payload.thread_id, e.payload.error)
    }).then(unlisten => unlisteners.push(unlisten))

    listen<CancelledEvent>('highlight-thread:cancelled', e => {
      useHighlightThreadsStore.getState().markCancelled(e.payload.thread_id)
    }).then(unlisten => unlisteners.push(unlisten))

    return () => {
      for (const u of unlisteners) u()
    }
  }, [])
}
