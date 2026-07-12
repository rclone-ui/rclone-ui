import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { ask } from '@tauri-apps/plugin-dialog'
import { fetch } from '@tauri-apps/plugin-http'
import { flushHostStore, useHostStore } from '../../store/host'
import { usePersistedStore } from '../../store/persisted'
import { restartActiveRclone } from './cli'
import rcloneClient from './client'
import { appPrivateDefaultConfigPath, compareVersions, resolveActiveConfigPath } from './common'
import { MIN_RCLONE_VERSION, RCLONE_RELEASES_API, RCLONE_RELEASES_SHOWN } from './constants'

export interface DownloadedVersion {
    version: string
    path: string
    sizeBytes: number
}

export interface AvailableRelease {
    version: string
    publishedAt: string
}

export interface PathStatus {
    enabled: boolean
    target: string | null
    warning: string | null
}

export interface ConfigSyncStatus {
    /** The system config path currently points at the given active config (or IS it, circular case). */
    enabled: boolean
    /** The system config path is a symlink we created (may point at a different config until re-pointed). */
    managed: boolean
    systemPath: string
    /** Set when this call moved a pre-existing config aside; the path it was backed up to. */
    backupPath: string | null
    /** True when the file just backed up was the app's own default config (re-point defaultConfigPath). */
    defaultBackedUp: boolean
    warning: string | null
}

export interface DownloadProgress {
    version: string
    downloaded: number
    total: number | null
}

export async function listDownloadedVersions(): Promise<DownloadedVersion[]> {
    return await invoke<DownloadedVersion[]>('list_downloaded_rclone_versions')
}

/** Fetches stable rclone releases at or above the minimum supported version (best-effort). */
export async function fetchAvailableVersions(): Promise<AvailableRelease[]> {
    const res = await fetch(RCLONE_RELEASES_API, {
        headers: { Accept: 'application/vnd.github+json' },
    })
    if (!res.ok) {
        throw new Error(`GitHub API responded ${res.status}`)
    }
    const releases = (await res.json()) as {
        tag_name: string
        prerelease: boolean
        draft: boolean
        published_at: string
    }[]

    return releases
        .filter((r) => !r.prerelease && !r.draft)
        .map((r) => ({ version: r.tag_name.replace(/^v/, ''), publishedAt: r.published_at }))
        .filter((r) => compareVersions(r.version, MIN_RCLONE_VERSION) >= 0)
        .sort((a, b) => compareVersions(b.version, a.version))
        .slice(0, RCLONE_RELEASES_SHOWN)
}

/**
 * Downloads a version into the managed library, forwarding progress events for the given version.
 * Returns the absolute path of the installed binary.
 */
export async function downloadVersion(
    version: string,
    onProgress?: (progress: DownloadProgress) => void
): Promise<string> {
    const unlisten = await listen<DownloadProgress>('rclone-download-progress', (event) => {
        if (event.payload.version === version) {
            onProgress?.(event.payload)
        }
    })
    try {
        const proxyUrl = useHostStore.getState().proxy?.url ?? null
        return await invoke<string>('download_rclone_version', { version, proxyUrl })
    } finally {
        unlisten()
    }
}

export async function deleteVersion(version: string): Promise<void> {
    const activePath = usePersistedStore.getState().rclonePath ?? null
    await invoke('delete_rclone_version', { version, activePath })
}

/** True if rclone currently has active transfers/checks or mounts. */
async function isRcloneBusy(): Promise<boolean> {
    try {
        const stats = (await rcloneClient('/core/stats')) as {
            transferring?: unknown[]
            checking?: unknown[]
        }
        if ((stats?.transferring?.length ?? 0) > 0 || (stats?.checking?.length ?? 0) > 0) {
            return true
        }
    } catch (error) {
        console.warn('[isRcloneBusy] core/stats failed', error)
    }
    try {
        const mounts = (await rcloneClient('/mount/listmounts')) as { mountPoints?: unknown[] }
        if ((mounts?.mountPoints?.length ?? 0) > 0) {
            return true
        }
    } catch (error) {
        console.warn('[isRcloneBusy] mount/listmounts failed', error)
    }
    return false
}

