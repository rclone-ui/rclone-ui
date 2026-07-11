import * as Sentry from '@sentry/browser'
import { invoke } from '@tauri-apps/api/core'
import { appLogDir, sep } from '@tauri-apps/api/path'
import { ask, message } from '@tauri-apps/plugin-dialog'
import { exists, readTextFile } from '@tauri-apps/plugin-fs'
import { fetch } from '@tauri-apps/plugin-http'
import { platform } from '@tauri-apps/plugin-os'
import { exit, relaunch } from '@tauri-apps/plugin-process'
import { selectActiveConfigFile, useHostStore } from '../../store/host'
import { useStore } from '../../store/memory'
import { usePersistedStore } from '../../store/persisted'
import { getConfigParentFolder } from '../format'
import { dispatchNotification, notify } from '../notifications'
import { openSmallWindow } from '../window'
import { buildRcloneEnv } from './cli'
import {
    classifyRclonePath,
    compareVersions,
    createConfigFile,
    findSystemRclone,
    getConfigPath,
    resolveDefaultConfigPath,
    validateRcloneBinary,
} from './common'
import { downloadVersion, listDownloadedVersions, setPathIntegration } from './versions'

export async function initRclone(args: string[]) {
    console.log('[initRclone] starting with args:', args)

    // Resolve which rclone binary to run (adopting a system/legacy binary on first launch).
    let rclonePath = await resolveActiveRclone()

    // Nothing installed anywhere — download the latest and adopt it.
    if (!rclonePath) {
        console.log('[initRclone] no rclone available, provisioning...')
        useStore.setState({ startupDisplayed: true, startupStatus: 'initializing' })
        await openSmallWindow({
            name: 'Startup',
            url: '/startup',
        })

        const provisionedPath = await provisionRclone()
        console.log('[initRclone] provision rclone result:', provisionedPath)
        if (!provisionedPath) {
            console.error('[initRclone] provision failed, setting fatal status')
            useStore.setState({ startupStatus: 'fatal' })
            return
        }

        usePersistedStore.getState().setRclonePath(provisionedPath)
        rclonePath = provisionedPath

        // The system had no rclone at all, so our copy should serve the shell too: enable PATH
        // integration by default (the Settings toggle reflects it). Best-effort — on macOS this
        // shows an admin prompt the user may cancel.
        try {
            await setPathIntegration(true, provisionedPath)
        } catch (error) {
            console.warn('[initRclone] default PATH integration failed', error)
        }

        useStore.setState({ startupStatus: 'initialized' })

        if (!['windows', 'macos'].includes(platform())) {
            usePersistedStore.setState({ hideStartup: true })
        }
    }

    // Check for a newer stable release of a managed binary: auto-update or notify.
    rclonePath = await maybeAutoUpdateRclone(rclonePath)

    // Keep the PATH-integration pointer aimed at the active binary (best-effort).
    invoke('update_path_pointer', { targetPath: rclonePath }).catch((error) => {
        console.warn('[initRclone] update_path_pointer failed', error)
    })

    // Resolve + materialize the default config location once, independent of the binary,
    // so switching binaries never relocates the user's remotes.
    await ensureDefaultConfig()

    const hostState = useHostStore.getState()
    let configFiles = hostState.configFiles || []
    console.log('[initRclone] loaded config files count:', configFiles.length)

    const existingDefaultConfig = configFiles.find((config) => config.id === 'default')
    configFiles = configFiles.filter((config) => config.id !== 'default')
    console.log('[initRclone] filtered config files, remaining count:', configFiles.length)

    const defaultConfig = existingDefaultConfig
        ? existingDefaultConfig
        : {
              id: 'default',
              label: 'Default config',
              sync: undefined,
              isEncrypted: false,
              pass: undefined,
              passCommand: undefined,
          }

    configFiles.unshift(defaultConfig)
    console.log('[initRclone] added default config to list')
    useHostStore.setState({ configFiles })

    // Resolve the active config against the REBUILT list so a persisted id of 'default' resolves.
    let activeConfigFile = selectActiveConfigFile(useHostStore.getState())
    console.log('[initRclone] active config file:', activeConfigFile?.id)

    if (!activeConfigFile) {
        console.log('[initRclone] no active config file, setting default')
        activeConfigFile = configFiles[0]
        if (!activeConfigFile) {
            console.error('[initRclone] failed to get active config file')
            throw new Error('Failed to get active config file')
        }

        console.log('[initRclone] set active config file to:', activeConfigFile.id)
        useHostStore.getState().setActiveConfigFile(activeConfigFile.id!)
    }

    let configFolderPath = activeConfigFile.sync
        ? activeConfigFile.sync
        : getConfigParentFolder(await getConfigPath({ id: activeConfigFile.id!, validate: true }))
    console.log('[initRclone] configFolderPath', configFolderPath)

    let configPath = configFolderPath
    if (configPath.endsWith(sep())) {
        configPath = `${configPath}rclone.conf`
    } else {
        Sentry.captureException(new Error('configPath did not end with separator'))
        configPath = `${configPath}${sep()}rclone.conf`
    }
    console.log('[initRclone] configPath', configPath)

    if (activeConfigFile.sync) {
        console.log('[initRclone] checking if synced config file exists', configPath)
        if (await exists(configPath)) {
            console.log('[initRclone] synced config file exists')
        } else {
            console.error('[initRclone] synced config file not found, switching to default')
            await message('The config file could not be found. Switching to the default config.', {
                title: 'Invalid synced config',
                kind: 'error',
                okLabel: 'OK',
            })
            activeConfigFile = configFiles[0]
            // Rebind configPath too (not just configFolderPath): otherwise the readTextFile below
            // reads the stale, known-missing synced path and the fallback dead-ends in an exit.
            configPath = await getConfigPath({ id: 'default', validate: true })
            configFolderPath = getConfigParentFolder(configPath)
            console.log('[initRclone] switched to default config')
            useHostStore.getState().setActiveConfigFile(configFiles[0].id!)
        }
    }

    const passwordConfigured = activeConfigFile.pass || activeConfigFile.passCommand || null
    console.log('[initRclone] password configured:', !!passwordConfigured)
    try {
        console.log('[initRclone] reading config file', configPath)
        const configContent = await readTextFile(configPath)
        const isEncrypted = configContent.includes('RCLONE_ENCRYPT_V0:')

        console.log('[initRclone] isEncrypted', isEncrypted)

        if (isEncrypted) {
            console.log('[initRclone] config file is encrypted')
            if (passwordConfigured) {
                console.log('[initRclone] using existing password configuration')
            } else {
                console.log('[initRclone] no stored password configured')
            }
        }

        // Reconcile the stored encryption flag with the file's actual contents. The local rebind
        // is load-bearing: buildRcloneEnv below reads activeConfigFile to build the password env.
        if (activeConfigFile.isEncrypted !== isEncrypted) {
            console.log('[initRclone] reconciling encryption flag to', isEncrypted)
            useHostStore.getState().updateConfigFile(activeConfigFile.id!, { isEncrypted })
            activeConfigFile = { ...activeConfigFile, isEncrypted }
        }
    } catch (error) {
        console.log('[initRclone] could not read config file', error)
        const appLogDirPath = await appLogDir()
        await message(
            'Could not read config file, please file an issue on GitHub.\n\nLogs: ' + appLogDirPath,
            {
                title: 'Error',
                kind: 'error',
                okLabel: 'OK',
            }
        )
        await exit(0)
        return
    }

    // Proxy connectivity check (informational; the env vars themselves are set by buildRcloneEnv).
    if (hostState.proxy) {
        console.log('[initRclone] proxy configured:', hostState.proxy.url)
        try {
            console.log('[initRclone] testing proxy connection')
            await invoke<string>('test_proxy_connection', { proxy_url: hostState.proxy.url })
            console.log('[initRclone] proxy connection successful')
        } catch (error) {
            console.error('[initRclone] proxy connection failed:', error)
            const continueAnyway = await ask(
                'You have a proxy set, but it failed to connect. Do you want to continue anyway?',
                {
                    title: 'Error',
                    kind: 'warning',
                    okLabel: 'Continue',
                    cancelLabel: 'Exit',
                }
            )
            console.log('[initRclone] user continue anyway:', continueAnyway)

            if (!continueAnyway) {
                console.log('[initRclone] user chose to exit due to proxy failure')
                await exit(0)
                return
            }
        }
    }

    let env: Record<string, string>
    try {
        env = await buildRcloneEnv({
            activeConfig: activeConfigFile,
            configDirectory: configFolderPath,
            configPath,
            proxy: hostState.proxy,
            rclonePath,
            autoPromptForPassword: true,
        })
    } catch (error) {
        if (error instanceof Error && error.message === 'Password prompt cancelled by user.') {
            console.error('[initRclone] password prompt cancelled by user')
            const response = await message('Password is required for encrypted configurations.', {
                title: 'Password Required',
                kind: 'error',
                buttons: {
                    cancel: 'Close',
                    ok: 'Try Again',
                },
            })
            console.log('[initRclone] message response:', response)
            if (response === 'Try Again') {
                await relaunch()
                return
            }
            await exit(0)
            return
        }
        throw error
    }

    console.log('[initRclone] returning rclone command', { path: rclonePath, args })
    return { path: rclonePath, args, env }
}

