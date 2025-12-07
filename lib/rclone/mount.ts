import { downloadDir } from '@tauri-apps/api/path'
import { ask } from '@tauri-apps/plugin-dialog'
import { exists, writeFile } from '@tauri-apps/plugin-fs'
import { fetch } from '@tauri-apps/plugin-http'
import { revealItemInDir } from '@tauri-apps/plugin-opener'
import { platform } from '@tauri-apps/plugin-os'

export async function needsMountPlugin() {
    console.log('[needsMountPlugin]')

    const currentPlatform = platform()
    if (currentPlatform === 'macos') {
        // check fuse-t or osxfuse
        const hasFuseT = await exists('/Library/Application Support/fuse-t')
        console.log('[needsMountPlugin] hasFuseT', hasFuseT)
        const hasOsxFuse = await exists('/Library/Filesystems/macfuse.fs')
        console.log('[needsMountPlugin] hasOsxFuse', hasOsxFuse)
        return !hasFuseT && !hasOsxFuse
    }
    if (currentPlatform === 'windows') {
        // check winfsp
        const hasWinFsp =
            (await exists('C:\\Program Files\\WinFsp')) ||
            (await exists('C:\\Program Files (x86)\\WinFsp'))
        console.log('[needsMountPlugin] hasWinFsp', hasWinFsp)
        return !hasWinFsp
    }
    return false
}

export async function dialogGetMountPlugin() {
    console.log('[dialogGetMountPlugin]')

    const currentPlatform = platform()
    if (currentPlatform === 'macos') {
        // download fuse-t or osxfuse
        const wantsDownload = await ask(
            "Fuse-t is required on macOS to mount remotes. You can continue the operation once you're done with the installation.",
            {
                title: 'Fuse-t not installed',
                kind: 'warning',
                okLabel: 'Download',
                cancelLabel: 'Cancel',
            }
        )
        if (wantsDownload) {
            const fuseInstallerUrl =
                'https://github.com/macos-fuse-t/fuse-t/releases/download/1.0.49/fuse-t-macos-installer-1.0.49.pkg'
            const localPath = `${await downloadDir()}/fuse-t-installer.pkg`
            const installer = await (await fetch(fuseInstallerUrl)).arrayBuffer()
            await writeFile(localPath, new Uint8Array(installer))
            await revealItemInDir(localPath)
        }
    }
    if (currentPlatform === 'windows') {
        // download winfsp
        const wantsDownload = await ask(
            'WinFsp is required on Windows to mount remotes. You can continue the operation once you\'re done with the installation.\n\nIf you still see this message, download the WinFsp installer from Github and make sure you toggle "FUSE for Cygwin" during the installation process.',
            {
                title: 'WinFsp not installed',
                kind: 'warning',
                okLabel: 'Download',
                cancelLabel: 'Cancel',
            }
        )
        if (wantsDownload) {
            const winFspInstallerUrl =
                'https://github.com/winfsp/winfsp/releases/download/v2.1/winfsp-2.1.25156.msi'
            const localPath = `${await downloadDir()}/winfsp-installer.msi`
            const installer = await (await fetch(winFspInstallerUrl)).arrayBuffer()
            await writeFile(localPath, new Uint8Array(installer))
            await revealItemInDir(localPath)
        }
    }
}