/**
 * Points the app at `path` and restarts the daemon on it. Confirms first when transfers/mounts
 * are active. Returns false if the user cancelled. With `offerSystemConfig`, offers adopting the
 * binary's native config — after the busy confirm, so cancelling leaves no state behind.
 */
export async function activateRclonePath(
    path: string,
    opts?: { offerSystemConfig?: boolean }
): Promise<boolean> {
    if (await isRcloneBusy()) {
        const proceed = await ask(
            'Transfers or mounts are in progress and will be interrupted by switching rclone. Continue?',
            {
                title: 'Rclone is busy',
                kind: 'warning',
                okLabel: 'Switch anyway',
                cancelLabel: 'Cancel',
            }
        )
        if (!proceed) {
            return false
        }
    }

    usePersistedStore.getState().setRclonePath(path)

    // Called for its side effect: it persists the adopted default config path, which the restart
    // snapshot below then reads back from the store.
    if (opts?.offerSystemConfig) {
        await maybeOfferSystemConfig(path)
    }

    try {
        await invoke('update_path_pointer', { targetPath: path })
    } catch (error) {
        console.warn('[activateRclonePath] update_path_pointer failed', error)
    }
    // The default config path may have moved (maybeOfferSystemConfig) — keep any config-sync
    // symlink tracking the active config. Run BEFORE the restart so a relocated defaultConfigPath
    // is captured in the restart snapshot (avoids the main window re-applying a stale value).
    // Non-throwing.
    await reconcileConfigSync()
    await restartActiveRclone()
    return true
}

/**
 * When switching to the system rclone while the app's config is app-private, offer to adopt the
 * system rclone's native config so the shell and app share remotes. Persists the adopted default
 * config path (the zero-arg restart snapshot reads it back from the store); returns it, or null.
 */
async function maybeOfferSystemConfig(systemPath: string): Promise<string | null> {
    const host = useHostStore.getState()
    const appPrivate = await appPrivateDefaultConfigPath()
    const current = host.defaultConfigPath

    if (current && current !== appPrivate) {
        return null // already using a non-app-private (likely native) config
    }

    // With config sync ON, the system config path is OUR symlink back to the app's active config —
    // not an independent native config. `rclone_config_path` would return that system path, so
    // adopting it as defaultConfigPath would alias `default` to the active config and orphan the
    // real default. The terminal already shares the app config via the symlink, so there is nothing
    // to adopt: skip the offer entirely.
    if (host.syncConfigLinkTarget) {
        return null
    }

    try {
        const native = await invoke<string>('rclone_config_path', { path: systemPath })
        if (!native || native === current) {
            return null
        }
        const useNative = await ask(
            `Your app remotes are stored at:\n${current ?? appPrivate}\n\nThe system rclone uses:\n${native}\n\nWhich config should the app use?`,
            {
                title: 'Config location',
                kind: 'info',
                okLabel: 'Use system config',
                cancelLabel: 'Keep app config',
            }
        )
        if (useNative) {
            host.setDefaultConfigPath(native)
            return native
        }
    } catch (error) {
        console.warn('[maybeOfferSystemConfig] failed', error)
    }
    return null
}

export async function getPathIntegration(): Promise<PathStatus> {
    return await invoke<PathStatus>('get_rclone_path_integration')
}

export async function setPathIntegration(enable: boolean, targetPath: string): Promise<PathStatus> {
    return await invoke<PathStatus>('set_rclone_path_integration', {
        enable,
        targetPath,
    })
}

export async function getConfigSync(
    appConfigPath: string,
    ownedLinkTarget: string | null
): Promise<ConfigSyncStatus> {
    return await invoke<ConfigSyncStatus>('get_config_sync_status', {
        appConfigPath,
        ownedLinkTarget,
    })
}

