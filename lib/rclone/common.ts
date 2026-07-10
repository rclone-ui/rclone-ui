import { invoke } from '@tauri-apps/api/core'
import { appLocalDataDir, sep } from '@tauri-apps/api/path'
import { exists, mkdir, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { useHostStore } from '../../store/host'
import type { FlagValue } from '../../types/rclone'
import { getConfigParentFolder } from '../format'
import rclone from './client'
import { DOUBLE_BACKSLASH_REGEX } from './constants'

export async function getDefaultPaths() {
    console.log('[getDefaultPaths]')

    const defaultPaths = await rclone('/config/paths')

    console.log('[getDefaultPaths] json', JSON.stringify(defaultPaths, null, 2))

    return {
        cache: defaultPaths.cache ? defaultPaths.cache.replace(DOUBLE_BACKSLASH_REGEX, '\\') : '',
        config: defaultPaths.config
            ? defaultPaths.config.replace(DOUBLE_BACKSLASH_REGEX, '\\')
            : '',
        temp: defaultPaths.temp ? defaultPaths.temp.replace(DOUBLE_BACKSLASH_REGEX, '\\') : '',
    }
}

/** App-private location of the default config, used when there is no system rclone to defer to. */
export async function appPrivateDefaultConfigPath() {
    const appLocalDataDirPath = await appLocalDataDir()
    return appLocalDataDirPath + sep() + 'configs' + sep() + 'default' + sep() + 'rclone.conf'
}

export async function getConfigPath({ id, validate = true }: { id: string; validate?: boolean }) {
    console.log('[getConfigPath]', id, validate)

    const appLocalDataDirPath = await appLocalDataDir()

    let configPath = appLocalDataDirPath + sep() + 'configs' + sep() + id + sep() + 'rclone.conf'

    // The "default" config lives at a location resolved once at adoption (native for a system
    // rclone, app-private otherwise) and persisted, so switching binaries never moves remotes.
    if (id === 'default') {
        const persistedDefault = useHostStore.getState().defaultConfigPath
        if (persistedDefault) {
            configPath = persistedDefault
        }
    }

    console.log('[getConfigPath] configPath', configPath)

    if (validate) {
        const configExists = await exists(configPath)
        if (!configExists) {
            console.error('[getConfigPath] config file does not exist')
            throw new Error('Config file does not exist')
        }
    }

    return configPath
}

export async function createConfigFile(path: string) {
    console.log('[createConfigFile] path', path)

    if (await exists(path).catch(() => false)) {
        return
    }

    try {
        await writeTextFile(path, '# Empty config file\n')
    } catch {
        // Write-first, then create the parent dir on failure and retry. Do NOT mkdir first:
        // getConfigParentFolder returns the path UNCHANGED for non-rclone.conf filenames, so an
        // unconditional mkdir could create a directory at the config file path.
        await mkdir(getConfigParentFolder(path), { recursive: true })
        await writeTextFile(path, '# Empty config file\n')
    }
}

/**
 * Locates a genuine system rclone on PATH (excluding the app's own PATH-integration pointer).
 * Returns null under Flatpak, where the host PATH is unreachable.
 */
export async function findSystemRclone(): Promise<string | null> {
    try {
        if (await invoke<boolean>('is_flatpak')) {
            return null
        }
        return (await invoke<string | null>('find_system_rclone')) ?? null
    } catch (error) {
        console.error('[findSystemRclone] error', error)
        return null
    }
}

/** Runs `<path> version` and returns the parsed version string; throws the detailed Rust error
 * (including the macOS Gatekeeper `xattr` hint) when the binary is unusable. */
export async function probeRcloneBinaryOrThrow(path: string): Promise<string> {
    return await invoke<string>('validate_rclone_binary', { path })
}

/** Like probeRcloneBinaryOrThrow, but returns null instead of throwing. */
export async function validateRcloneBinary(path: string): Promise<string | null> {
    try {
        return await probeRcloneBinaryOrThrow(path)
    } catch (error) {
        console.error('[validateRcloneBinary] error', error)
        return null
    }
}

export interface RcloneClassification {
    kind: 'system' | 'managed' | 'custom'
    version: string | null
}

/** Classifies a path as system / managed / custom using canonical comparisons in Rust. */
export async function classifyRclonePath(path: string): Promise<RcloneClassification> {
    try {
        return await invoke<RcloneClassification>('classify_rclone_path', { path })
    } catch (error) {
        console.error('[classifyRclonePath] error', error)
        return { kind: 'custom', version: null }
    }
}

/**
 * Resolves where the default config should live, driven by what the user already uses:
 * an app-private config that already holds remotes wins; otherwise a system rclone's native
 * config; otherwise the app-private default. Called once, then persisted.
 */
export async function resolveDefaultConfigPath(): Promise<string> {
    const appPrivate = await appPrivateDefaultConfigPath()

    try {
        if (await exists(appPrivate)) {
            const content = await readTextFile(appPrivate)
            // A section header — or an encrypted body, which has no headers — means the user
            // has real remotes here; keep them.
            if (/^\s*\[/m.test(content) || content.includes('RCLONE_ENCRYPT_V0:')) {
                return appPrivate
            }
        }
    } catch (error) {
        console.error('[resolveDefaultConfigPath] failed reading app-private config', error)
    }

    const system = await findSystemRclone()
    if (system) {
        try {
            const native = await invoke<string>('rclone_config_path', { path: system })
            if (native) {
                return native.replace(DOUBLE_BACKSLASH_REGEX, '\\')
            }
        } catch (error) {
            console.error('[resolveDefaultConfigPath] failed reading native config path', error)
        }
    }

    return appPrivate
}

export function parseRcloneOptions(options: Record<string, FlagValue>) {
    console.log('[parseRcloneOptions]', options)

    return options
}

export function compareVersions(version1: string, version2: string): number {
    const parseVersion = (version: string) => {
        // Strip a leading 'v' and any pre-release suffix (e.g. "1.74.0-beta.x") before comparing;
        // otherwise parseInt('v1') is NaN → coerced to 0, silently mis-ordering versions.
        const core = version.trim().replace(/^v/, '').split('-')[0]
        const parts = core.split('.').map((num) => Number.parseInt(num, 10))
        return {
            major: parts[0] || 0,
            minor: parts[1] || 0,
            patch: parts[2] || 0,
        }
    }

    const v1 = parseVersion(version1)
    const v2 = parseVersion(version2)

    if (v1.major !== v2.major) {
        return v1.major > v2.major ? 1 : -1
    }
    if (v1.minor !== v2.minor) {
        return v1.minor > v2.minor ? 1 : -1
    }
    if (v1.patch !== v2.patch) {
        return v1.patch > v2.patch ? 1 : -1
    }
    return 0
}
