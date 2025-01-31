import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { LogicalSize, PhysicalPosition, PhysicalSize, currentMonitor, getAllWindows } from '@tauri-apps/api/window'
import { Position, moveWindow } from '@tauri-apps/plugin-positioner'
import { getTrayRect } from './tray'

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
    const w = new WebviewWindow(name, {
        height: 0,
        width: 0,
        visibleOnAllWorkspaces: false,
        alwaysOnTop: false,
        resizable: true,
        visible: true,
        focus: true,
        title: name,
        decorations: true,
        url: url,
    })

    const size = await currentMonitor().then((m) => m?.size)

    if (!size) return

    await w.hide()
    await w.setSize(size)
    await w.center()
    await w.show()

    return w
}

export async function openWindow({
    name,
    url,
    width = 740,
    height = 600,
}: {
    name: string
    url: string
    width?: number
    height?: number
}) {
    const w = new WebviewWindow(name, {
        height: 0,
        width: 0,
        resizable: false,
        visibleOnAllWorkspaces: false,
        alwaysOnTop: true,
        visible: true,
        focus: true,
        title: name,
        decorations: true,
        url: url,
        // parent: 'main',
    })

    await new Promise((resolve) => setTimeout(resolve, 1000))

    await w.hide()
    await w.setSize(new LogicalSize(width, height))
    await w.center()
    await w.show()

    return w
}

export async function openTrayWindow({
    name,
    url,
}: {
    name: string
    url: string
}) {
    const w = new WebviewWindow(name, {
        height: 0,
        width: 0,
        resizable: false,
        visibleOnAllWorkspaces: true,
        alwaysOnTop: true,
        visible: true,
        focus: true,
        title: name,
        decorations: false,
        url: url,
    })

    // await getAllWindows()
    //     .then((w) => w.find((w) => w.label === 'main'))
    //     ?.then((w) => w?.setSize(new LogicalSize(400, 600)))

    await new Promise((resolve) => setTimeout(resolve, 1500))

    await w.hide()
		const windowSize = new LogicalSize(400, 600)
		await w.setSize(windowSize)
		const trayRect = getTrayRect()
		const windowPhysicalSize = windowSize.toPhysical(await w.scaleFactor())
		await w.setPosition(
			new PhysicalPosition(
				trayRect.position.x +
					trayRect.size.width / 2 -
					windowPhysicalSize.width / 2,
				trayRect.position.y
			)
		)
		await w.show()

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
