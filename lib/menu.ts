import { Menu, MenuItem, PredefinedMenuItem, Submenu } from '@tauri-apps/api/menu'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { ask, message, open } from '@tauri-apps/plugin-dialog'
import { exists, mkdir, remove } from '@tauri-apps/plugin-fs'
import { isPermissionGranted, requestPermission } from '@tauri-apps/plugin-notification'
import { sendNotification } from '@tauri-apps/plugin-notification'
import { openPath } from '@tauri-apps/plugin-opener'
import { platform } from '@tauri-apps/plugin-os'
import { exit } from '@tauri-apps/plugin-process'
import { isDirectoryEmpty } from './fs'
import { deleteRemote, mountRemote, unmountRemote } from './rclone/api'
import { dialogGetMountPlugin, needsMountPlugin } from './rclone/mount'
import { usePersistedStore, useStore } from './store'
import { getLoadingTray, getMainTray, rebuildTrayMenu } from './tray'
import { lockWindows, openFullWindow, openWindow, unlockWindows } from './window'

async function parseRemotes(remotes: string[]) {
    console.log('[parseRemotes]')

    const storeState = useStore.getState()
    const persistedStoreState = usePersistedStore.getState()

    const parsedRemotes: Record<string, (MenuItem | Submenu | PredefinedMenuItem)[]> = {}

    for (const remote of remotes) {
        const remoteConfig = persistedStoreState.remoteConfigList?.[remote]
        if (remoteConfig?.disabledActions?.includes('tray')) {
            continue
        }

        const submenuItems: (MenuItem | Submenu | PredefinedMenuItem)[] = []

        const alreadyMounted = storeState.mountedRemotes[remote]

        if (alreadyMounted) {
            const unmountMenuItem = await MenuItem.new({
                id: `unmount-${remote}`,
                text: 'Unmount',
                action: async () => {
                    try {
                        const mountPoint = storeState.mountedRemotes[remote]
                        if (!mountPoint) {
                            console.error(`No mount point found for remote ${remote}`)
                            return
                        }
                        await unmountRemote({ mountPoint })
                        delete storeState.mountedRemotes[remote]
                        await rebuildTrayMenu()
                        await message(`Successfully unmounted ${remote} from ${mountPoint}`, {
                            title: 'Success',
                        })
                    } catch (err) {
                        console.error('Unmount operation failed:', err)
                        await message(`Failed to unmount ${remote}: ${err}`, {
                            kind: 'error',
                            title: 'Unmount Error',
                        })
                    }
                },
            })
            submenuItems.push(unmountMenuItem)

            // Add "Show Location" option for mounted remotes
            const mountPoint = storeState.mountedRemotes[remote]
            console.log('Adding Show Location', mountPoint)
            const showLocationItem = await MenuItem.new({
                id: `open-${remote}`,

                text: 'Show Location',
                action: async () => {
                    console.log('Show Location', mountPoint)
                    if (mountPoint) {
                        try {
                            await openPath(mountPoint)
                        } catch (err) {
                            console.error('Error opening path:', err)
                            await message(`Failed to open ${mountPoint} (${err})`, {
                                title: 'Open Error',
                                kind: 'error',
                            })
                        }
                    }
                },
            })
            submenuItems.push(showLocationItem)
        }

        if (!alreadyMounted && !remoteConfig?.disabledActions?.includes('tray-mount')) {
            const mountMenuItem = await MenuItem.new({
                id: `mount-${remote}`,
                text: 'Quick Mount',
                action: async () => {
                    await getMainTray().then((t) => t?.setVisible(false))

                    await getLoadingTray().then((t) => t?.setVisible(true))

                    try {
                        const needsPlugin = await needsMountPlugin()
                        if (needsPlugin) {
                            console.log('Mount plugin not installed')
                            await dialogGetMountPlugin()
                            return
                        }
                        console.log('Mount plugin installed')

                        await lockWindows()

                        console.log('remoteConfig', remoteConfig)

                        let selectedPath = remoteConfig?.defaultMountPoint || null

                        if (!selectedPath) {
                            selectedPath = await open({
                                title: `Select a directory to mount "${remote}"`,
                                multiple: false,
                                directory: true,
                            })
                        }

                        if (!selectedPath) {
                            // await resetMainWindow()
                            return
                        }

                        console.log('selectedPath', selectedPath)

                        let directoryExists: boolean | undefined

                        try {
                            directoryExists = await exists(selectedPath)
                        } catch (err) {
                            console.error('Error checking if directory exists:', err)
                        }
                        console.log('directoryExists', directoryExists)

                        const isPlatformWindows = platform() === 'windows'

                        if (directoryExists) {
                            const isEmpty = await isDirectoryEmpty(selectedPath)
                            if (!isEmpty) {
                                // await resetMainWindow()

                                await message(
                                    'The selected directory must be empty to mount a remote.',
                                    {
                                        title: 'Mount Error',
                                        kind: 'error',
                                    }
                                )

                                return
                            }

                            if (isPlatformWindows) {
                                await remove(selectedPath)
                            }
                        } else if (!isPlatformWindows) {
                            try {
                                await mkdir(selectedPath)
                            } catch (error) {
                                console.error('Error creating directory:', error)
                                await message(
                                    'Failed to create mount directory. Try creating it manually first.',
                                    {
                                        title: 'Mount Error',
                                        kind: 'error',
                                    }
                                )
                                return
                            }
                        }

                        // Mount the remote
                        await mountRemote({
                            remotePath: `${remote}:${remoteConfig?.defaultRemotePath || ''}`,
                            mountPoint: selectedPath,
                            mountOptions: remoteConfig?.mountDefaults,
                            vfsOptions: remoteConfig?.vfsDefaults,
                        })
                        storeState.mountedRemotes[remote] = selectedPath

                        let permissionGranted = await isPermissionGranted()

                        if (!permissionGranted) {
                            const permission = await requestPermission()
                            permissionGranted = permission === 'granted'
                        }

                        if (permissionGranted) {
                            sendNotification({
                                title: 'Mounted',
                                body: `Successfully mounted ${remote} to ${selectedPath}`,
                            })
                        }

                        if (!remoteConfig?.defaultMountPoint) {
                            const answer = await ask(
                                `Mount successful! Do you want to set ${selectedPath} as the default mount point for ${remote}? You can always change it later in Remote settings.`,
                                {
                                    title: 'Set Default?',
                                    okLabel: 'Set',
                                    cancelLabel: 'Cancel',
                                }
                            )
                            if (answer) {
                                usePersistedStore.setState((state) => ({
                                    remoteConfigList: {
                                        ...state.remoteConfigList,
                                        [remote]: {
                                            ...state.remoteConfigList[remote],
                                            defaultMountPoint: selectedPath,
                                        },
                                    },
                                }))
                            }
                        }

                        await rebuildTrayMenu()
                    } catch (err) {
                        // await resetMainWindow()
                        console.error('Mount operation failed:', err)
                        await message(`Failed to mount ${remote}: ${err}`, {
                            title: 'Mount Error',
                        })
                    } finally {
                        await unlockWindows()
                        await getLoadingTray().then((t) => t?.setVisible(false))
                        await getMainTray().then((t) => t?.setVisible(true))
                    }
                },
            })

            submenuItems.push(mountMenuItem)
        }

        if (!remoteConfig?.disabledActions?.includes('tray-browse')) {
            const browseMenuItem = await MenuItem.new({
                id: `browse-${remote}`,
                text: 'Browse',
                action: async () => {
                    // await openBrowser(`http://localhost:5572/[${remote}:]/`)
                    try {
                        await openFullWindow({
                            name: 'Browse',
                            url:
                                'browse.html?url=' +
                                encodeURIComponent(`http://localhost:5572/[${remote}:]/`),
                        })
                    } catch {
                        await ask('Could not open browse window. Please try again.', {
                            title: 'Error',
                            kind: 'error',
                            okLabel: 'OK',
                            cancelLabel: '',
                        })
                    }
                },
            })
            submenuItems.push(browseMenuItem)
        }

        if (!remoteConfig?.disabledActions?.includes('tray-remove')) {
            const removeMenuItem = await MenuItem.new({
                id: `remove-${remote}`,
                text: 'Remove',
                action: async () => {
                    const answer = await ask(
                        `Are you sure you want to remove ${remote}? This action cannot be reverted.`,
                        { title: `Removing ${remote}`, kind: 'warning' }
                    )

                    if (!answer) {
                        return
                    }

                    await deleteRemote(remote)
                    // await rebuildTrayMenu()
                },
            })
            submenuItems.push(removeMenuItem)
        }

        parsedRemotes[remote] = submenuItems
    }

    return parsedRemotes
}