/**
 * Resolves the active rclone binary path: validates the persisted selection (self-healing a
 * managed version whose absolute path moved), otherwise adopts a system / legacy / downloaded
 * binary. Returns null when nothing is available so the caller can provision.
 */
async function resolveActiveRclone(): Promise<string | null> {
    const persisted = usePersistedStore.getState()
    const stored = persisted.rclonePath

    if (stored) {
        const version = await validateRcloneBinary(stored)
        if (version) {
            console.log('[resolveActiveRclone] using stored rclone', stored, version)
            return stored
        }
        console.warn('[resolveActiveRclone] stored rclone path is unusable:', stored)

        // Self-heal a managed version whose absolute path moved (e.g. home-dir rename).
        const match = stored.match(/rclone-versions[/\\]v([^/\\]+)/)
        if (match) {
            const healed = await invoke<string | null>('managed_version_path', {
                version: match[1],
            })
            if (healed && (await validateRcloneBinary(healed))) {
                console.log('[resolveActiveRclone] self-healed managed path ->', healed)
                persisted.setRclonePath(healed)
                return healed
            }
        }
        // fall through to the adoption ladder
    }

    // Fold any legacy single-slot binary into the versioned library first (idempotent), so it
    // remains visible even when a system rclone ends up active.
    let legacyAdopted: { version: string; path: string } | null = null
    try {
        legacyAdopted = await invoke<{ version: string; path: string } | null>(
            'adopt_legacy_rclone'
        )
    } catch (error) {
        console.error('[resolveActiveRclone] adopt_legacy_rclone failed', error)
    }

    // 1. Genuine system rclone — offered, not silently adopted, so the user decides whether the
    //    app tracks their system install or manages its own copy. Answering persists a path, so
    //    the question fires only while no usable path is stored.
    const system = await findSystemRclone()
    if (system) {
        const systemVersion = await validateRcloneBinary(system)
        if (systemVersion) {
            const useSystem = await ask(
                `Found rclone v${systemVersion} at:\n${system}\n\nUse it as the app's rclone? Otherwise the app will manage its own copy. You can switch anytime in Settings.`,
                {
                    title: 'System rclone detected',
                    kind: 'info',
                    okLabel: 'Use system rclone',
                    cancelLabel: 'Manage separately',
                }
            )
            if (useSystem) {
                persisted.setRclonePath(system)
                return system
            }
        }
    }

    // 2. The just-adopted legacy binary. Re-probe it: when the version already existed in the
    //    library, adopt_legacy_rclone returns that pre-existing binary without validating it.
    if (legacyAdopted?.path && (await validateRcloneBinary(legacyAdopted.path))) {
        persisted.setRclonePath(legacyAdopted.path)
        return legacyAdopted.path
    }

    // 3. Newest already-downloaded managed version that still runs — a broken binary must fall
    //    through to provisioning instead of being re-adopted.
    try {
        const downloaded = await listDownloadedVersions()
        for (const candidate of downloaded) {
            if (await validateRcloneBinary(candidate.path)) {
                persisted.setRclonePath(candidate.path)
                return candidate.path
            }
            console.warn(
                '[resolveActiveRclone] skipping unusable downloaded version:',
                candidate.path
            )
        }
    } catch (error) {
        console.error('[resolveActiveRclone] list_downloaded_rclone_versions failed', error)
    }

    // 4. Nothing available — caller provisions.
    return null
}

