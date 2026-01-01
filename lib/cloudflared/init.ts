import * as Sentry from '@sentry/browser'
import { invoke } from '@tauri-apps/api/core'
import { appLocalDataDir, sep, tempDir } from '@tauri-apps/api/path'
import { BaseDirectory } from '@tauri-apps/api/path'
import { message } from '@tauri-apps/plugin-dialog'
import { copyFile, exists, mkdir, remove, writeFile } from '@tauri-apps/plugin-fs'
import { fetch } from '@tauri-apps/plugin-http'
import { platform } from '@tauri-apps/plugin-os'

/**
 * Downloads and provisions cloudflared for the current platform
 * @throws {Error} If architecture detection fails or installation is unsuccessful
 * @returns {Promise<boolean>}
 */
export async function provisionCloudflared(): Promise<boolean> {
    console.log('[provisionCloudflared]')

    const currentPlatform = platform()
    console.log('[provisionCloudflared] currentPlatform', currentPlatform)

    const currentOs = currentPlatform === 'macos' ? 'darwin' : currentPlatform
    console.log('[provisionCloudflared] currentOs', currentOs)

    let tempDirPath = await tempDir()
    if (tempDirPath.endsWith(sep())) {
        tempDirPath = tempDirPath.slice(0, -1)
    }
    console.log('[provisionCloudflared] tempDirPath', tempDirPath)

    const arch = (await invoke('get_arch')) as 'arm64' | 'amd64' | '386' | 'unknown'
    console.log('[provisionCloudflared] arch', arch)

    if (arch === 'unknown') {
        console.error('[provisionCloudflared] failed to get architecture')
        await message('Failed to get current arch, please try again later.')
        return false
    }

    // Cloudflared binary names by platform
    let downloadUrl: string
    let binaryName: string
    let needsExtraction = false

    if (currentOs === 'darwin') {
        // macOS uses .tgz archives
        binaryName = 'cloudflared'
        const archName = arch === 'arm64' ? 'arm64' : 'amd64'
        downloadUrl = `https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-${archName}.tgz`
        needsExtraction = true
    } else if (currentOs === 'windows') {
        // Windows uses .exe
        binaryName = 'cloudflared.exe'
        const archName = arch === 'amd64' ? 'amd64' : '386'
        downloadUrl = `https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-${archName}.exe`
    } else {
        // Linux uses direct binary
        binaryName = 'cloudflared'
        const archName = arch === 'arm64' ? 'arm64' : 'amd64'
        downloadUrl = `https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${archName}`
    }

    console.log('[provisionCloudflared] downloadUrl', downloadUrl)

    try {
        const downloadedFile = await fetch(downloadUrl).then((res) => res.arrayBuffer())
        console.log('[provisionCloudflared] downloadedFile')

        let tempDirExists = false
        try {
            tempDirExists = await exists('cloudflared', {
                baseDir: BaseDirectory.Temp,
            })
            console.log('[provisionCloudflared] tempDirExists', tempDirExists)
        } catch (error) {
            Sentry.captureException(error)
            console.error(
                '[provisionCloudflared] failed to check if cloudflared temp dir exists',
                error
            )
        }

        if (tempDirExists) {
            try {
                await remove('cloudflared', {
                    recursive: true,
                    baseDir: BaseDirectory.Temp,
                })
                console.log('[provisionCloudflared] removed cloudflared temp dir')
            } catch (error) {
                Sentry.captureException(error)
                console.error('[provisionCloudflared] failed to remove cloudflared temp dir', error)
                await message('Failed to provision cloudflared.')
                return false
            }
        }

        try {
            await mkdir('cloudflared', {
                baseDir: BaseDirectory.Temp,
            })
            console.log('[provisionCloudflared] created cloudflared temp dir')
        } catch (error) {
            Sentry.captureException(error)
            console.error('[provisionCloudflared] failed to create cloudflared temp dir', error)
            await message('Failed to provision cloudflared.')
            return false
        }

        const fileName = needsExtraction ? 'cloudflared.tgz' : binaryName
        const filePath = [tempDirPath, 'cloudflared', fileName].join(sep())
        console.log('[provisionCloudflared] filePath', filePath)

        try {
            await writeFile(filePath, new Uint8Array(downloadedFile))
            console.log('[provisionCloudflared] wrote file')
        } catch (error) {
            Sentry.captureException(error)
            console.error('[provisionCloudflared] failed to write file', error)
            await message('Failed to provision cloudflared.')
            return false
        }

        let binaryPath = filePath

        // Extract if needed (macOS .tgz)
        if (needsExtraction) {
            try {
                await invoke('extract_tgz', {
                    tgzPath: filePath,
                    outputFolder: `${tempDirPath}${sep()}cloudflared${sep()}extracted`,
                })
                console.log('[provisionCloudflared] successfully extracted file')
                binaryPath = [tempDirPath, 'cloudflared', 'extracted', 'cloudflared'].join(sep())
            } catch (error) {
                Sentry.captureException(error)
                console.error('[provisionCloudflared] failed to extract file', error)
                await message('Failed to provision cloudflared.')
                return false
            }
        }

        console.log('[provisionCloudflared] binaryPath', binaryPath)

        try {
            const binaryExists = await exists(binaryPath)
            console.log('[provisionCloudflared] binaryExists', binaryExists)
            if (!binaryExists) {
                throw new Error('Could not find cloudflared binary')
            }
        } catch (error) {
            Sentry.captureException(error)
            console.error(
                '[provisionCloudflared] failed to check if cloudflared binary exists',
                error
            )
            await message('Failed to provision cloudflared.')
            return false
        }

        const appLocalDataDirPath = await appLocalDataDir()
        console.log('[provisionCloudflared] appLocalDataDirPath', appLocalDataDirPath)

        const appLocalDataDirPathExists = await exists(appLocalDataDirPath)
        console.log('[provisionCloudflared] appLocalDataDirPathExists', appLocalDataDirPathExists)

        if (!appLocalDataDirPathExists) {
            await mkdir(appLocalDataDirPath, {
                recursive: true,
            })
            console.log('[provisionCloudflared] appLocalDataDirPath created')
        }

        await copyFile(binaryPath, `${appLocalDataDirPath}${sep()}${binaryName}`)
        console.log('[provisionCloudflared] copied cloudflared binary')

        console.log('[provisionCloudflared] cloudflared has been installed')

        return true
    } catch (error) {
        Sentry.captureException(error)
        console.error('[provisionCloudflared] failed to provision cloudflared', error)
        await message('Failed to download cloudflared. Please check your internet connection.')
        return false
    }
}
