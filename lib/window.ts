import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import {
    LogicalSize,
    PhysicalSize,
    availableMonitors,
    currentMonitor,
    getAllWindows,
} from '@tauri-apps/api/window'
import { platform } from '@tauri-apps/plugin-os'
import { useStore } from './store'
import { showDefaultTray, showLoadingTray } from './tray'

export async function resetMainWindow() {
    const window = await getAllWindows().then((w) => w.find((w) => w.label === 'main'))
    if (!window) return

    await window.setSize(new PhysicalSize(0, 0))
    await window.center()
    await window.hide()
    await window.setAlwaysOnTop(true)
}

export async function openFullWindow({
    name,
    url,
}: {
    name: string
    url: string
}) {
    console.log('[openFullWindow] ', name, url)

    const w = new WebviewWindow(name, {
        height: 0,
        width: 0,
        visibleOnAllWorkspaces: false,
        resizable: true,
        visible: false,
        focus: true,
        title: name,
        decorations: true,
        url: url,
        theme: 'dark',
        // @ts-expect-error
        backgroundThrottling: 'disabled',
    })

    let monitor = await currentMonitor()

    if (!monitor) {
        monitor = (await availableMonitors())[0]
    }

    const size = monitor?.size

    if (!size) {
        console.error('[openFullWindow] no monitor found')
        throw new Error('No monitor found')
    }

    if (platform() === 'windows') {
        // subtract from the height to correct for the taskbar
        size.height -= 100
    }

    await w.hide()
    await w.setSize(size)
    await w.center()
    await w.setZoom(1)
    await w.show()
    await w.setFocus()

    if (platform() === 'linux') {
        await w.setResizable(false)
        await w.setResizable(true)
    }

    return w
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

    const isFirstWindow = useStore.getState().firstWindow

    const w = new WebviewWindow(name, {
        height: 0,
        width: 0,
        resizable: false,
        visibleOnAllWorkspaces: false,
        visible: false,
        focus: true,
        title: name,
        decorations: false,
        url: url,
        theme: 'dark',
        // @ts-expect-error
        backgroundThrottling: 'disabled',
    })

    await showLoadingTray()
    await new Promise((resolve) => setTimeout(resolve, isFirstWindow ? 900 : 150))
    await showDefaultTray()

    // await w.hide()
    await w.setSize(new LogicalSize(width, height))
    await w.center()
    await w.setDecorations(true)
    await w.setZoom(1)
    await w.show()
    await w.setFocus()

    useStore.setState({ firstWindow: false })

    if (platform() === 'linux') {
        await w.setResizable(false)
        await w.setResizable(true)
    }

    return w
}

export async function openSmallWindow({
    name,
    url,
}: {
    name: string
    url: string
}) {
    console.log('[openSmallWindow] ', name, url)

    const isFirstWindow = useStore.getState().firstWindow

    const w = new WebviewWindow(name, {
        height: 0,
        width: 0,
        resizable: false,
        visibleOnAllWorkspaces: false,
        visible: false,
        focus: true,
        title: name,
        decorations: false,
        url: url,
        theme: 'dark',
        closable: false,
        // @ts-expect-error
        backgroundThrottling: 'disabled',
    })

    await new Promise((resolve) => setTimeout(resolve, isFirstWindow ? 900 : 150))

    await w.setSize(new LogicalSize(800, 500))
    await w.center()
    await w.setZoom(1)
    await w.show()
    await w.setFocus()

    useStore.setState({ firstWindow: false })

    if (platform() === 'linux') {
        await w.setResizable(false)
        await w.setResizable(true)
    }

    return w
}

export async function lockWindows(ids?: string[]) {
    const windows = await getAllWindows()
    const lockedWindows = ids ? windows.filter((w) => ids.includes(w.label)) : windows
    await Promise.all(lockedWindows.map((w) => w.setClosable(false)))
}

export async function unlockWindows(ids?: string[]) {
    const windows = await getAllWindows()
    const unlockedWindows = ids ? windows.filter((w) => ids.includes(w.label)) : windows
    await Promise.all(unlockedWindows.map((w) => w.setClosable(true)))
}
