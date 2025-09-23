import * as Sentry from '@sentry/browser'
import { invoke } from '@tauri-apps/api/core'
import { BaseDirectory, appLocalDataDir, appLogDir, sep } from '@tauri-apps/api/path'
import { tempDir } from '@tauri-apps/api/path'
import { ask, message } from '@tauri-apps/plugin-dialog'
import { copyFile, exists, mkdir, readTextFile, remove } from '@tauri-apps/plugin-fs'
import { writeFile } from '@tauri-apps/plugin-fs'
import { fetch } from '@tauri-apps/plugin-http'
import { platform } from '@tauri-apps/plugin-os'
import { exit } from '@tauri-apps/plugin-process'
import { Command } from '@tauri-apps/plugin-shell'
import { usePersistedStore, useStore } from '../store'
import { openSmallWindow } from '../window'
import {
    createConfigFile,
    getConfigPath,
    getSystemConfigPath,
    isInternalRcloneInstalled,
    isSystemRcloneInstalled,
    shouldUpdateRclone,
} from './common'
import { RCLONE_CONF_REGEX } from './constants'

export async function initRclone(args: string[]) {
    console.log('[initRclone]')

    const system = await isSystemRcloneInstalled()
    let internal = await isInternalRcloneInstalled()

    // rclone not available, let's download it
    if (!system && !internal) {
        usePersistedStore.setState({ isFirstOpen: false })
        useStore.setState({ startupStatus: 'initializing' })
        await openSmallWindow({
            name: 'Startup',
            url: '/startup',
        })
        const success = await provisionRclone()
        if (!success) {
            useStore.setState({ startupStatus: 'fatal' })
            return
        }
        useStore.setState({ startupStatus: 'initialized' })
        internal = true
    }

    if (await shouldUpdateRclone(system ? 'system' : 'internal')) {
        console.log('[initRclone] needs update')

        useStore.setState({ startupStatus: 'updating' })

        await openSmallWindow({
            name: 'Startup',
            url: '/startup',
        })

        try {
            if (system) {
                console.log('[initRclone] updating system rclone')
                const code = (await invoke('update_system_rclone')) as number
                console.log('[initRclone] update_rclone code', code)
                if (code !== 0) {
                    console.log(
                        '[initRclone] system rclone update failed or was cancelled by user, code:',
                        code
                    )
                    useStore.setState({ startupStatus: 'error' })
                } else {
                    useStore.setState({ startupStatus: 'updated' })
                }
            }
            if (internal) {
                console.log('[initRclone] updating internal rclone')
                const instance = Command.create('rclone-internal', ['selfupdate'])
                const updateResult = await instance.execute()
                console.log('[initRclone] updateResult', JSON.stringify(updateResult, null, 2))
                if (updateResult.code !== 0) {
                    console.log(
                        '[initRclone] internal rclone update failed, code:',
                        updateResult.code
                    )
                    useStore.setState({ startupStatus: 'error' })
                } else {
                    useStore.setState({ startupStatus: 'updated' })
                }
            }
        } catch (error) {
            console.error('[initRclone] failed to update rclone', error)
            useStore.setState({ startupStatus: 'error' })
        }
    }

    const persistedState = usePersistedStore.getState()
    let configFiles = persistedState.configFiles || []
    let activeConfigFile = persistedState.activeConfigFile

    if (system) {
        const defaultPath = await getSystemConfigPath()
        console.log('[initRclone] defaultPath', defaultPath)

        await createConfigFile(defaultPath)
    }

    configFiles = configFiles.filter((config) => config.id !== 'default')
    configFiles.unshift({
        id: 'default',
        label: 'Default config',
        sync: undefined,
        isEncrypted: false,
        pass: undefined,
        passCommand: undefined,
    })
    usePersistedStore.setState({ configFiles })

    if (!activeConfigFile) {
        activeConfigFile = configFiles[0]
        if (!activeConfigFile) {
            throw new Error('Failed to get active config file')
        }

        usePersistedStore.setState({ activeConfigFile })
    }

    if (internal && activeConfigFile.id === 'default') {
        const defaultInternalPath = await getConfigPath({ id: 'default', validate: false })
        await createConfigFile(defaultInternalPath)
    }

    let configFolderPath = activeConfigFile.sync
        ? activeConfigFile.sync
        : (await getConfigPath({ id: activeConfigFile.id!, validate: true })).replace(
              RCLONE_CONF_REGEX,
              ''
          )

    console.log('[initRclone] configFolderPath', configFolderPath)

    if (activeConfigFile.sync) {
        if (!(await exists(`${configFolderPath}${sep()}rclone.conf`))) {
            await message('The config file could not be found. Switching to the default config.', {
                title: 'Invalid synced config',
                kind: 'error',
                okLabel: 'OK',
            })
            activeConfigFile = configFiles[0]
            configFolderPath = (await getConfigPath({ id: 'default', validate: true })).replace(
                RCLONE_CONF_REGEX,
                ''
            )
            usePersistedStore.setState({ activeConfigFile: configFiles[0] })
        }
    }

    let password: string | null = activeConfigFile.pass || activeConfigFile.passCommand || null
    try {
        const configPath = `${configFolderPath}${sep()}rclone.conf`
        console.log('[initRclone] configPath', configPath)
        const configContent = await readTextFile(configPath)
        const isEncrypted = configContent.includes('RCLONE_ENCRYPT_V0:')

        if (isEncrypted) {
            if (!password) {
                password = await promptForConfigPassword(activeConfigFile.label)
                console.log('[initRclone] password', password)

                if (!password) {
                    await message('Password is required for encrypted configurations.', {
                        title: 'Password Required',
                        kind: 'error',
                        okLabel: 'OK',
                    })
                    await exit(0)
                    return
                }

                if (!activeConfigFile.isEncrypted) {
                    const updatedConfigFile = { ...activeConfigFile, isEncrypted: true }
                    const updatedConfigFiles = configFiles.map((config) =>
                        config.id === activeConfigFile!.id ? updatedConfigFile : config
                    )
                    usePersistedStore.setState({
                        configFiles: updatedConfigFiles,
                        activeConfigFile: updatedConfigFile,
                    })

                    // Update activeConfigFile reference for the rest of the function
                    activeConfigFile = updatedConfigFile
                }
            }
        } else if (activeConfigFile.isEncrypted) {
            const updatedConfigFile = { ...activeConfigFile, isEncrypted: false }
            const updatedConfigFiles = configFiles.map((config) =>
                config.id === activeConfigFile!.id ? updatedConfigFile : config
            )
            usePersistedStore.setState({
                configFiles: updatedConfigFiles,
                activeConfigFile: updatedConfigFile,
            })

            // Update activeConfigFile reference for the rest of the function
            activeConfigFile = updatedConfigFile
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

    const extraParams: { env: Record<string, string> } = {
        env: {},
    }

    if (persistedState.proxy) {
        try {
            await invoke<string>('test_proxy_connection', { proxy_url: persistedState.proxy.url })
        } catch {
            const continueAnyway = await ask(
                'You have a proxy set, but it failed to connect. Do you want to continue anyway?',
                {
                    title: 'Error',
                    kind: 'warning',
                    okLabel: 'Continue',
                    cancelLabel: 'Exit',
                }
            )

            if (!continueAnyway) {
                await exit(0)
                return
            }
        }
        extraParams.env.http_proxy = persistedState.proxy.url
        extraParams.env.https_proxy = persistedState.proxy.url
        extraParams.env.HTTP_PROXY = persistedState.proxy.url
        extraParams.env.HTTPS_PROXY = persistedState.proxy.url
        extraParams.env.no_proxy = persistedState.proxy.ignoredHosts.join(',')
        extraParams.env.NO_PROXY = persistedState.proxy.ignoredHosts.join(',')
    }

    if (activeConfigFile.isEncrypted) {
        extraParams.env.RCLONE_ASK_PASSWORD = 'false'
        if (activeConfigFile.passCommand) {
            extraParams.env.RCLONE_CONFIG_PASS_COMMAND = activeConfigFile.passCommand
        } else {
            extraParams.env.RCLONE_CONFIG_PASS = activeConfigFile.pass || password!
        }
    }

    if (internal || activeConfigFile.id !== 'default') {
        extraParams.env.RCLONE_CONFIG_DIR = configFolderPath
        extraParams.env.RCLONE_CONFIG = `${configFolderPath}${sep()}rclone.conf`
    }

    console.log('[initRclone] extraParams', extraParams)

    if (system) {
        console.log('[initRclone] running system rclone')
        const instance = Command.create('rclone-system', args, extraParams)
        return { system: instance }
    }
    if (internal) {
        console.log('[initRclone] running internal rclone')
        const instance = Command.create('rclone-internal', args, extraParams)
        return { internal: instance }
    }

    throw new Error('Failed to initialize rclone, please try again later.')
}

/**
 * Downloads and provisions the latest version of rclone for the current platform
 * @throws {Error} If architecture detection fails or installation is unsuccessful
 * @returns {Promise<void>}
 */
export async function provisionRclone() {
    console.log('[provisionRclone]')

    const currentVersionString = await fetch('https://downloads.rclone.org/version.txt').then(
        (res) => res.text()
    )
    console.log('[provisionRclone] currentVersionString', currentVersionString)

    const currentVersion = currentVersionString.split('v')?.[1]?.trim()

    if (!currentVersion) {
        console.error('[provisionRclone] failed to get latest version')
        await message('Failed to get latest rclone version, please try again later.')
        return
    }
    console.log('[provisionRclone] currentVersion', currentVersion)

    const currentPlatform = platform()
    console.log('currentPlatform', currentPlatform)

    const currentOs = currentPlatform === 'macos' ? 'osx' : currentPlatform
    console.log('currentOs', currentOs)

    let tempDirPath = await tempDir()
    if (tempDirPath.endsWith(sep())) {
        tempDirPath = tempDirPath.slice(0, -1)
    }
    console.log('[provisionRclone] tempDirPath', tempDirPath)

    const arch = (await invoke('get_arch')) as 'arm64' | 'amd64' | '386' | 'unknown'
    console.log('[provisionRclone] arch', arch)

    if (arch === 'unknown') {
        console.error('[provisionRclone] failed to get architecture')
        await message('Failed to get current arch, please try again later.')
        return
    }

    const downloadUrl = `https://downloads.rclone.org/v${currentVersion}/rclone-v${currentVersion}-${currentOs}-${arch}.zip`
    console.log('[provisionRclone] downloadUrl', downloadUrl)

    const downloadedFile = await fetch(downloadUrl).then((res) => res.arrayBuffer())
    console.log('[provisionRclone] downloadedFile')

    let tempDirExists = false
    try {
        tempDirExists = await exists('rclone', {
            baseDir: BaseDirectory.Temp,
        })
        console.log('[provisionRclone] tempDirExists', tempDirExists)
    } catch (error) {
        Sentry.captureException(error)
        console.error('[provisionRclone] failed to check if rclone temp dir exists', error)
    }

    if (tempDirExists) {
        try {
            await remove('rclone', {
                recursive: true,
                baseDir: BaseDirectory.Temp,
            })
            console.log('[provisionRclone] removed rclone temp dir')
        } catch (error) {
            Sentry.captureException(error)
            console.error('[provisionRclone] failed to remove rclone temp dir', error)
            await message('Failed to provision rclone.')
            return
        }
    }

    try {
        await mkdir('rclone', {
            baseDir: BaseDirectory.Temp,
        })
        console.log('[provisionRclone] created rclone temp dir')
    } catch (error) {
        Sentry.captureException(error)
        console.error('[provisionRclone] failed to create rclone temp dir', error)
        await message('Failed to provision rclone.')
        return
    }

    const zipPath = [
        tempDirPath,
        'rclone',
        `rclone-v${currentVersion}-${currentOs}-${arch}.zip`,
    ].join(sep())
    console.log('[provisionRclone] zipPath', zipPath)

    try {
        await writeFile(zipPath, new Uint8Array(downloadedFile))
        console.log('[provisionRclone] wrote zip file')
    } catch (error) {
        Sentry.captureException(error)
        console.error('[provisionRclone] failed to write zip file', error)
        await message('Failed to provision rclone.')
        return
    }

    try {
        await invoke('unzip_file', {
            zipPath,
            outputFolder: `${tempDirPath}${sep()}rclone${sep()}extracted`,
        })
        console.log('[provisionRclone] successfully unzipped file')
    } catch (error) {
        Sentry.captureException(error)
        console.error('[provisionRclone] failed to unzip file', error)
        await message('Failed to provision rclone.')
        return
    }

    const unarchivedPath = [
        tempDirPath,
        'rclone',
        'extracted',
        `rclone-v${currentVersion}-${currentOs}-${arch}`,
    ].join(sep())
    console.log('[provisionRclone] unarchivedPath', unarchivedPath)

    const binaryName = currentPlatform === 'windows' ? 'rclone.exe' : 'rclone'

    const rcloneBinaryPath = unarchivedPath + sep() + binaryName
    console.log('[provisionRclone] rcloneBinaryPath', rcloneBinaryPath)

    try {
        const binaryExists = await exists(rcloneBinaryPath)
        console.log('[provisionRclone] rcloneBinaryPathExists', binaryExists)
        if (!binaryExists) {
            throw new Error('Could not find rclone binary in zip')
        }
    } catch (error) {
        Sentry.captureException(error)
        console.error('[provisionRclone] failed to check if rclone binary exists', error)
        await message('Failed to provision rclone.')
    }

    const appLocalDataDirPath = await appLocalDataDir()
    console.log('[provisionRclone] appLocalDataDirPath', appLocalDataDirPath)

    const appLocalDataDirPathExists = await exists(appLocalDataDirPath)
    console.log('[provisionRclone] appLocalDataDirPathExists', appLocalDataDirPathExists)

    if (!appLocalDataDirPathExists) {
        await mkdir(appLocalDataDirPath, {
            recursive: true,
        })
        console.log('[provisionRclone] appLocalDataDirPath created')
    }

    await copyFile(rcloneBinaryPath, `${appLocalDataDirPath}${sep()}${binaryName}`)
    console.log('[provisionRclone] copied rclone binary')

    const hasInstalled = await isInternalRcloneInstalled()

    if (!hasInstalled) {
        throw new Error('Failed to install rclone')
    }

    console.log('[provisionRclone] rclone has been installed')

    return true
}

/**
 * Prompts the user for a password for an encrypted configuration
 * @param configLabel - The label of the configuration file
 * @returns Promise<string | null> - The password entered by the user, or null if cancelled
 */
async function promptForConfigPassword(configLabel: string): Promise<string | null> {
    try {
        const result = await invoke<string | null>('prompt_password', {
            title: 'Rclone UI',
            message: `Please enter the password for the encrypted configuration "${configLabel}".`,
        })

        if (typeof result === 'string') {
            return result.trim()
        }

        return null
    } catch (error) {
        console.error('[promptForConfigPassword] Error prompting for password:', error)
        return null
    }
}
