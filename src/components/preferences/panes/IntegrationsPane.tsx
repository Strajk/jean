import React, { useState } from 'react'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Loader2, CheckCircle2, AlertCircle } from 'lucide-react'
import { invoke } from '@tauri-apps/api/core'
import { usePreferences, usePatchPreferences } from '@/services/preferences'
import { SettingsSection } from '../SettingsSection'

const InlineField: React.FC<{
  label: string
  description?: React.ReactNode
  children: React.ReactNode
}> = ({ label, description, children }) => (
  <div className="space-y-2">
    <div className="space-y-0.5">
      <Label className="text-sm text-foreground">{label}</Label>
      {description && (
        <div className="text-xs text-muted-foreground">{description}</div>
      )}
    </div>
    {children}
  </div>
)

export const IntegrationsPane: React.FC = () => {
  const { data: preferences } = usePreferences()
  const patchPreferences = usePatchPreferences()

  const [localLinearApiKey, setLocalLinearApiKey] = useState<string | null>(
    null
  )
  const [showLinearApiKey, setShowLinearApiKey] = useState(false)

  const currentGlobalKey = preferences?.linear_api_key ?? ''
  const displayedLinearApiKey = localLinearApiKey ?? currentGlobalKey
  const linearApiKeyChanged =
    localLinearApiKey !== null && localLinearApiKey !== currentGlobalKey

  const handleSaveLinearApiKey = () => {
    if (localLinearApiKey === null) return
    patchPreferences.mutate(
      { linear_api_key: localLinearApiKey.trim() || null },
      { onSuccess: () => setLocalLinearApiKey(null) }
    )
  }

  const handleClearLinearApiKey = () => {
    patchPreferences.mutate(
      { linear_api_key: null },
      { onSuccess: () => setLocalLinearApiKey(null) }
    )
  }

  // [strajk-fork] mcporter backend state. See xx-linear-mcporter.md.
  const linearBackend = preferences?.linear_backend ?? 'pat'

  const [localMcporterTeam, setLocalMcporterTeam] = useState<string | null>(
    null
  )
  const [localMcporterBinary, setLocalMcporterBinary] = useState<string | null>(
    null
  )
  const [mcporterTestState, setMcporterTestState] = useState<{
    status: 'idle' | 'testing' | 'ok' | 'err'
    message?: string
  }>({ status: 'idle' })

  const currentMcporterTeam = preferences?.linear_mcporter_team ?? ''
  const currentMcporterBinary = preferences?.linear_mcporter_binary ?? ''
  const displayedMcporterTeam = localMcporterTeam ?? currentMcporterTeam
  const displayedMcporterBinary = localMcporterBinary ?? currentMcporterBinary
  const mcporterTeamChanged =
    localMcporterTeam !== null && localMcporterTeam !== currentMcporterTeam
  const mcporterBinaryChanged =
    localMcporterBinary !== null &&
    localMcporterBinary !== currentMcporterBinary
  const mcporterChanged = mcporterTeamChanged || mcporterBinaryChanged

  const handleSaveMcporterSettings = () => {
    const patch: Record<string, string | null> = {}
    if (mcporterTeamChanged) {
      patch.linear_mcporter_team = (localMcporterTeam ?? '').trim() || null
    }
    if (mcporterBinaryChanged) {
      patch.linear_mcporter_binary =
        (localMcporterBinary ?? '').trim() || null
    }
    if (Object.keys(patch).length === 0) return
    patchPreferences.mutate(patch, {
      onSuccess: () => {
        setLocalMcporterTeam(null)
        setLocalMcporterBinary(null)
      },
    })
  }

  // Test connection by invoking list_linear_teams via the existing Tauri command.
  // With backend=mcporter, this routes through linear_mcporter::list_teams which spawns mcporter.
  const handleTestMcporter = async () => {
    setMcporterTestState({ status: 'testing' })
    try {
      const teams = await invoke<{ id: string; name: string }[]>(
        'list_linear_teams',
        { project_id: '__test__' }
      )
      setMcporterTestState({
        status: 'ok',
        message: `Connected — ${teams.length} team${teams.length === 1 ? '' : 's'} visible`,
      })
    } catch (err) {
      setMcporterTestState({
        status: 'err',
        message: String(err),
      })
    }
  }

  return (
    <div className="space-y-6">
      <SettingsSection
        title="Linear"
        anchorId="pref-integrations-section-linear"
      >
        {/* [strajk-fork] Backend selector */}
        <InlineField
          label="Backend"
          description={
            <>
              Choose how Jean reads Linear data. <strong>Personal API key</strong>{' '}
              is the default. <strong>mcporter MCP</strong> shells out to your
              authed{' '}
              <a
                href="https://github.com/runebookai/mcporter"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline underline-offset-2"
              >
                mcporter
              </a>{' '}
              Linear server — useful when your org disables personal API keys.
            </>
          }
        >
          <NativeSelect
            value={linearBackend}
            onChange={e => {
              const next = e.target.value
              patchPreferences.mutate({
                linear_backend:
                  next === 'mcporter' ? 'mcporter' : null,
              })
            }}
            className="max-w-xs"
          >
            <NativeSelectOption value="pat">
              Personal API key
            </NativeSelectOption>
            <NativeSelectOption value="mcporter">
              mcporter MCP
            </NativeSelectOption>
          </NativeSelect>
        </InlineField>

        {linearBackend !== 'mcporter' && (
          <InlineField
            label="Personal API Key"
            description={
              <>
                Your Linear personal API key, used by all projects unless
                overridden in project settings. Get one from{' '}
                <a
                  href="https://linear.app/settings/api"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline underline-offset-2"
                >
                  Linear Settings
                </a>
              </>
            }
          >
            <div className="flex items-center gap-2">
              <Input
                type={showLinearApiKey ? 'text' : 'password'}
                placeholder="lin_api_..."
                value={displayedLinearApiKey}
                onChange={e => setLocalLinearApiKey(e.target.value)}
                className="flex-1 text-base md:text-sm font-mono"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowLinearApiKey(!showLinearApiKey)}
              >
                {showLinearApiKey ? 'Hide' : 'Show'}
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                onClick={handleSaveLinearApiKey}
                disabled={!linearApiKeyChanged || patchPreferences.isPending}
              >
                {patchPreferences.isPending && (
                  <Loader2 className="h-4 w-4 animate-spin" />
                )}
                Save
              </Button>
              {currentGlobalKey && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleClearLinearApiKey}
                  disabled={patchPreferences.isPending}
                >
                  Remove
                </Button>
              )}
            </div>
          </InlineField>
        )}

        {linearBackend === 'mcporter' && (
          <>
            <InlineField
              label="Team key / name"
              description={
                <>
                  Optional. Filters issues to one team (e.g. <code>ENG</code>{' '}
                  or <code>Backend</code>). Required for &ldquo;open by
                  number&rdquo; flows so Jean can build identifiers like{' '}
                  <code>ENG-123</code>. Leave empty to see issues from every
                  team you have access to.
                </>
              }
            >
              <Input
                placeholder="ENG"
                value={displayedMcporterTeam}
                onChange={e => setLocalMcporterTeam(e.target.value)}
                className="flex-1 text-base md:text-sm font-mono max-w-xs"
              />
            </InlineField>

            <InlineField
              label="mcporter binary"
              description={
                <>
                  Optional. Absolute path to the <code>mcporter</code> binary.
                  Leave empty to use whatever is on your shell PATH (recommended
                  for most setups).
                </>
              }
            >
              <Input
                placeholder="/opt/homebrew/bin/mcporter"
                value={displayedMcporterBinary}
                onChange={e => setLocalMcporterBinary(e.target.value)}
                className="flex-1 text-base md:text-sm font-mono"
              />
            </InlineField>

            <div className="flex items-center gap-2">
              <Button
                size="sm"
                onClick={handleSaveMcporterSettings}
                disabled={!mcporterChanged || patchPreferences.isPending}
              >
                {patchPreferences.isPending && (
                  <Loader2 className="h-4 w-4 animate-spin" />
                )}
                Save
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleTestMcporter}
                disabled={mcporterTestState.status === 'testing'}
              >
                {mcporterTestState.status === 'testing' && (
                  <Loader2 className="h-4 w-4 animate-spin" />
                )}
                Test connection
              </Button>
              {mcporterTestState.status === 'ok' && (
                <span className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {mcporterTestState.message}
                </span>
              )}
              {mcporterTestState.status === 'err' && (
                <span className="text-xs text-destructive flex items-center gap-1">
                  <AlertCircle className="h-3.5 w-3.5" />
                  {mcporterTestState.message}
                </span>
              )}
            </div>
          </>
        )}
      </SettingsSection>
    </div>
  )
}
