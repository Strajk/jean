import { type ReactNode, useCallback } from 'react'
import {
  Archive,
  Eye,
  EyeOff,
  FileText,
  Pencil,
  Sparkles,
  Tag,
  Terminal,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { copyToClipboard } from '@/lib/clipboard'
import { useChatStore } from '@/store/chat-store'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import {
  getResumeCommand,
  type SessionCardData,
} from '@/components/chat/session-card-utils'

interface SidebarSessionContextMenuProps {
  card: SessionCardData
  worktreeId: string
  onArchive: (sessionId: string) => void
  onDelete: (sessionId: string) => void
  onLabelOpen: (sessionId: string) => void
  onSessionSelect: (sessionId: string) => void
  children: ReactNode
}

export function SidebarSessionContextMenu({
  card,
  worktreeId,
  onArchive,
  onDelete,
  onLabelOpen,
  onSessionSelect,
  children,
}: SidebarSessionContextMenuProps) {
  const { session, status, label } = card
  const hasRecap = card.hasRecap
  const hasPlan = !!(card.planFilePath || card.planContent)
  const resumeCommand = getResumeCommand(session)

  const handleRename = useCallback(() => {
    onSessionSelect(session.id)
    setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent('command:rename-session', {
          detail: { sessionId: session.id },
        })
      )
    }, 150)
  }, [session.id, onSessionSelect])

  const handleToggleReview = useCallback(() => {
    const { reviewingSessions, setSessionReviewing } =
      useChatStore.getState()
    const isReviewing =
      reviewingSessions[session.id] || !!session.review_results
    setSessionReviewing(session.id, !isReviewing)
  }, [session.id, session.review_results])

  const handleRecap = useCallback(() => {
    useChatStore.getState().setActiveSession(worktreeId, session.id)
    requestAnimationFrame(() => {
      window.dispatchEvent(new CustomEvent('open-recap'))
    })
  }, [worktreeId, session.id])

  const handlePlan = useCallback(() => {
    useChatStore.getState().setActiveSession(worktreeId, session.id)
    requestAnimationFrame(() => {
      window.dispatchEvent(new CustomEvent('open-plan'))
    })
  }, [worktreeId, session.id])

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-64">
        <ContextMenuItem onSelect={handleRename}>
          <Pencil className="mr-2 h-4 w-4" />
          Rename
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => onLabelOpen(session.id)}>
          <Tag className="mr-2 h-4 w-4" />
          {label ? 'Remove Label' : 'Add Label'}
        </ContextMenuItem>
        <ContextMenuItem onSelect={handleToggleReview}>
          {status === 'review' ? (
            <>
              <EyeOff className="mr-2 h-4 w-4" />
              Mark as Idle
            </>
          ) : (
            <>
              <Eye className="mr-2 h-4 w-4" />
              Mark for Review
            </>
          )}
        </ContextMenuItem>
        {resumeCommand && (
          <ContextMenuItem
            onSelect={() => {
              void copyToClipboard(resumeCommand)
                .then(() => toast.success('Resume command copied'))
                .catch(() => toast.error('Failed to copy resume command'))
            }}
          >
            <Terminal className="mr-2 h-4 w-4" />
            Copy Resume Command
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem disabled={!hasRecap} onSelect={handleRecap}>
          <Sparkles className="mr-2 h-4 w-4" />
          Recap
        </ContextMenuItem>
        <ContextMenuItem disabled={!hasPlan} onSelect={handlePlan}>
          <FileText className="mr-2 h-4 w-4" />
          Plan
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => onArchive(session.id)}>
          <Archive className="mr-2 h-4 w-4" />
          Archive Session
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          variant="destructive"
          onSelect={() => onDelete(session.id)}
        >
          <Trash2 className="mr-2 h-4 w-4" />
          Delete Session
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
