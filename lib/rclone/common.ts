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

    return defaultPaths
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

    const parsedOptions: Record<string, string | number | boolean | string[]> = {}
    for (const [key, value] of Object.entries(options)) {
        if (value === 'true') {
            parsedOptions[key] = true
        } else if (value === 'false') {
            parsedOptions[key] = false
        } else {
            parsedOptions[key] = value
        }
    }

    console.log('[parseRcloneOptions] parsedOptions', parsedOptions)

    return parsedOptions
}
