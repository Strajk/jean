import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { Play } from 'lucide-react'
import { invoke } from '@/lib/transport'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { playNotificationSound } from '@/lib/sounds'
import {
  customNotificationSoundOptions,
  type NotificationSound,
} from '@/types/preferences'

// OS-provided alert sounds (e.g. /System/Library/Sounds on macOS). Enumerated
// at request time by the Rust side; cached for the session since the list rarely
// changes while the app is running.
interface SystemSound {
  id: string
  label: string
}

function useSystemSounds() {
  return useQuery<SystemSound[]>({
    queryKey: ['system-sounds'],
    queryFn: () => invoke<SystemSound[]>('list_system_sounds'),
    staleTime: 5 * 60 * 1000,
  })
}

const SYSTEM_PREFIX = 'system:'

export const NotificationSoundPicker: React.FC<{
  value: NotificationSound
  onChange: (value: NotificationSound) => void
}> = ({ value, onChange }) => {
  const { data: systemSounds = [] } = useSystemSounds()

  // If the saved value is a system sound the current OS doesn't expose (e.g. user
  // saved on macOS, opened on Linux), surface it as a disabled entry so the user
  // can still see what they had selected.
  const orphanedSystemId =
    value.startsWith(SYSTEM_PREFIX) &&
    !systemSounds.some(s => `${SYSTEM_PREFIX}${s.id}` === value)
      ? value.slice(SYSTEM_PREFIX.length)
      : null

  return (
    <div className="flex items-center gap-2">
      <Select
        value={value}
        onValueChange={v => onChange(v as NotificationSound)}
      >
        <SelectTrigger className="w-full sm:min-w-96">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">None</SelectItem>
          <SelectGroup>
            <SelectLabel>Custom</SelectLabel>
            {customNotificationSoundOptions.map(option => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectGroup>
          {systemSounds.length > 0 && (
            <SelectGroup>
              <SelectLabel>System</SelectLabel>
              {systemSounds.map(sound => (
                <SelectItem
                  key={sound.id}
                  value={`${SYSTEM_PREFIX}${sound.id}`}
                >
                  {sound.label}
                </SelectItem>
              ))}
              {orphanedSystemId && (
                <SelectItem value={value} disabled>
                  {orphanedSystemId} (unavailable)
                </SelectItem>
              )}
            </SelectGroup>
          )}
        </SelectContent>
      </Select>
      <Button
        variant="outline"
        size="icon"
        disabled={value === 'none'}
        onClick={() => playNotificationSound(value)}
      >
        <Play className="h-4 w-4" />
      </Button>
    </div>
  )
}