export async function buildMenu() {
    console.log('[buildMenu]')

    const storeState = useStore.getState()

    const persistedStoreState = usePersistedStore.getState()

    const remotes = storeState.remotes

    const menuItems: (MenuItem | Submenu | PredefinedMenuItem)[] = []

    if (remotes.length === 0) {
        const noRemotesMenuItem = await MenuItem.new({
            id: 'no-remotes',
            text: 'No Remotes',
            enabled: false,
        })
        menuItems.push(noRemotesMenuItem)
    } else if (remotes.length > 5) {
        const items = await parseRemotes(remotes)
        const submenuItems: (MenuItem | Submenu | PredefinedMenuItem)[] = []

        for (const remote in items) {
            const sub = await Submenu.new({
                items: items[remote],
                text: remote,
            })
            submenuItems.push(sub)
        }

        const sub = await Submenu.new({
            items: submenuItems,
            text: 'Remotes',
        })

        menuItems.push(sub)
    } else {
        const items = await parseRemotes(remotes)

        for (const remote in items) {
            const sub = await Submenu.new({
                items: items[remote],
                text: remote,
            })
            menuItems.push(sub)
        }
    }

    await PredefinedMenuItem.new({
        item: 'Separator',
    }).then((item) => {
        menuItems.push(item)
    })

    if (!persistedStoreState.disabledActions?.includes('tray-mount')) {
        const mountToMenuItem = await MenuItem.new({
            id: 'mount',
            text: 'Mount',
            action: async () => {
                await openWindow({
                    name: 'Mount',
                    url: '/mount',
                })
            },
        })
        menuItems.push(mountToMenuItem)
    }

    if (!persistedStoreState.disabledActions?.includes('tray-copy')) {
        const copyMenuItem = await MenuItem.new({
            id: 'copy',
            text: 'Copy',
            action: async () => {
                await openWindow({
                    name: 'Copy',
                    url: '/copy',
                })
            },
        })
        menuItems.push(copyMenuItem)
    }

    if (!persistedStoreState.disabledActions?.includes('tray-sync')) {
        const syncMenuItem = await MenuItem.new({
            id: 'sync',
            text: 'Sync',
            action: async () => {
                await openWindow({
                    name: 'Sync',
                    url: '/sync',
                })
            },
        })
        menuItems.push(syncMenuItem)
    }

    await PredefinedMenuItem.new({
        item: 'Separator',
    }).then((item) => {
        menuItems.push(item)
    })

    const jobsMenuItem = await MenuItem.new({
        id: 'jobs',
        text: 'Jobs',
        action: async () => {
            await openWindow({
                name: 'Jobs',
                url: '/jobs',
            })
        },
    })
    menuItems.push(jobsMenuItem)

    const cronMenuItem = await MenuItem.new({
        id: 'cron',
        text: 'Cron',
        action: async () => {
            await openWindow({
                name: 'Cron',
                url: '/cron',
            })
        },
    })
    menuItems.push(cronMenuItem)

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

    const quitItem = await MenuItem.new({
        id: 'quit',
        text: 'Quit',
        action: async () => {
            await getCurrentWindow().emit('close-app')
            await exit(0)
        },
    })
    menuItems.push(quitItem)

    return await Menu.new({
        id: 'main-menu',
        items: menuItems,
    })
}
