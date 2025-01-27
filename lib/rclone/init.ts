import { invoke } from '@tauri-apps/api/core'
import { BaseDirectory, appLocalDataDir } from '@tauri-apps/api/path'
import { tempDir } from '@tauri-apps/api/path'
import { copyFile, mkdir, remove } from '@tauri-apps/plugin-fs'
import { writeFile } from '@tauri-apps/plugin-fs'
import { fetch } from '@tauri-apps/plugin-http'
import { platform } from '@tauri-apps/plugin-os'
import { Command } from '@tauri-apps/plugin-shell'

export async function init() {
    const system = await isSystemRcloneInstalled()
    let internal = await isInternalRcloneInstalled()
    const sidecar = await isSidecarRcloneInstalled()

    // rclone not available, let's download it
    if (!(system || internal || sidecar)) {
        await provisionRclone()
        internal = true
    }

    return {
        system: system
            ? async (args: string[]) => {
                console.log('running system rclone')
                return Command.create("rclone-system", args)
            }
            : null,
        internal: internal
            ? async (args: string[]) => {
                console.log('running internal rclone')
                return Command.create("rclone-internal", args, {
                  cwd: `${await appLocalDataDir()}`,
                })
            }
            : null,
        sidecar: sidecar
            ? async (args: string[]) => {
                console.log('running sidecar rclone')
                return Command.sidecar("binaries/rclone", args)
            }
            : null,
    };
}

/**
 * Checks if rclone is installed and accessible from the system PATH
 * @returns {Promise<boolean>} True if rclone is installed and working
 */
export async function isSystemRcloneInstalled() {
    try {
        const output = await Command.create('rclone-system').execute()
        // console.log('[checkRcloneInstalled] output', output)
        return (
            output.stdout.includes('Available commands') || output.stderr.includes('Available commands')
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
        const output = await Command.create('rclone-internal', [], {
            cwd: `${await appLocalDataDir()}`,
        }).execute()
        // console.log('[checkRcloneBundled] output', output)
        return (
            output.stdout.includes('Available commands') || output.stderr.includes('Available commands')
        )
    } catch (_) {
        return false
    }
}

/**
 * Checks if rclone is available as a sidecar
 * @returns {Promise<boolean>} True if sidecar rclone is present and working
 */
export async function isSidecarRcloneInstalled() {
    try {
        const output = await Command.sidecar('binaries/rclone').execute()
        // console.log('[checkRcloneBundled] output', output)
        return (
            output.stdout.includes('Available commands') || output.stderr.includes('Available commands')
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

    const currentOs =
        currentPlatform === 'macos' ? 'osx' : currentPlatform === 'windows' ? 'win' : 'linux'
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

    await remove('rclone', {
        recursive: true,
        baseDir: BaseDirectory.Temp,
    })

    await mkdir('rclone', {
        baseDir: BaseDirectory.Temp,
    })

    const zipPath = `${tempDirPath}/rclone/rclone-v${currentVersion}-${currentOs}-${arch}.zip`
    console.log('zipPath', zipPath)

    await writeFile(zipPath, new Uint8Array(downloadedFile))

    await invoke('unzip_file', {
        zipPath,
        outputFolder: `${tempDirPath}/rclone/rclone-ui`,
    })

    console.log('Successfully unzipped file')

    const unarchivedPath = `${tempDirPath}/rclone/rclone-ui/rclone-v${currentVersion}-${currentOs}-${arch}`
    console.log('unarchivedPath', unarchivedPath)

    // const unarchivedFolder = await readDir(unarchivedPath)
    // console.log('unarchivedFolder', unarchivedFolder)

    const rcloneBinaryPath = unarchivedPath + '/' + 'rclone'
    console.log('rcloneBinaryPath', rcloneBinaryPath)

    if (!rcloneBinaryPath) {
        throw new Error('Could not find rclone binary in zip')
    }

    await copyFile(rcloneBinaryPath, `${await appLocalDataDir()}/rclone`)

    const hasInstalled = await isInternalRcloneInstalled();

    if (!hasInstalled) {
        throw new Error('Failed to install rclone')
    }
}
