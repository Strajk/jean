/**
 * CLI Version Check Hook
 *
 * Checks for CLI updates on application startup and shows toast notifications
 * with buttons to update directly.
 */

import { useEffect, useRef, useState } from 'react'
import {
  useClaudeCliStatus,
  useAvailableCliVersions,
  useClaudePathDetection,
} from '@/services/claude-cli'
import {
  useGhCliStatus,
  useAvailableGhVersions,
  useGhPathDetection,
} from '@/services/gh-cli'
import {
  useCodexCliStatus,
  useAvailableCodexVersions,
  useCodexPathDetection,
} from '@/services/codex-cli'
import {
  useOpencodeCliStatus,
  useAvailableOpencodeVersions,
  useOpencodePathDetection,
} from '@/services/opencode-cli'
import {
  usePiCliStatus,
  useAvailablePiVersions,
  usePiPathDetection,
  piCliQueryKeys,
} from '@/services/pi-cli'
import {
  useCodeRabbitCliStatus,
  useAvailableCodeRabbitVersions,
  useCodeRabbitPathDetection,
  coderabbitCliQueryKeys,
} from '@/services/coderabbit-cli'
import { useUIStore } from '@/store/ui-store'
import { isNewerVersion } from '@/lib/version-utils'
import { logger } from '@/lib/logger'
import { isNativeApp } from '@/lib/environment'
import { usePreferences } from '@/services/preferences'
import type { CliType } from '@/lib/cli-update'

interface CliUpdateInfo {
  type: CliType
  currentVersion: string
  latestVersion: string
  cliSource?: 'jean' | 'path'
  cliPath?: string | null
  packageManager?: string | null
}

const JEAN_INSTALL_COMMANDS: Record<CliType, string> = {
  claude: 'install_claude_cli',
  codex: 'install_codex_cli',
  opencode: 'install_opencode_cli',
  pi: 'install_pi_cli',
  gh: 'install_gh_cli',
  coderabbit: 'install_coderabbit_cli',
}

const CLI_QUERY_KEY_GETTERS: Record<CliType, () => readonly unknown[]> = {
  claude: () => claudeCliQueryKeys.all,
  codex: () => codexCliQueryKeys.all,
  opencode: () => opencodeCliQueryKeys.all,
  pi: () => piCliQueryKeys.all,
  gh: () => ghCliQueryKeys.all,
  coderabbit: () => coderabbitCliQueryKeys.all,
}


/**
 * Resolve the effective CLI version/path/source by falling back to path detection
 * when the preference-based status shows the CLI is not installed (e.g. system-installed
 * Codex with default 'jean' preference → Jean binary missing → use path detection instead).
 */
function resolveCliInfo(
  status:
    | { installed: boolean; version?: string | null; path?: string | null }
    | undefined,
  pathInfo:
    | {
        found: boolean
        version?: string | null
        path?: string | null
        package_manager?: string | null
      }
    | undefined,
  preferredSource: 'jean' | 'path' | undefined
): {
  version: string | null
  path: string | null
  source: 'jean' | 'path'
  packageManager: string | null
} {
  if (status?.installed && status.version) {
    return {
      version: status.version,
      path: status.path ?? null,
      source: preferredSource ?? 'jean',
      packageManager: pathInfo?.package_manager ?? null,
    }
  }
  if (pathInfo?.found && pathInfo.version) {
    return {
      version: pathInfo.version,
      path: pathInfo.path ?? null,
      source: 'path',
      packageManager: pathInfo.package_manager ?? null,
    }
  }
  return { version: null, path: null, source: 'path', packageManager: null }
}

/**
 * Hook that checks for CLI updates on startup and periodically (every hour).
 * Shows toast notifications when updates are detected.
 * Should be called once in App.tsx.
 */
