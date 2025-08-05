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
    console.log('[isSystemRcloneInstalled]')

    try {
        const output = await Command.create('rclone-system').execute()
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
    console.log('[isInternalRcloneInstalled]')

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
    if (tempDirPath.endsWith('/') || tempDirPath.endsWith('\\')) {
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

    let tempDirExists
    try {
        tempDirExists = await exists('rclone', {
            baseDir: BaseDirectory.Temp,
        })
        console.log('[provisionRclone] tempDirExists', tempDirExists)
    } catch (error) {
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
        console.error('[provisionRclone] failed to create rclone temp dir', error)
        await message('Failed to provision rclone.')
        return
    }

    const zipPath = `${tempDirPath}/rclone/rclone-v${currentVersion}-${currentOs}-${arch}.zip`
    console.log('[provisionRclone] zipPath', zipPath)

    try {
        await writeFile(zipPath, new Uint8Array(downloadedFile))
        console.log('[provisionRclone] wrote zip file')
    } catch (error) {
        console.error('[provisionRclone] failed to write zip file', error)
        await message('Failed to provision rclone.')
        return
    }

    try {
        await invoke('unzip_file', {
            zipPath,
            outputFolder: `${tempDirPath}/rclone/rclone-ui`,
        })
        console.log('[provisionRclone] successfully unzipped file')
    } catch (error) {
        console.error('[provisionRclone] failed to unzip file', error)
        await message('Failed to provision rclone.')
        return
    }

    const unarchivedPath = `${tempDirPath}/rclone/rclone-ui/rclone-v${currentVersion}-${currentOs}-${arch}`
    console.log('[provisionRclone] unarchivedPath', unarchivedPath)

    const binaryName = currentPlatform === 'windows' ? 'rclone.exe' : 'rclone'

    // "/" here looks to be working on windows
    const rcloneBinaryPath = unarchivedPath + '/' + binaryName
    console.log('[provisionRclone] rcloneBinaryPath', rcloneBinaryPath)

    try {
        const binaryExists = await exists(rcloneBinaryPath)
        console.log('[provisionRclone] rcloneBinaryPathExists', binaryExists)
        if (!binaryExists) {
            throw new Error('Could not find rclone binary in zip')
        }
    } catch (error) {
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

    await copyFile(rcloneBinaryPath, `${appLocalDataDirPath}/${binaryName}`)
    console.log('[provisionRclone] copied rclone binary')

    const hasInstalled = await isInternalRcloneInstalled()

    if (!hasInstalled) {
        throw new Error('Failed to install rclone')
    }

    console.log('[provisionRclone] rclone has been installed')

}