let rcloneUpdateChecked = false

/**
 * For a managed binary: checks downloads.rclone.org for a newer stable release, once per app
 * session (so switching versions in Settings doesn't immediately undo a pin). Downloads and
 * adopts it when auto-update is on; otherwise notifies once per version that an update can be
 * run from Settings. Never blocks startup on failure.
 */
async function maybeAutoUpdateRclone(currentPath: string): Promise<string> {
    if (rcloneUpdateChecked) {
        return currentPath
    }
    rcloneUpdateChecked = true

    try {
        const active = await classifyRclonePath(currentPath)
        if (active.kind !== 'managed' || !active.version) {
            return currentPath
        }

        const versionString = await fetch('https://downloads.rclone.org/version.txt', {
            connectTimeout: 5000,
        }).then((res) => res.text())
        const latest = versionString.split('v')?.[1]?.trim()
        if (!latest || compareVersions(latest, active.version) <= 0) {
            return currentPath
        }

        const persisted = usePersistedStore.getState()

        if (!persisted.autoUpdateRclone) {
            if (persisted.lastNotifiedRcloneVersion !== latest) {
                usePersistedStore.setState({ lastNotifiedRcloneVersion: latest })
                dispatchNotification('rclone.update-available', {
                    title: 'Rclone update available',
                    body: `rclone v${latest} is available. You can update from Settings → Binary.`,
                    data: { currentVersion: active.version, latestVersion: latest },
                })
                await notify({
                    title: 'Rclone update available',
                    body: `rclone v${latest} is available. You can update from Settings → Binary.`,
                })
            }
            return currentPath
        }

        console.log('[maybeAutoUpdateRclone] updating', active.version, '->', latest)
        // Startup-window status only (never startupDisplayed): showStartup opens the window and,
        // finding 'updated', shows the update message; a failed update is restored below so the
        // window can't stick on 'updating' with no TAP TO START.
        useStore.setState({ startupStatus: 'updating' })
        const newPath = await downloadVersion(latest)
        persisted.setRclonePath(newPath)
        useStore.setState({ startupStatus: 'updated' })
        return newPath
    } catch (error) {
        console.log('[maybeAutoUpdateRclone] update check skipped', error)
        // Restore so 'updating' can't stick — but only if we set it: a failure before the
        // download (classify, version fetch) must not downgrade a status another path already
        // promoted (provisioning sets 'initialized' before this runs). When the Startup window
        // is already open (provisioning path), restore 'initialized' — 'initializing' renders
        // no TAP TO START and showStartup early-returns on startupDisplayed, stranding the
        // window. Do NOT set 'error' — this path is offline-safe and silently continues on the
        // existing binary.
        const store = useStore.getState()
        if (store.startupStatus === 'updating') {
            useStore.setState({
                startupStatus: store.startupDisplayed ? 'initialized' : 'initializing',
            })
        }
        return currentPath
    }
}

