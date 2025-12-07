import { invoke } from '@tauri-apps/api/core'
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { platform } from '@tauri-apps/plugin-os'

export async function openFullWindow({
    name,
    url,
}: {
    name: string
    url: string
}) {
    console.log('[openFullWindow] ', name, url)
    await invoke('open_full_window', { name, url })
    return WebviewWindow.getByLabel(name)
}

export async function openWindow({
    name,
    url,
    width = 840,
    height = platform() === 'windows' ? 755 : 725,
}: {
    name: string
    url: string
    width?: number
    height?: number
}) {
    console.log('[openWindow] ', name, url)
    await invoke('open_window', { name, url, width, height })
    return WebviewWindow.getByLabel(name)
}

export async function openSmallWindow({
    name,
    url,
}: {
    name: string
    url: string
}) {
    console.log('[openSmallWindow] ', name, url)
    await invoke('open_small_window', { name, url })
    return WebviewWindow.getByLabel(name)
}

export async function lockWindows(ids?: string[]) {
    await invoke('lock_windows', { ids: ids ?? null })
}

export async function unlockWindows(ids?: string[]) {
    await invoke('unlock_windows', { ids: ids ?? null })
}
