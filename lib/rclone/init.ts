import { invoke } from '@tauri-apps/api/core'
import { BaseDirectory, appLocalDataDir } from '@tauri-apps/api/path'
import { tempDir } from '@tauri-apps/api/path'
import { message } from '@tauri-apps/plugin-dialog'
import { copyFile, exists, mkdir, remove } from '@tauri-apps/plugin-fs'
import { writeFile } from '@tauri-apps/plugin-fs'
import { fetch } from '@tauri-apps/plugin-http'
import { platform } from '@tauri-apps/plugin-os'
import { Command } from '@tauri-apps/plugin-shell'

export async function initRclone() {
    const system = await isSystemRcloneInstalled()
    let internal = await isInternalRcloneInstalled()

    // rclone not available, let's download it
    if (!system && !internal) {
        await provisionRclone()
        internal = true
    }

    return {
        system: system
            ? async (args: string[]) => {
                  console.log('running system rclone')
                  return Command.create('rclone-system', args)
              }
            : null,
        internal: internal
            ? async (args: string[]) => {
                  console.log('running internal rclone')
                  return Command.create('rclone-internal', args)
              }
            : null,
    }
}

/**
 * Checks if rclone is installed and accessible from the system PATH
 * @returns {Promise<boolean>} True if rclone is installed and working
 */
export async function isSystemRcloneInstalled() {
    try {
        const output = await Command.create('rclone-system').execute()
        // console.log('[isSystemRcloneInstalled] output', output)
        return (
            output.stdout.includes('Available commands') ||
            output.stderr.includes('Available commands')
        )
    } catch (_) {
        return false
    }
}

/**
 * Checks if rclone is downloaded by the application in the app's local data directory
 * @returns {Promise<boolean>} True if downloaded rclone is present and working
 */
export async function isInternalRcloneInstalled() {
    try {
        const output = await Command.create('rclone-internal').execute()
        // console.log('[isInternalRcloneInstalled] output', output)
        return (
            output.stdout.includes('Available commands') ||
            output.stderr.includes('Available commands')
        )
    } catch (_) {
        return false
    }
}

/**
 * Downloads and provisions the latest version of rclone for the current platform
 * @throws {Error} If architecture detection fails or installation is unsuccessful
 * @returns {Promise<void>}
 */
export async function provisionRclone() {
    const currentVersionString = await fetch('https://downloads.rclone.org/version.txt').then(
        (res) => res.text()
    )
    console.log('currentVersionString', currentVersionString)

    const currentVersion = currentVersionString.split('v')?.[1]?.trim()

    if (!currentVersion) {
        console.error('Failed to get latest version')
        return
    }
    console.log('currentVersion', currentVersion)

    const currentPlatform = platform()
    console.log('currentPlatform', currentPlatform)

    const currentOs = currentPlatform === 'macos' ? 'osx' : currentPlatform
    console.log('currentOs', currentOs)

    let tempDirPath = await tempDir()
    if (tempDirPath.endsWith('/')) {
        tempDirPath = tempDirPath.slice(0, -1)
    }
    console.log('tempDirPath', tempDirPath)

    const arch = (await invoke('get_arch')) as 'arm64' | 'amd64' | '386' | 'unknown'
    console.log('arch', arch)

    if (arch === 'unknown') {
        throw new Error('Failed to get architecture, please try again later.')
    }

    const downloadUrl = `https://downloads.rclone.org/v${currentVersion}/rclone-v${currentVersion}-${currentOs}-${arch}.zip`
    console.log('downloadUrl', downloadUrl)

    const downloadedFile = await fetch(downloadUrl).then((res) => res.arrayBuffer())
    console.log('downloadedFile')

    let tempDirExists
    try {
        tempDirExists = await exists('rclone', {
            baseDir: BaseDirectory.Temp,
        })
        console.log('tempDirExists', tempDirExists)
    } catch (error) {
        console.error('Failed to check if rclone temp dir exists', error)
    }

    if (tempDirExists) {
        try {
            await remove('rclone', {
                recursive: true,
                baseDir: BaseDirectory.Temp,
            })
            console.log('removed rclone temp dir')
        } catch (error) {
            console.error('Failed to remove rclone temp dir', error)
            await message('Failed to provision rclone.')
            return
        }
    }

    try {
        await mkdir('rclone', {
            baseDir: BaseDirectory.Temp,
        })
        console.log('created rclone temp dir')
    } catch (error) {
        console.error('Failed to create rclone temp dir', error)
        await message('Failed to provision rclone.')
        return
    }

    const zipPath = `${tempDirPath}/rclone/rclone-v${currentVersion}-${currentOs}-${arch}.zip`
    console.log('zipPath', zipPath)

    try {
        await writeFile(zipPath, new Uint8Array(downloadedFile))
        console.log('wrote zip file')
    } catch (error) {
        console.error('Failed to write zip file', error)
        await message('Failed to provision rclone.')
        return
    }

    try {
        await invoke('unzip_file', {
            zipPath,
            outputFolder: `${tempDirPath}/rclone/rclone-ui`,
        })
        console.log('Successfully unzipped file')
    } catch (error) {
        console.error('Failed to unzip file', error)
        await message('Failed to provision rclone.')
        return
    }

    const unarchivedPath = `${tempDirPath}/rclone/rclone-ui/rclone-v${currentVersion}-${currentOs}-${arch}`
    console.log('unarchivedPath', unarchivedPath)

    const rcloneBinaryPath = unarchivedPath + '/' + 'rclone'
    console.log('rcloneBinaryPath', rcloneBinaryPath)

    if (!(await exists(rcloneBinaryPath))) {
        throw new Error('Could not find rclone binary in zip')
    }

    const appLocalDataDirPath = await appLocalDataDir()
    console.log('appLocalDataDirPath', appLocalDataDirPath)

    const appLocalDataDirPathExists = await exists(appLocalDataDirPath)
    console.log('appLocalDataDirPathExists', appLocalDataDirPathExists)

    if (!appLocalDataDirPathExists) {
        await mkdir(appLocalDataDirPath, {
            recursive: true,
        })
        console.log('appLocalDataDirPath created')
    }

    await copyFile(rcloneBinaryPath, `${appLocalDataDirPath}/rclone`)
    console.log('copied rclone binary')

    const hasInstalled = await isInternalRcloneInstalled()

    if (!hasInstalled) {
        throw new Error('Failed to install rclone')
    }

    console.log('rclone has been installed')
}