export function useCliVersionCheck() {
  const shouldCheck = isNativeApp()
  const { data: preferences, isLoading: preferencesLoading } = usePreferences()
  const { data: claudePathInfo } = useClaudePathDetection({
    enabled: shouldCheck,
  })
  const { data: ghPathInfo } = useGhPathDetection({ enabled: shouldCheck })
  const { data: codexPathInfo } = useCodexPathDetection({
    enabled: shouldCheck,
  })
  const { data: opencodePathInfo } = useOpencodePathDetection({
    enabled: shouldCheck,
  })
  const { data: piPathInfo } = usePiPathDetection({ enabled: shouldCheck })
  const { data: coderabbitPathInfo } = useCodeRabbitPathDetection({
    enabled: shouldCheck,
  })

  // Defer version fetches (GitHub API) by 10s — they're only for update toasts,
  // no reason to compete with startup-critical queries.
  const [versionCheckReady, setVersionCheckReady] = useState(false)
  useEffect(() => {
    if (!shouldCheck) return
    const timer = setTimeout(() => setVersionCheckReady(true), 10_000)
    return () => clearTimeout(timer)
  }, [shouldCheck])

  const { data: claudeStatus, isLoading: claudeLoading } = useClaudeCliStatus({
    enabled: shouldCheck && versionCheckReady,
  })
  const { data: ghStatus, isLoading: ghLoading } = useGhCliStatus({
    enabled: shouldCheck && versionCheckReady,
  })
  const { data: codexStatus, isLoading: codexLoading } = useCodexCliStatus({
    enabled: shouldCheck && versionCheckReady,
  })
  const { data: opencodeStatus, isLoading: opencodeLoading } =
    useOpencodeCliStatus({ enabled: shouldCheck && versionCheckReady })
  const { data: piStatus, isLoading: piLoading } = usePiCliStatus({
    enabled: shouldCheck && versionCheckReady,
  })
  const { data: coderabbitStatus, isLoading: coderabbitLoading } =
    useCodeRabbitCliStatus({ enabled: shouldCheck && versionCheckReady })
  const { data: claudeVersions, isLoading: claudeVersionsLoading } =
    useAvailableCliVersions({ enabled: shouldCheck && versionCheckReady })
  const { data: ghVersions, isLoading: ghVersionsLoading } =
    useAvailableGhVersions({ enabled: shouldCheck && versionCheckReady })
  const { data: codexVersions, isLoading: codexVersionsLoading } =
    useAvailableCodexVersions({ enabled: shouldCheck && versionCheckReady })
  const { data: opencodeVersions, isLoading: opencodeVersionsLoading } =
    useAvailableOpencodeVersions({ enabled: shouldCheck && versionCheckReady })
  const { data: piVersions, isLoading: piVersionsLoading } =
    useAvailablePiVersions({ enabled: shouldCheck && versionCheckReady })
  const { data: coderabbitVersions, isLoading: coderabbitVersionsLoading } =
    useAvailableCodeRabbitVersions({
      enabled: shouldCheck && versionCheckReady,
    })

  // Track which update pairs we've already shown notifications for
  // Format: "type:currentVersion→latestVersion"
  const notifiedRef = useRef<Set<string>>(new Set())
  const isInitialCheckRef = useRef(true)

  useEffect(() => {
    // Wait until all data is loaded
    const isLoading =
      claudeLoading ||
      ghLoading ||
      codexLoading ||
      opencodeLoading ||
      piLoading ||
      coderabbitLoading ||
      claudeVersionsLoading ||
      ghVersionsLoading ||
      codexVersionsLoading ||
      opencodeVersionsLoading ||
      piVersionsLoading ||
      coderabbitVersionsLoading ||
      preferencesLoading
    if (isLoading) return

    const updates: CliUpdateInfo[] = []

    // Resolve effective CLI info (falls back to path detection when Jean binary is missing)
    const claude = resolveCliInfo(
      claudeStatus,
      claudePathInfo,
      preferences?.claude_cli_source
    )
    const gh = resolveCliInfo(ghStatus, ghPathInfo, preferences?.gh_cli_source)
    const codex = resolveCliInfo(
      codexStatus,
      codexPathInfo,
      preferences?.codex_cli_source
    )
    const opencode = resolveCliInfo(
      opencodeStatus,
      opencodePathInfo,
      preferences?.opencode_cli_source
    )
    const pi = resolveCliInfo(piStatus, piPathInfo, preferences?.pi_cli_source)
    const coderabbit = resolveCliInfo(
      coderabbitStatus,
      coderabbitPathInfo,
      preferences?.coderabbit_cli_source
    )

    const checks: {
      type: CliUpdateInfo['type']
      info: ReturnType<typeof resolveCliInfo>
      versions: { version: string; prerelease: boolean }[] | undefined
    }[] = [
      { type: 'claude', info: claude, versions: claudeVersions },
      { type: 'gh', info: gh, versions: ghVersions },
      { type: 'codex', info: codex, versions: codexVersions },
      { type: 'opencode', info: opencode, versions: opencodeVersions },
      { type: 'pi', info: pi, versions: piVersions },
      { type: 'coderabbit', info: coderabbit, versions: coderabbitVersions },
    ]

    for (const { type, info, versions } of checks) {
      if (!info.version || !versions?.length) continue
      const latestStable = versions.find(v => !v.prerelease)
      if (!latestStable || !isNewerVersion(latestStable.version, info.version))
        continue
      const key = `${type}:${info.version}→${latestStable.version}`
      if (notifiedRef.current.has(key)) continue
      notifiedRef.current.add(key)
      updates.push({
        type,
        currentVersion: info.version,
        latestVersion: latestStable.version,
        cliSource: info.source,
        cliPath: info.path,
        packageManager: info.packageManager,
      })
    }

    // Sync store: remove CLIs no longer outdated (e.g. user updated manually),
    // merge in newly detected updates.
    const currentlyOutdated = new Set(
      checks
        .filter(c => {
          if (!c.info.version || !c.versions?.length) return false
          const latestStable = c.versions.find(v => !v.prerelease)
          return latestStable && isNewerVersion(latestStable.version, c.info.version)
        })
        .map(c => c.type)
    )

    const { setAvailableCliUpdates, availableCliUpdates } = useUIStore.getState()
    const nextUpdates = availableCliUpdates.filter(u => currentlyOutdated.has(u.type))
    for (const u of updates) {
      const idx = nextUpdates.findIndex(m => m.type === u.type)
      if (idx >= 0) nextUpdates[idx] = u
      else nextUpdates.push(u)
    }

    if (nextUpdates.length !== availableCliUpdates.length || updates.length > 0) {
      if (updates.length > 0) logger.info('CLI updates available', { updates })
      setAvailableCliUpdates(nextUpdates)
    }

    isInitialCheckRef.current = false
  }, [
    claudeStatus,
    ghStatus,
    codexStatus,
    opencodeStatus,
    piStatus,
    coderabbitStatus,
    claudePathInfo,
    ghPathInfo,
    codexPathInfo,
    opencodePathInfo,
    piPathInfo,
    coderabbitPathInfo,
    claudeVersions,
    ghVersions,
    codexVersions,
    opencodeVersions,
    piVersions,
    coderabbitVersions,
    claudeLoading,
    ghLoading,
    codexLoading,
    opencodeLoading,
    piLoading,
    coderabbitLoading,
    claudeVersionsLoading,
    ghVersionsLoading,
    codexVersionsLoading,
    opencodeVersionsLoading,
    piVersionsLoading,
    coderabbitVersionsLoading,
    preferencesLoading,
    preferences?.claude_cli_source,
    preferences?.codex_cli_source,
    preferences?.opencode_cli_source,
    preferences?.pi_cli_source,
    preferences?.gh_cli_source,
    preferences?.coderabbit_cli_source,
    queryClient,
  ])

  // Re-check CLI versions every hour so deferred updates retry once any
  // blocking sessions have stopped (or once a new release ships).
  useEffect(() => {
    if (!shouldCheck) return
    const id = setInterval(
      () => {
        queryClient.invalidateQueries({ queryKey: claudeCliQueryKeys.all })
        queryClient.invalidateQueries({ queryKey: ghCliQueryKeys.all })
        queryClient.invalidateQueries({ queryKey: codexCliQueryKeys.all })
        queryClient.invalidateQueries({ queryKey: opencodeCliQueryKeys.all })
        queryClient.invalidateQueries({ queryKey: piCliQueryKeys.all })
        queryClient.invalidateQueries({
          queryKey: coderabbitCliQueryKeys.all,
        })
      },
      60 * 60 * 1000
    )
    return () => clearInterval(id)
  }, [shouldCheck, queryClient])
}

