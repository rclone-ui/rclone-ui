import * as Sentry from '@sentry/browser'
import { Menu } from '@tauri-apps/api/menu'
import { MenuItem } from '@tauri-apps/api/menu'
import { resolveResource } from '@tauri-apps/api/path'
import type { TrayIconEvent } from '@tauri-apps/api/tray'
import { TrayIcon } from '@tauri-apps/api/tray'
import { getAllWindows, getCurrentWindow } from '@tauri-apps/api/window'
import { ask } from '@tauri-apps/plugin-dialog'
import { platform } from '@tauri-apps/plugin-os'
import { buildMenu } from './menu'
import { usePersistedStore } from './store'
import { resetMainWindow } from './window'

export async function triggerTrayRebuild() {
    return getAllWindows().then((windows) => {
        windows.find((w) => w.label === 'main')?.emit('rebuild-tray')
    })
}

let interval: NodeJS.Timeout | null = null

async function getTray() {
    return await TrayIcon.getById('main-tray')
}

async function resolveTrayIconForTheme() {
    console.log('[resolveTrayIconForTheme]')

    const existingTheme = usePersistedStore.getState().themeV2
    console.log('[resolveTrayIconForTheme] existingTheme', existingTheme)

    // if ('tray' in existingTheme && existingTheme.tray) {
    //     return existingTheme.tray === 'dark'
    //         ? 'icons/favicon/icon.png'
    //         : 'icons/favicon/icon-light.png'
    // }

    let theme: 'light' | 'dark' = 'dark'

    if (platform() === 'windows') {
        try {
            const currentWindow = getCurrentWindow()
            const windowTheme = await currentWindow.theme()

            theme = windowTheme === 'dark' ? 'dark' : 'light'
        } catch {}
    } else if (platform() !== 'macos') {
        const answer = await ask(
            'Based on your tray/menubar, how do you want the icon to look?\n\nIf your menubar has a dark background select light, otherwise select dark.',
            {
                title: 'Greetings, Linux User',
                okLabel: 'Dark',
                cancelLabel: 'Light',
            }
        )

        if (answer) {
            theme = 'dark'
        } else {
            theme = 'light'
        }
    }

    console.log('[resolveTrayIconForTheme] theme', theme)

    // usePersistedStore.setState({ themeV2: { tray: theme } })

    const pickedPath = theme === 'dark' ? 'icons/favicon/icon.png' : 'icons/favicon/icon-light.png'
    console.log('[resolveTrayIconForTheme] pickedPath', pickedPath)

    return await resolveResource(pickedPath)
}

export async function showLoadingTray() {
    console.log('[showLoadingTray]')

    if (platform() === 'linux') {
        console.log('[showLoadingTray] platform is linux, skipping')
        return
    }

    const tray = await getTray()
    if (!tray) {
        console.error('[showLoadingTray] tray not found')
        return
    }

    const globeIconPath = await resolveResource('icons/favicon/frame_00_delay-0.1s.png')

    const quitItem = await MenuItem.new({
        id: 'quit-loading',
        text: 'Quit',
        action: async () => {
            const answer = await ask('An operation is in progress, are you sure you want to exit?')
            if (answer) {
                await getCurrentWindow().emit('close-app')
            }
        },
    })

    const loadingMenu = await Menu.new({
        id: 'loading-menu',
        items: [quitItem],
    })

    await tray.setMenu(loadingMenu)
    await tray.setIcon(globeIconPath)
    await tray.setTooltip('Loading...')

    let currentIcon = 1

    interval = setInterval(async () => {
        if (currentIcon > 17) {
            currentIcon = 1
        }
        const globeIconPath = await resolveResource(
            `icons/favicon/frame_${currentIcon < 10 ? '0' : ''}${currentIcon}_delay-0.1s.png`
        )
        await tray?.setIcon(globeIconPath)
        currentIcon += 1
    }, 200)
}

export async function showDefaultTray() {
    console.log('[showDefaultTray]')

    const tray = await getTray()
    if (!tray) {
        console.error('[showDefaultTray] tray not found')
        return
    }

    if (interval) {
        clearInterval(interval)
        interval = null
    }

    const newMenu = await buildMenu()
    await tray.setMenu(newMenu)

    const iconPath = await resolveTrayIconForTheme()
    await tray.setIcon(iconPath)
    await tray.setTooltip('Rclone')

    console.log('[showDefaultTray] tray menu rebuilt')
}

export async function initTray() {
    console.log('[initTray] platform', platform())

    try {
        console.log('[initTray]')

        const initialIcon = await resolveResource('icons/favicon/icon.png')
        await TrayIcon.new({
            id: 'main-tray',
            icon: initialIcon,
            tooltip: 'Rclone',
            menuOnLeftClick: true,
            action: async (event: TrayIconEvent) => {
                if (event.type === 'Click') {
                    console.log('[onTrayAction] tray clicked:', event)

                    await resetMainWindow()
                }
            },
        })
    } catch (error) {
        Sentry.captureException(error)
        console.error('[initTray] failed to create tray')
        console.error(error)
    }
}