export async function setConfigSync(
    enable: boolean,
    appConfigPath: string,
    ownedLinkTarget: string | null,
    defaultConfigPath: string | null
): Promise<ConfigSyncStatus> {
    return await invoke<ConfigSyncStatus>('set_config_sync', {
        enable,
        appConfigPath,
        ownedLinkTarget,
        defaultConfigPath,
    })
}

/** The ownership marker implied by a status result: the active path when we now hold a link
 * (`managed`), else null (circular or removed) — so a link we don't own is never marked as ours. */
function markerFromStatus(status: ConfigSyncStatus, appConfigPath: string): string | null {
    return status.managed ? appConfigPath : null
}

/**
 * Serializes every config-sync transaction — reconcile AND the settings toggle — end to end. The Rust
 * mutex only serializes the filesystem swap, not this read-intent → invoke → persist-marker sequence,
 * so without this a reconcile and a toggle could interleave and recreate a link the user just
 * disabled or persist a marker that disagrees with the link on disk. Every caller MUST read fresh
 * store state INSIDE the passed callback (never capture it beforehand).
 *
 * The chain is module-local, so it serializes only WITHIN one webview, not a Settings action against
 * the hidden main window's reconcile. That cross-webview race is left as-is: it's a narrow window,
 * async rehydration heals nearly all timings, and the worst case is a visible, one-click-correctable
 * toggle — never silent or data loss.
 */
let configSyncChain: Promise<unknown> = Promise.resolve()
export function withConfigSyncLock<T>(fn: () => Promise<T>): Promise<T> {
    // Run fn whether the predecessor resolved or rejected (a failed op must not wedge the chain).
    const run = configSyncChain.then(fn, fn)
    configSyncChain = run.then(
        () => undefined,
        () => undefined
    )
    return run
}

/**
 * Reconciles the system-config symlink to the persisted intent and the current active config path.
 * Idempotent and safe to call at startup, after a config switch, and after a binary activation.
 * Enabling re-points/creates the link (backing up any foreign file); disabling removes the link we
 * own — proven by the persisted marker, so a user's own symlink is never touched. This makes the
 * reconcile self-healing in BOTH directions (a link left after a crashed disable is cleaned up; a
 * link missing after a crashed enable is recreated). If enabling moved the app's own default config
 * aside, defaultConfigPath follows it so `default` is never orphaned. Persists the resulting marker.
 * Never throws — returns the status (and any error) so callers can surface a failed re-point.
 */
export async function reconcileConfigSync(): Promise<{
    status: ConfigSyncStatus | null
    error: string | null
}> {
    return withConfigSyncLock(async () => {
        try {
            // Read intent/marker fresh INSIDE the lock so a toggle that ran just before us is honored.
            const host = useHostStore.getState()
            const intent = host.syncConfigToSystem
            const marker = host.syncConfigLinkTarget

            // Fast path: nothing to do and nothing we own to clean up. Avoids a Rust round-trip on the
            // common "sync was never enabled" startup.
            if (!intent && !marker) {
                return { status: null, error: null }
            }

            const appConfigPath = await resolveActiveConfigPath()
            const status = await setConfigSync(
                intent,
                appConfigPath,
                marker,
                host.defaultConfigPath ?? null
            )
            // Enabling vacated the system path and it held the app's own default config — follow it to
            // the relocated copy so switching back to `default` still reads the user's remotes.
            if (status.defaultBackedUp && status.backupPath) {
                host.setDefaultConfigPath(status.backupPath)
            }
            host.setConfigSyncState({ intent, linkTarget: markerFromStatus(status, appConfigPath) })
            // Durably persist intent + marker (+ any relocated default) before returning, so a crash
            // can't leave the on-disk store disagreeing with the link we just made/removed.
            await flushHostStore()
            return { status, error: null }
        } catch (error) {
            console.warn('[reconcileConfigSync] failed', error)
            return { status: null, error: error instanceof Error ? error.message : String(error) }
        }
    })
}
