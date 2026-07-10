import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { ask } from '@tauri-apps/plugin-dialog'
import { fetch } from '@tauri-apps/plugin-http'
import { useHostStore } from '../../store/host'
import { usePersistedStore } from '../../store/persisted'
import { restartActiveRclone } from './cli'
import rcloneClient from './client'
import { appPrivateDefaultConfigPath, compareVersions } from './common'
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
