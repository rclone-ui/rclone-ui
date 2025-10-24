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
import { getConfigParentFolder } from '../format'
import { usePersistedStore, useStore } from '../store'
import { openSmallWindow } from '../window'
import {
    createConfigFile,
    getConfigPath,
    getRcloneVersion,
    getSystemConfigPath,
    isInternalRcloneInstalled,
    isSystemRcloneInstalled,
    shouldUpdateRclone,
} from './common'

export async function initRclone(args: string[]) {
    console.log('[initRclone] starting with args:', args)

    const system = await isSystemRcloneInstalled()
    console.log('[initRclone] system rclone installed:', system)
    let internal = await isInternalRcloneInstalled()
    console.log('[initRclone] internal rclone installed:', internal)

    // rclone not available, let's download it
    if (!system && !internal) {
        console.log('[initRclone] no rclone installation found, provisioning...')
        useStore.setState({ startupDisplayed: true })
        useStore.setState({ startupStatus: 'initializing' })
        await openSmallWindow({
            name: 'Startup',
            url: '/startup',
        })
        const success = await provisionRclone()
        console.log('[initRclone] provision rclone result:', success)
        if (!success) {
            console.error('[initRclone] provision failed, setting fatal status')
            useStore.setState({ startupStatus: 'fatal' })
            return
        }
        console.log('[initRclone] provision succeeded')
        useStore.setState({ startupStatus: 'initialized' })

        if (!['windows', 'macos'].includes(platform())) {
            usePersistedStore.setState({ hideStartup: true })
        }

        internal = true
    }

    const rcloneVersion = await getRcloneVersion(system ? 'system' : 'internal')
    console.log('[initRclone] rclone version:', rcloneVersion)

    if (shouldUpdateRclone(rcloneVersion)) {
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
                    const skipping = await ask(
                        'You are running an outdated version of the CLI that could not be updated.\n\nPlease update manually and restart Rclone UI.',
                        {
                            title: 'Error',
                            kind: 'error',
                            okLabel: 'Skip version',
                            cancelLabel: 'Exit',
                        }
                    )
                    console.log('[initRclone] user skipping version:', skipping)
                    if (skipping) {
                        console.log('[initRclone] saving skipped version:', rcloneVersion!.yours)
                        usePersistedStore.setState({ lastSkippedVersion: rcloneVersion!.yours })
                    }
                } else {
                    console.log('[initRclone] system rclone updated successfully')
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
                    console.log('[initRclone] internal rclone updated successfully')
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
    console.log('[initRclone] loaded config files count:', configFiles.length)
    let activeConfigFile = persistedState.activeConfigFile
    console.log('[initRclone] active config file:', activeConfigFile?.id)

    if (system) {
        const defaultPath = await getSystemConfigPath()
        console.log('[initRclone] defaultPath', defaultPath)

        await createConfigFile(defaultPath)
        console.log('[initRclone] created system config file')
    }

    configFiles = configFiles.filter((config) => config.id !== 'default')
    console.log('[initRclone] filtered config files, remaining count:', configFiles.length)
    configFiles.unshift({
        id: 'default',
        label: 'Default config',
        sync: undefined,
        isEncrypted: false,
        pass: undefined,
        passCommand: undefined,
    })
    console.log('[initRclone] added default config to list')
    usePersistedStore.setState({ configFiles })

    if (!activeConfigFile) {
        console.log('[initRclone] no active config file, setting default')
        activeConfigFile = configFiles[0]
        if (!activeConfigFile) {
            console.error('[initRclone] failed to get active config file')
            throw new Error('Failed to get active config file')
        }

        console.log('[initRclone] set active config file to:', activeConfigFile.id)
        usePersistedStore.setState({ activeConfigFile })
    }

    if (internal && activeConfigFile.id === 'default') {
        console.log('[initRclone] creating internal default config file')
        const defaultInternalPath = await getConfigPath({ id: 'default', validate: false })
        await createConfigFile(defaultInternalPath)
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
            configFolderPath = getConfigParentFolder(
                await getConfigPath({ id: 'default', validate: true })
            )
            console.log('[initRclone] switched to default config')
            usePersistedStore.setState({ activeConfigFile: configFiles[0] })
        }
    }

    let password: string | null = activeConfigFile.pass || activeConfigFile.passCommand || null
    console.log('[initRclone] password configured:', !!password)
    try {
        console.log('[initRclone] reading config file', configPath)
        const configContent = await readTextFile(configPath)
        const isEncrypted = configContent.includes('RCLONE_ENCRYPT_V0:')

        console.log('[initRclone] isEncrypted', isEncrypted)

        if (isEncrypted) {
            console.log('[initRclone] config file is encrypted')
            if (password) {
                console.log('[initRclone] using existing password')
            } else {
                console.log('[initRclone] prompting user for password')
                password = await promptForConfigPassword(activeConfigFile.label)
                console.log('[initRclone] password received:', !!password)

                if (!password) {
                    console.error('[initRclone] no password provided, exiting')
                    await message('Password is required for encrypted configurations.', {
                        title: 'Password Required',
                        kind: 'error',
                        okLabel: 'OK',
                    })
                    await exit(0)
                    return
                }

                if (!activeConfigFile.isEncrypted) {
                    console.log('[initRclone] updating config file encryption flag')
                    const updatedConfigFile = { ...activeConfigFile, isEncrypted: true }
                    const updatedConfigFiles = configFiles.map((config) =>
                        config.id === activeConfigFile!.id ? updatedConfigFile : config
                    )
                    usePersistedStore.setState({
                        configFiles: updatedConfigFiles,
                        activeConfigFile: updatedConfigFile,
                    })
                    console.log('[initRclone] saved updated encryption flag')

                    // Update activeConfigFile reference for the rest of the function
                    activeConfigFile = updatedConfigFile
                }
            }
        } else if (activeConfigFile.isEncrypted) {
            console.log('[initRclone] config file is not encrypted, clearing encryption flag')
            const updatedConfigFile = { ...activeConfigFile, isEncrypted: false }
            const updatedConfigFiles = configFiles.map((config) =>
                config.id === activeConfigFile!.id ? updatedConfigFile : config
            )
            usePersistedStore.setState({
                configFiles: updatedConfigFiles,
                activeConfigFile: updatedConfigFile,
            })
            console.log('[initRclone] cleared encryption flag')

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
        console.log('[initRclone] proxy configured:', persistedState.proxy.url)
        try {
            console.log('[initRclone] testing proxy connection')
            await invoke<string>('test_proxy_connection', { proxy_url: persistedState.proxy.url })
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
        console.log('[initRclone] setting proxy environment variables')
        extraParams.env.http_proxy = persistedState.proxy.url
        extraParams.env.https_proxy = persistedState.proxy.url
        extraParams.env.HTTP_PROXY = persistedState.proxy.url
        extraParams.env.HTTPS_PROXY = persistedState.proxy.url
        extraParams.env.no_proxy = persistedState.proxy.ignoredHosts.join(',')
        extraParams.env.NO_PROXY = persistedState.proxy.ignoredHosts.join(',')
        console.log(
            '[initRclone] proxy env vars set, ignored hosts:',
            persistedState.proxy.ignoredHosts.length
        )
    }

    if (activeConfigFile.isEncrypted) {
        console.log('[initRclone] setting encryption environment variables')
        extraParams.env.RCLONE_ASK_PASSWORD = 'false'
        if (activeConfigFile.passCommand) {
            console.log('[initRclone] using passCommand for decryption')
            extraParams.env.RCLONE_CONFIG_PASS_COMMAND = activeConfigFile.passCommand
        } else {
            console.log('[initRclone] using password for decryption')
            extraParams.env.RCLONE_CONFIG_PASS = activeConfigFile.pass || password!
        }
    }

    if (internal || activeConfigFile.id !== 'default') {
        console.log('[initRclone] setting custom config path:', configFolderPath)
        extraParams.env.RCLONE_CONFIG_DIR = configFolderPath
        extraParams.env.RCLONE_CONFIG = `${configFolderPath}${sep()}rclone.conf`
    }

    console.log('[initRclone] extraParams', extraParams)

    if (system) {
        console.log('[initRclone] creating system rclone command instance')
        const instance = Command.create('rclone-system', args, extraParams)
        console.log('[initRclone] returning system rclone instance')
        return { system: instance }
    }
    if (internal) {
        console.log('[initRclone] creating internal rclone command instance')
        const instance = Command.create('rclone-internal', args, extraParams)
        console.log('[initRclone] returning internal rclone instance')
        return { internal: instance }
    }

    console.error('[initRclone] no rclone installation available')
    throw new Error('Failed to initialize rclone, please try again later.')
}

/**
 * Downloads and provisions the latest version of rclone for the current platform
 * @throws {Error} If architecture detection fails or installation is unsuccessful
 * @returns {Promise<void>}
 */
export async function provisionRclone() {
    console.log('[provisionRclone] starting provisioning process')

    console.log('[provisionRclone] fetching latest version info')
    const currentVersionString = await fetch('https://downloads.rclone.org/version.txt').then(
        (res) => res.text()
    )
    console.log('[provisionRclone] currentVersionString', currentVersionString)

    const currentVersion = currentVersionString.split('v')?.[1]?.trim()

    if (!currentVersion) {
        console.error('[provisionRclone] failed to get latest version from string')
        await message('Failed to get latest rclone version, please try again later.')
        return false
    }
    console.log('[provisionRclone] currentVersion', currentVersion)

    const currentPlatform = platform()
    console.log('[provisionRclone] currentPlatform', currentPlatform)

    const currentOs = currentPlatform === 'macos' ? 'osx' : currentPlatform
    console.log('[provisionRclone] currentOs', currentOs)

    console.log('[provisionRclone] getting temp directory path')
    let tempDirPath = await tempDir()
    if (tempDirPath.endsWith(sep())) {
        tempDirPath = tempDirPath.slice(0, -1)
    }
    console.log('[provisionRclone] tempDirPath', tempDirPath)

    console.log('[provisionRclone] detecting system architecture')
    const arch = (await invoke('get_arch')) as 'arm64' | 'amd64' | '386' | 'unknown'
    console.log('[provisionRclone] arch', arch)

    if (arch === 'unknown') {
        console.error('[provisionRclone] failed to get architecture')
        await message('Failed to get current arch, please try again later.')
        return false
    }

    const downloadUrl = `https://downloads.rclone.org/v${currentVersion}/rclone-v${currentVersion}-${currentOs}-${arch}.zip`
    console.log('[provisionRclone] downloadUrl', downloadUrl)

    console.log('[provisionRclone] downloading rclone binary')
    const downloadedFile = await fetch(downloadUrl).then((res) => res.arrayBuffer())
    console.log('[provisionRclone] download complete, size:', downloadedFile.byteLength)

    console.log('[provisionRclone] checking if temp rclone directory exists')
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
        console.log('[provisionRclone] removing existing temp directory')
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
            return false
        }
    }

    console.log('[provisionRclone] creating temp directory')
    try {
        await mkdir('rclone', {
            baseDir: BaseDirectory.Temp,
        })
        console.log('[provisionRclone] created rclone temp dir')
    } catch (error) {
        Sentry.captureException(error)
        console.error('[provisionRclone] failed to create rclone temp dir', error)
        await message('Failed to provision rclone.')
        return false
    }

    const zipPath = [
        tempDirPath,
        'rclone',
        `rclone-v${currentVersion}-${currentOs}-${arch}.zip`,
    ].join(sep())
    console.log('[provisionRclone] zipPath', zipPath)

    console.log('[provisionRclone] writing zip file to disk')
    try {
        await writeFile(zipPath, new Uint8Array(downloadedFile))
        console.log('[provisionRclone] wrote zip file successfully')
    } catch (error) {
        Sentry.captureException(error)
        console.error('[provisionRclone] failed to write zip file', error)
        await message('Failed to provision rclone.')
        return false
    }

    const extractPath = `${tempDirPath}${sep()}rclone${sep()}extracted`
    console.log('[provisionRclone] extracting zip file to:', extractPath)
    try {
        await invoke('unzip_file', {
            zipPath,
            outputFolder: extractPath,
        })
        console.log('[provisionRclone] successfully unzipped file')
    } catch (error) {
        Sentry.captureException(error)
        console.error('[provisionRclone] failed to unzip file', error)
        await message('Failed to provision rclone.')
        return false
    }

    const unarchivedPath = [
        tempDirPath,
        'rclone',
        'extracted',
        `rclone-v${currentVersion}-${currentOs}-${arch}`,
    ].join(sep())
    console.log('[provisionRclone] unarchivedPath', unarchivedPath)

    const binaryName = currentPlatform === 'windows' ? 'rclone.exe' : 'rclone'
    console.log('[provisionRclone] binaryName', binaryName)

    const rcloneBinaryPath = unarchivedPath + sep() + binaryName
    console.log('[provisionRclone] rcloneBinaryPath', rcloneBinaryPath)

    console.log('[provisionRclone] verifying extracted binary exists')
    try {
        const binaryExists = await exists(rcloneBinaryPath)
        console.log('[provisionRclone] rcloneBinaryPathExists', binaryExists)
        if (!binaryExists) {
            console.error('[provisionRclone] binary not found in expected location')
            throw new Error('Could not find rclone binary in zip')
        }
    } catch (error) {
        Sentry.captureException(error)
        console.error('[provisionRclone] failed to check if rclone binary exists', error)
        await message('Failed to provision rclone.')
        return false
    }

    console.log('[provisionRclone] getting app local data directory')
    const appLocalDataDirPath = await appLocalDataDir()
    console.log('[provisionRclone] appLocalDataDirPath', appLocalDataDirPath)

    console.log('[provisionRclone] checking if app local data directory exists')
    const appLocalDataDirPathExists = await exists(appLocalDataDirPath)
    console.log('[provisionRclone] appLocalDataDirPathExists', appLocalDataDirPathExists)

    if (!appLocalDataDirPathExists) {
        console.log('[provisionRclone] creating app local data directory')
        await mkdir(appLocalDataDirPath, {
            recursive: true,
        })
        console.log('[provisionRclone] appLocalDataDirPath created')
    }

    const targetBinaryPath = `${appLocalDataDirPath}${sep()}${binaryName}`
    console.log('[provisionRclone] targetBinaryPath', targetBinaryPath)

    console.log('[provisionRclone] copying binary to final location')
    const maxCopyRetries = 3
    for (let attempt = 1; attempt <= maxCopyRetries; attempt++) {
        console.log(`[provisionRclone] copy attempt ${attempt}/${maxCopyRetries}`)
        try {
            await copyFile(rcloneBinaryPath, targetBinaryPath)
            console.log('[provisionRclone] copied rclone binary successfully')
            break
        } catch (copyError) {
            console.log(
                `[provisionRclone] attempt ${attempt}/${maxCopyRetries} failed to copy:`,
                copyError
            )

            if (attempt < maxCopyRetries) {
                const waitTime = attempt * 1000
                console.log(`[provisionRclone] waiting ${waitTime}ms before retry`)
                // Wait a bit before retrying
                await new Promise((resolve) => setTimeout(resolve, waitTime))
            } else {
                console.error('[provisionRclone] all copy attempts failed', copyError)
                Sentry.captureException(copyError, {
                    extra: {
                        rcloneBinaryPath,
                        targetBinaryPath,
                    },
                })
                throw new Error(
                    'Failed to provision rclone, file is busy. Install cli manually or try again later.'
                )
            }
        }
    }

    console.log('[provisionRclone] verifying installation')
    const hasInstalled = await isInternalRcloneInstalled()
    console.log('[provisionRclone] installation verified:', hasInstalled)

    if (!hasInstalled) {
        console.error('[provisionRclone] installation verification failed')
        throw new Error('Failed to install rclone')
    }

    console.log('[provisionRclone] rclone has been installed successfully')

    return true
}

/**
 * Prompts the user for a password for an encrypted configuration
 * @param configLabel - The label of the configuration file
 * @returns Promise<string | null> - The password entered by the user, or null if cancelled
 */
async function promptForConfigPassword(configLabel: string): Promise<string | null> {
    console.log('[promptForConfigPassword] prompting for config:', configLabel)
    try {
        const result = await invoke<string | null>('prompt_password', {
            title: 'Rclone UI',
            message: `Please enter the password for the encrypted configuration "${configLabel}".`,
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
