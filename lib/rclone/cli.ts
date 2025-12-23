import * as Sentry from '@sentry/browser'
import { invoke } from '@tauri-apps/api/core'
import { sep } from '@tauri-apps/api/path'
import { getAllWindows } from '@tauri-apps/api/window'
import { message } from '@tauri-apps/plugin-dialog'
import { Command } from '@tauri-apps/plugin-shell'
import { useHostStore } from '../../store/host'
import type { ConfigFile } from '../../types/config'
import { getConfigParentFolder } from '../format'
import { getConfigPath, isInternalRcloneInstalled, isSystemRcloneInstalled } from './common'

export interface RcloneCliCommandContext {
    command: Command<string>
    activeConfig: ConfigFile
    configPath: string
    configDirectory: string
    env: Record<string, string>
    flavour: 'system' | 'internal'
}

export async function promptForConfigPassword(message: string) {
    console.log('[promptForConfigPassword] message:', message)
    try {
        const result = await invoke<string | null>('prompt', {
            title: 'Rclone UI',
            message: message.replace(/"/g, '“'),
            default: null,
            sensitive: true,
        })
        console.log('[promptForConfigPassword] received result type:', typeof result)

        if (typeof result === 'string') {
            console.log('[promptForConfigPassword] password received, length:', result.length)
            return result.trim()
        }

        console.log('[promptForConfigPassword] no password received (cancelled or empty)')
        return null
    } catch (error) {
        console.error('[promptForConfigPassword] Error prompting for password:', error)
        return null
    }
}

async function validateConfigAccess(
    commandName: 'rclone-system' | 'rclone-internal',
    env: Record<string, string>
): Promise<{
    success: boolean
    code?: number | null
    stderr?: string
    error?: Error
}> {
    console.log('[validateConfigAccess] command:', commandName)
    try {
        const command = Command.create(commandName, ['config', 'dump'], { env })
        const result = await command.execute()
        console.log('[validateConfigAccess] exit code:', result.code)

        if (result.code === 0) {
            return { success: true }
        }

        return {
            success: false,
            code: result.code ?? null,
            stderr: result.stderr,
        }
    } catch (error) {
        console.error('[validateConfigAccess] execution error:', error)
        return {
            success: false,
            error: error instanceof Error ? error : new Error(String(error)),
        }
    }
}

export async function ensureEncryptedConfigEnv(
    activeConfig: ConfigFile,
    env: Record<string, string>,
    autoPromptForPassword: boolean,
    commandName: 'rclone-system' | 'rclone-internal',
    promptMessage: string
) {
    console.log('[ensureEncryptedConfigEnv] ensuring encrypted config env for:', activeConfig.id)

    env.RCLONE_ASK_PASSWORD = 'false'

    if (activeConfig.passCommand) {
        console.log('[ensureEncryptedConfigEnv] using passCommand for decryption')
        const validationEnv = {
            ...env,
            RCLONE_CONFIG_PASS_COMMAND: activeConfig.passCommand,
        }

        const validation = await validateConfigAccess(commandName, validationEnv)
        if (validation.success) {
            console.log('[ensureEncryptedConfigEnv] passCommand validation succeeded')
            env.RCLONE_CONFIG_PASS_COMMAND = activeConfig.passCommand
            return
        }

        console.error('[ensureEncryptedConfigEnv] passCommand validation failed', validation.code)
        await message(
            'Failed to decrypt the configuration using the configured password command. Please verify the command output.',
            {
                title: 'Password Command Failed',
                kind: 'error',
                okLabel: 'OK',
            }
        )
        throw new Error('Failed to decrypt configuration using pass command.')
    }

    let password = activeConfig.pass ?? undefined
    let passwordSource: 'stored' | 'prompted' | null = password ? 'stored' : null

    const hostStore = useHostStore.getState()
    const updateConfigFile = hostStore.updateConfigFile
    const activeConfigId = activeConfig.id

    if (!password && !autoPromptForPassword) {
        throw new Error('Password required to access encrypted configuration.')
    }

    while (true) {
        if (!password) {
            if (!autoPromptForPassword) {
                throw new Error('Password required to access encrypted configuration.')
            }

            const promptedPassword = await promptForConfigPassword(promptMessage)
            console.log('[ensureEncryptedConfigEnv] password received:', !!promptedPassword)

            if (!promptedPassword) {
                console.log('[ensureEncryptedConfigEnv] password prompt cancelled by user')
                throw new Error('Password prompt cancelled by user.')
            }

            password = promptedPassword
            passwordSource = 'prompted'
        }

        const validationEnv = {
            ...env,
            RCLONE_CONFIG_PASS: password,
        }

        const validation = await validateConfigAccess(commandName, validationEnv)
        if (validation.success) {
            console.log('[ensureEncryptedConfigEnv] password validation succeeded')
            env.RCLONE_CONFIG_PASS = password
            return
        }

        console.error('[ensureEncryptedConfigEnv] password validation failed', validation.code)

        if (passwordSource === 'stored') {
            console.log('[ensureEncryptedConfigEnv] clearing invalid stored password')
            if (activeConfigId && updateConfigFile) {
                try {
                    updateConfigFile(activeConfigId, { pass: undefined })
                    console.log('[ensureEncryptedConfigEnv] stored password cleared')
                } catch (error) {
                    Sentry.captureException(error)
                    console.error(
                        '[ensureEncryptedConfigEnv] failed to clear stored password',
                        error
                    )
                }
            }

            await message(
                'The saved password for this configuration appears to be incorrect. You will be prompted for a new password.',
                {
                    title: 'Invalid Password',
                    kind: 'error',
                    okLabel: 'OK',
                }
            )

            password = undefined
            passwordSource = null
            continue
        }

        if (!autoPromptForPassword) {
            throw new Error('Password required to access encrypted configuration.')
        }

        const response = await message('Incorrect password. Please try again.', {
            title: 'Invalid Password',
            kind: 'error',
            buttons: {
                ok: 'Try Again',
                cancel: 'Cancel',
            },
        })

        if (response !== 'Try Again') {
            console.log('[ensureEncryptedConfigEnv] user cancelled password retry')
            throw new Error('Password prompt cancelled by user.')
        }

        password = undefined
        passwordSource = null
    }
}

async function createRcloneCliCommand(
    args: string[],
    additionalEnv?: Record<string, string>,
    autoPromptForPassword = true
): Promise<RcloneCliCommandContext> {
    console.log('[createRcloneCliCommand] creating rclone CLI command with args:', args)
    const env: Record<string, string> = {}
    const hostStore = useHostStore.getState()
    const activeConfig = hostStore.activeConfigFile

    if (!activeConfig || !activeConfig.id) {
        throw new Error('No active configuration selected.')
    }

    console.log('[createRcloneCliCommand] active config:', activeConfig)

    let configPath: string
    try {
        configPath = await getConfigPath({ id: activeConfig.id, validate: true })
    } catch (error) {
        Sentry.captureException(error)
        throw error
    }

    console.log('[createRcloneCliCommand] config path:', configPath)

    const configDirectory = getConfigParentFolder(configPath)
    console.log('[createRcloneCliCommand] config directory:', configDirectory)

    const proxy = hostStore.proxy
    console.log('[createRcloneCliCommand] proxy:', proxy)
    if (proxy?.url) {
        env.http_proxy = proxy.url
        env.https_proxy = proxy.url
        env.HTTP_PROXY = proxy.url
        env.HTTPS_PROXY = proxy.url
        env.no_proxy = proxy.ignoredHosts.join(',')
        env.NO_PROXY = proxy.ignoredHosts.join(',')
    }

    console.log('[createRcloneCliCommand] checking for system rclone installation')
    const hasSystem = await isSystemRcloneInstalled()
    console.log('[createRcloneCliCommand] checking for internal rclone installation')
    const hasInternal = await isInternalRcloneInstalled()

    console.log('[createRcloneCliCommand] has system:', hasSystem)
    console.log('[createRcloneCliCommand] has internal:', hasInternal)

    if (!hasSystem && !hasInternal) {
        console.log('[createRcloneCliCommand] no rclone installation found')
        const error = new Error('Unable to locate an rclone installation.')
        Sentry.captureException(error)
        throw error
    }

    const flavour = hasSystem ? 'system' : 'internal'
    const commandName = flavour === 'system' ? 'rclone-system' : 'rclone-internal'

    if (!hasSystem || activeConfig.id !== 'default') {
        console.log('[createRcloneCliCommand] setting config directory and path')
        env.RCLONE_CONFIG_DIR = configDirectory
        env.RCLONE_CONFIG = configPath.endsWith('rclone.conf')
            ? configPath
            : `${configDirectory}${sep()}rclone.conf`
    }

    if (activeConfig.isEncrypted) {
        console.log('[createRcloneCliCommand] ensuring encrypted configuration access')
        await ensureEncryptedConfigEnv(
            activeConfig,
            env,
            autoPromptForPassword,
            commandName,
            `Please enter the current password for "${activeConfig.label}"`
        )
    }

    if (additionalEnv) {
        console.log('[createRcloneCliCommand] setting additional environment')
        Object.assign(env, additionalEnv)
    }

    console.log(
        '[createRcloneCliCommand] creating command, name:',
        commandName,
        'args:',
        args,
        'env:',
        env
    )

    const command = Command.create(commandName, args, { env })

    console.log('[createRcloneCliCommand] command created')

    return {
        command,
        activeConfig,
        configPath,
        configDirectory,
        env,
        flavour,
    }
}

export async function runRcloneCli(args: string[], input: string[] = []) {
    const { command } = await createRcloneCliCommand(args, undefined, true)

    let stdout = ''
    let stderr = ''

    console.log('[runRcloneCli] running command', 'args:', args, 'input:', input)

    return await new Promise<void>((resolve, reject) => {
        command.stdout.on('data', (line) => {
            console.log('[runRcloneCli] stdout:', line)
            stdout += line
        })
        command.stderr.on('data', (line) => {
            console.log('[runRcloneCli] stderr:', line)
            stderr += line
        })
        command.addListener('error', (event) => {
            console.log('[runRcloneCli] error:', event)
            const error = typeof event === 'string' ? new Error(event) : event
            Sentry.captureException(error)
            reject(error instanceof Error ? error : new Error('Unknown rclone CLI error.'))
        })
        command.addListener('close', (event) => {
            console.log('[runRcloneCli] close:', event)

            if (event.code === 0) {
                resolve()
                return
            }

            const error = new Error(
                `rclone command failed (code ${event.code ?? 'unknown'}): ${stderr || stdout}`
            )
            Sentry.captureException(error)
            reject(error)
        })

        command
            .spawn()
            .then(async (child) => {
                console.log('[runRcloneCli] child:', child)
                for (const line of input) {
                    console.log('[runRcloneCli] writing input:', line)
                    await child.write(`${line}\n`)
                    await new Promise((resolve) => setTimeout(resolve, 100))
                    console.log('[runRcloneCli] input written')
                }
            })
            .catch((error) => {
                console.log('[runRcloneCli] error:', error)
                Sentry.captureException(error)
                reject(error)
            })
    })
}

export async function restartActiveRclone() {
    try {
        ;(await getAllWindows())
            .filter((window) => window.label === 'main')[0]
            .emit('restart-rclone')
        // await getCurrentWindow().emit('restart-rclone')
    } catch (error) {
        Sentry.captureException(error)
        console.error('[restartActiveRclone] failed to emit restart event', error)
    }
}
