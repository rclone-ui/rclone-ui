import * as Sentry from '@sentry/browser'
import { invoke } from '@tauri-apps/api/core'
import { Menu, MenuItem, PredefinedMenuItem } from '@tauri-apps/api/menu'
import { resolveResource } from '@tauri-apps/api/path'
import { TrayIcon, type TrayIconEvent } from '@tauri-apps/api/tray'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { ask, message } from '@tauri-apps/plugin-dialog'
import { openUrl } from '@tauri-apps/plugin-opener'
import { platform } from '@tauri-apps/plugin-os'
import { exit } from '@tauri-apps/plugin-process'
import { usePersistedStore } from '../store/persisted'
import { openSmallWindow, openWindow } from './window'

async function buildMenu() {
    console.log('[buildMenu]')

    const menuItems: (MenuItem | PredefinedMenuItem)[] = []

    const onboardingMenuItem = await MenuItem.new({
        id: 'onboarding',
        text: 'Onboarding',
        action: async () => {
            await openSmallWindow({
                name: 'Onboarding',
                url: '/onboarding',
            })
        },
    })
    menuItems.push(onboardingMenuItem)

    const openMenuItem = await MenuItem.new({
        id: 'open',
        text: 'Open',
        action: async () => {
            await invoke('show_toolbar')
        },
    })
    menuItems.push(openMenuItem)

    await PredefinedMenuItem.new({
        item: 'Separator',
    }).then((item) => {
        menuItems.push(item)
    })

    const transfersMenuItem = await MenuItem.new({
        id: 'transfers',
        text: 'Transfers',
        action: async () => {
            await openWindow({
                name: 'Transfers',
                url: '/transfers',
            })
        },
    })
    menuItems.push(transfersMenuItem)

    const schedulesMenuItem = await MenuItem.new({
        id: 'schedules',
        text: 'Schedules',
        action: async () => {
            await openWindow({
                name: 'Schedules',
                url: '/schedules',
            })
        },
    })
    menuItems.push(schedulesMenuItem)

    const templatesMenuItem = await MenuItem.new({
        id: 'templates',
        text: 'Templates',
        action: async () => {
            await openWindow({
                name: 'Templates',
                url: '/templates',
            })
        },
    })
    menuItems.push(templatesMenuItem)

    await PredefinedMenuItem.new({
        item: 'Separator',
    }).then((item) => {
        menuItems.push(item)
    })

    const settingsItem = await MenuItem.new({
        id: 'settings',
        text: 'Settings',
        action: async () => {
            await openWindow({
                name: 'Settings',
                url: '/settings',
            })
        },
    })
    menuItems.push(settingsItem)

    const issuesItem = await MenuItem.new({
        id: 'issues',
        text: 'Issues?',
        action: async () => {
            const confirmed = await ask(
                'Please open an issue on Github and we will get it sorted in less than 48 hours, no matter if you have a license or not.',
                {
                    title: 'Sorry ):',
                    kind: 'info',
                    okLabel: 'Open Github',
                    cancelLabel: 'Cancel',
                }
            )
            if (confirmed) {
                await openUrl('https://github.com/rclone-ui/rclone-ui/issues')
            }
        },
    })
    menuItems.push(issuesItem)

    const quitItem = await MenuItem.new({
        id: 'quit',
        text: 'Quit',
        action: async () => {
            await getCurrentWindow().emit('close-app')
        },
    })
    menuItems.push(quitItem)

    return await Menu.new({
        id: 'main-menu',
        items: menuItems,
    })
}

async function resolveTrayIconForTheme() {
    console.log('[resolveTrayIconForTheme]')

    const existingTheme = usePersistedStore.getState().appearance
    console.log('[resolveTrayIconForTheme] existingTheme', existingTheme)

    const isLinux = platform() === 'linux'

    if (existingTheme.tray === 'system') {
        if (platform() === 'macos') {
            return await resolveResource('icons/favicon/icon.png')
        }

        try {
            const currentWindow = getCurrentWindow()
            const windowTheme = await currentWindow.theme()
            console.log('[resolveTrayIconForTheme] windowTheme', windowTheme)

            const pickedPath =
                windowTheme === 'dark'
                    ? `icons/favicon/icon${isLinux ? '-xs' : ''}.png`
                    : `icons/favicon/icon-light${isLinux ? '-xs' : ''}.png`

            return await resolveResource(pickedPath)
        } catch {
            await message('Failed to get window theme', {
                title: 'Error',
                kind: 'error',
            })
            await new Promise((resolve) => setTimeout(resolve, 5000))
            await exit()
        }
    }

    const pickedPath =
        existingTheme.tray === 'dark'
            ? `icons/favicon/icon-light${isLinux ? '-xs' : ''}.png`
            : `icons/favicon/icon${isLinux ? '-xs' : ''}.png`

    return await resolveResource(pickedPath)
}

export async function initTray() {
    console.log('[initTray] platform', platform())

    try {
        console.log('[initTray]')

        await TrayIcon.new({
            id: 'rclone-menu5',
            menu: await buildMenu(),
            icon: await resolveTrayIconForTheme(),
            tooltip: 'Rclone',
            menuOnLeftClick: true,
            iconAsTemplate: true,
            action: async (event: TrayIconEvent) => {
                if (event.type === 'Click') {
                    console.log('[onTrayAction] tray clicked:', event)
                }
            },
        })
    } catch (error) {
        Sentry.captureException(error)
        console.error('[initTray] failed to create tray')
        console.error(error)
    }
}
