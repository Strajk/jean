import { memo, useMemo } from 'react'
import type { ToolCall } from '@/types/chat'
import { Badge } from '@/components/ui/badge'
import { getFilename } from '@/lib/path-utils'
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip'
import type { FileEdit } from './FileEditsDiffModal'

interface EditInput {
  file_path: string
  old_string?: string
  new_string?: string
}

/** Type guard: ToolCall is a Claude Edit with file_path. */
function isEditTool(
  toolCall: ToolCall
): toolCall is ToolCall & { input: EditInput } {
  return (
    toolCall.name === 'Edit' &&
    typeof toolCall.input === 'object' &&
    toolCall.input !== null &&
    'file_path' in toolCall.input &&
    typeof (toolCall.input as Record<string, unknown>).file_path === 'string'
  )
}

interface EditedFilesDisplayProps {
  toolCalls: ToolCall[] | undefined
  onFileClick: (path: string, edits: FileEdit[]) => void
  /** Option/Alt+click handler — opens git diff (uncommitted vs working tree) instead of session-edit diff */
  onFileDiffClick?: (path: string) => void
}

/**
 * Display edited files at the bottom of assistant messages.
 * Collects all Edit tool calls and shows unique file paths as clickable pills.
 * Plain click opens the session-edit diff modal (every edit applied to that file during this turn).
 * Option/Alt+click opens the git diff modal showing uncommitted changes for the file.
 */
export const EditedFilesDisplay = memo(function EditedFilesDisplay({
  toolCalls,
  onFileClick,
  onFileDiffClick,
}: EditedFilesDisplayProps) {
  const editsByPath = useMemo(() => {
    const map = new Map<string, FileEdit[]>()
    if (!toolCalls) return map
    for (const tc of toolCalls) {
      if (!isEditTool(tc)) continue
      const list = map.get(tc.input.file_path) ?? []
      list.push({
        oldString: tc.input.old_string ?? '',
        newString: tc.input.new_string ?? '',
      })
      map.set(tc.input.file_path, list)
    }
    return map
  }, [toolCalls])

  if (editsByPath.size === 0) return null

  const uniqueFilePaths = Array.from(editsByPath.keys())

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground/70">
      <span>
        Edited {uniqueFilePaths.length} file
        {uniqueFilePaths.length === 1 ? '' : 's'}:
      </span>
      {uniqueFilePaths.map(filePath => (
        <Tooltip key={filePath}>
          <TooltipTrigger asChild>
            <Badge
              variant="outline"
              className="cursor-pointer"
              onClick={e => {
                if (e.altKey && onFileDiffClick) {
                  onFileDiffClick(filePath)
                } else {
                  onFileClick(filePath, editsByPath.get(filePath) ?? [])
                }
              }}
            >
              {getFilename(filePath)}
            </Badge>
          </TooltipTrigger>
          <TooltipContent>
            {filePath}
            {onFileDiffClick && (
              <span className="ml-1 opacity-60">(⌥-click for diff)</span>
            )}
          </TooltipContent>
        </Tooltip>
      ))}
    </div>
  )
})
