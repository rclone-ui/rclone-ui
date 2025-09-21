import { appLocalDataDir, sep } from '@tauri-apps/api/path'
import { exists } from '@tauri-apps/plugin-fs'
import { fetch } from '@tauri-apps/plugin-http'
import { Command } from '@tauri-apps/plugin-shell'

export async function getDefaultPaths() {
    console.log('[getDefaultPaths]')

    const r = await fetch('http://localhost:5572/config/paths', {
        method: 'POST',
    })

    if (!r.ok) {
        console.error('[getDefaultPaths] failed to make request to config/paths')
        throw new Error('Failed to make request to config/paths')
    }

    const defaultPaths = (await r.json()) as { cache: string; config: string; temp: string }

    console.log('[getDefaultPaths] json', JSON.stringify(defaultPaths, null, 2))

    const doubleBackslashRegex = /\\\\/g

    return {
        cache: defaultPaths.cache ? defaultPaths.cache.replace(doubleBackslashRegex, '\\') : '',
        config: defaultPaths.config ? defaultPaths.config.replace(doubleBackslashRegex, '\\') : '',
        temp: defaultPaths.temp ? defaultPaths.temp.replace(doubleBackslashRegex, '\\') : '',
    }
}

export async function getDefaultPath(type: 'system' | 'internal') {
    console.log('[getDefaultPath]', type)

    let instance = null
    if (type === 'system') {
        console.log('[getDefaultPath] running system rclone')
        instance = Command.create('rclone-system', [
            'rcd',
            '--rc-no-auth',
            '--rc-serve',
            // '-rc-addr',
            // ':5572',
        ])
    }
    if (type === 'internal') {
        console.log('[getDefaultPath] running internal rclone')
        instance = Command.create('rclone-internal', [
            'rcd',
            '--rc-no-auth',
            '--rc-serve',
            // '-rc-addr',
            // ':5572',
        ])
    }

    if (!instance) {
        console.error('[getDefaultPath] failed to create rclone instance')
        throw new Error('Failed to create rclone instance, please try again later.')
    }

    const output = await instance.spawn()

    console.log('[getDefaultPath] spawned rclone')

    await new Promise((resolve) => setTimeout(resolve, 200))

    try {
        const defaultPaths = await getDefaultPaths()

        if (typeof defaultPaths?.config === 'undefined') {
            throw new Error('Failed to fetch config path')
        }

        return defaultPaths.config
    } catch (error) {
        console.error('[getDefaultPath] error', error)
        if (error instanceof Error) {
            throw error
        }
        throw new Error('Failed to get default path, please try again later.')
    } finally {
        await output.kill()
    }
}

export async function getConfigPath({ id, validate = true }: { id: string; validate?: boolean }) {
    console.log('[getConfigPath]', id, validate)

    const appLocalDataDirPath = await appLocalDataDir()
    console.log('[getConfigPath] appLocalDataDirPath', appLocalDataDirPath)

    let configPath = appLocalDataDirPath + sep() + 'configs' + sep() + id + sep() + 'rclone.conf'

    console.log('[getConfigPath] configPath', configPath)

    if (id == 'default') {
        const system = await isSystemRcloneInstalled()
        const defaultPath = await getDefaultPath(system ? 'system' : 'internal')

        configPath = defaultPath
    }

    if (validate) {
        const configExists = await exists(configPath)
        if (!configExists) {
            console.error('[getConfigPath] config file does not exist')
            throw new Error('Config file does not exist')
        }
    }

    return configPath
}

/**
 * Checks if rclone is installed and accessible from the system PATH
 * @returns {Promise<boolean>} True if rclone is installed and working
 */
export async function isSystemRcloneInstalled() {
    console.log('[isSystemRcloneInstalled]')

    try {
        const output = await Command.create('rclone-system').execute()
        return (
            output.stdout.includes('Available commands') ||
            output.stderr.includes('Available commands')
        )
    } catch {
        return false
    }
}

/**
 * Checks if rclone is downloaded by the application in the app's local data directory
 * @returns {Promise<boolean>} True if downloaded rclone is present and working
 */
export async function isInternalRcloneInstalled() {
    console.log('[isInternalRcloneInstalled]')

    try {
        const output = await Command.create('rclone-internal').execute()
        // console.log('[isInternalRcloneInstalled] output', output)
        return (
            output.stdout.includes('Available commands') ||
            output.stderr.includes('Available commands')
        )
    } catch {
        return false
    }
}

export function parseRcloneOptions(options: Record<string, string | number | boolean | string[]>) {
    console.log('[parseRcloneOptions]', options)

    return options
}

export function compareVersions(version1: string, version2: string): number {
    const parseVersion = (version: string) => {
        const parts = version.split('.').map((num) => Number.parseInt(num, 10))
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

const YOURS_VERSION_REGEX = /yours:\s+([^\s]+)/
const LATEST_VERSION_REGEX = /latest:\s+([^\s]+)/

export async function getRcloneVersion(type?: 'system' | 'internal') {
    let instanceType = type
    if (!instanceType) {
        instanceType = (await isSystemRcloneInstalled()) ? 'system' : 'internal'
    }

    const result = await Command.create(
        instanceType === 'system' ? 'rclone-system' : 'rclone-internal',
        ['selfupdate', '--check']
    ).execute()
    const output = result.stdout.trim()
    return parseRcloneVersion(output)
}

export function parseRcloneVersion(output: string) {
    const yoursMatch = output.match(YOURS_VERSION_REGEX)
    const latestMatch = output.match(LATEST_VERSION_REGEX)

    if (!yoursMatch || !latestMatch) {
        return null
    }

    return {
        yours: yoursMatch[1],
        latest: latestMatch[1],
    }
}

export async function shouldUpdateRclone(type?: 'system' | 'internal') {
    const versionData = await getRcloneVersion(type)
    if (!versionData?.yours) return false

    if (!versionData) {
        console.warn('[shouldUpdateRclone] received no version data:', versionData)
        return false
    }

    const currentVersion = versionData.yours
    const latestVersion = versionData.latest

    if (!currentVersion || !latestVersion) {
        console.warn('[shouldUpdateRclone] could not parse version output:', versionData)
        return false
    }

    console.log('[shouldUpdateRclone] current version:', currentVersion)
    console.log('[shouldUpdateRclone] latest version:', latestVersion)

    // Compare versions using the existing compareVersions function
    const versionComparison = compareVersions(currentVersion, latestVersion)
    if (versionComparison < 0) {
        console.log('[shouldUpdateRclone] internal rclone needs update')
        return true
    }

    console.log('[shouldUpdateRclone] internal rclone is up to date')
    return false
}
