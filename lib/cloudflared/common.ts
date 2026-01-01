import { appLocalDataDir, sep } from '@tauri-apps/api/path'
import { exists } from '@tauri-apps/plugin-fs'
import { platform } from '@tauri-apps/plugin-os'

/**
 * Checks if cloudflared is installed in the app's local data directory
 */
export async function isCloudflaredInstalled(): Promise<boolean> {
    const currentPlatform = platform()
    const binaryName = currentPlatform === 'windows' ? 'cloudflared.exe' : 'cloudflared'

    const appLocalDataDirPath = await appLocalDataDir()
    const cloudflaredPath = `${appLocalDataDirPath}${sep()}${binaryName}`

    return await exists(cloudflaredPath)
}