/** Resolves (once) and materializes the default config location for the active host. */
async function ensureDefaultConfig() {
    const host = useHostStore.getState()
    let defaultConfigPath = host.defaultConfigPath
    if (!defaultConfigPath) {
        defaultConfigPath = await resolveDefaultConfigPath()
        console.log('[ensureDefaultConfig] resolved default config path', defaultConfigPath)
        host.setDefaultConfigPath(defaultConfigPath)
    }
    await createConfigFile(defaultConfigPath)
}

/**
 * Downloads the latest rclone release into the versioned library and returns its absolute path,
 * or false on failure. The download/extract/verify pipeline lives in Rust.
 */
export async function provisionRclone(): Promise<string | false> {
    console.log('[provisionRclone] starting')

    let version: string | undefined
    try {
        const versionString = await fetch('https://downloads.rclone.org/version.txt').then((res) =>
            res.text()
        )
        version = versionString.split('v')?.[1]?.trim()
    } catch (error) {
        console.error('[provisionRclone] failed to fetch latest version', error)
    }

    if (!version) {
        await message('Failed to get latest rclone version, please try again later.')
        return false
    }
    console.log('[provisionRclone] latest version', version)

    let path: string
    try {
        path = await downloadVersion(version)
    } catch (error) {
        console.error('[provisionRclone] download failed', error)
        Sentry.captureException(error)
        await message(
            `Failed to download rclone: ${error instanceof Error ? error.message : String(error)}`
        )
        return false
    }

    console.log('[provisionRclone] installed at', path)
    return path
}
