import { downloadDir } from '@tauri-apps/api/path'
import { confirm } from '@tauri-apps/plugin-dialog'
import { exists, writeFile } from '@tauri-apps/plugin-fs'
import { fetch } from '@tauri-apps/plugin-http'
import { revealItemInDir } from '@tauri-apps/plugin-opener'
import { platform } from '@tauri-apps/plugin-os'
import { exit } from '@tauri-apps/plugin-process'

export async function needsMountPlugin() {
    const currentPlatform = platform()
    if (currentPlatform === 'macos') {
        // check fuse-t or osxfuse
        const hasFuseT = await exists('/Library/Application Support/fuse-t')
        console.log('hasFuseT', hasFuseT)
        const hasOsxFuse = await exists('/Library/Filesystems/macfuse.fs')
        console.log('hasOsxFuse', hasOsxFuse)
        return !hasFuseT && !hasOsxFuse
    }
    if (currentPlatform === 'windows') {
        // check winfsp
        const hasWinFsp =
            (await exists('C:\\Program Files\\WinFsp')) ||
            (await exists('C:\\Program Files (x86)\\WinFsp'))
        console.log('hasWinFsp', hasWinFsp)
        return !hasWinFsp
    }
    return false
}

export async function dialogGetMountPlugin() {
    const currentPlatform = platform()
    if (currentPlatform === 'macos') {
        // download fuse-t or osxfuse
        const wantsDownload = await confirm(
            "Fuse-t is required on macOS to mount remotes. You can open rclone UI again once you're done with the installation.",
            {
                title: 'Mount plugin not installed',
                kind: 'warning',
                okLabel: 'Download',
                cancelLabel: 'Cancel',
            }
        )
        if (wantsDownload) {
            const fuseInstallerUrl =
                'https://github.com/macos-fuse-t/fuse-t/releases/download/1.0.44/fuse-t-macos-installer-1.0.44.pkg'
            const localPath = `${await downloadDir()}/fuse-t-installer.pkg`
            const installer = await (await fetch(fuseInstallerUrl)).arrayBuffer()
            await writeFile(localPath, new Uint8Array(installer))
            await revealItemInDir(localPath)
            return await exit(0)
        }
    }
    if (currentPlatform === 'windows') {
        // download winfsp
        const wantsDownload = await confirm(
            "WinFsp is required on Windows to mount remotes. You can open rclone UI again once you're done with the installation.",
            {
                title: 'Mount plugin not installed',
                kind: 'warning',
                okLabel: 'Download',
                cancelLabel: 'Cancel',
            }
        )
        if (wantsDownload) {
            const winFspInstallerUrl =
                'https://github.com/winfsp/winfsp/releases/download/v2.0/winfsp-2.0.23075.msi'
            const localPath = `${await downloadDir()}/winfsp-installer.msi`
            const installer = await (await fetch(winFspInstallerUrl)).arrayBuffer()
            await writeFile(localPath, new Uint8Array(installer))
            await revealItemInDir(localPath)
            return await exit(0)
        }
    }
}
