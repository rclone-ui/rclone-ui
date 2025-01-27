import { Menu, MenuItem, PredefinedMenuItem, Submenu } from '@tauri-apps/api/menu'
import { ask, confirm, message, open } from '@tauri-apps/plugin-dialog'
import { isPermissionGranted, requestPermission } from '@tauri-apps/plugin-notification'
import { sendNotification } from '@tauri-apps/plugin-notification'
import { revealItemInDir } from '@tauri-apps/plugin-opener'
import { exit } from '@tauri-apps/plugin-process'
import { isDirectoryEmpty } from './fs'
import { deleteRemote, mountRemote, unmountRemote } from './rclone/api'
import { dialogGetMountPlugin, needsMountPlugin } from './rclone/mount'
import { usePersistedStore, useStore } from './store'
import { getLoadingTray, getMainTray, rebuildTrayMenu } from './tray'
import { lockWindows, openFullWindow, openTrayWindow, openWindow, unlockWindows } from './window'

// Function to rebuild and update the menu
export async function buildMenu() {
    const storeState = useStore.getState()

    const persistedStoreState = usePersistedStore.getState()

    const remotes = storeState.remotes

    const menuItems: (MenuItem | Submenu | PredefinedMenuItem)[] = []

    // Add remote submenus
    for (const remote of remotes) {
        const remoteConfig = persistedStoreState.remoteConfigList?.[remote]
        if (remoteConfig?.hideTray) {
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
                        await unmountRemote(mountPoint)
                        delete storeState.mountedRemotes[remote]
                        await rebuildTrayMenu()
                        await message(`Successfully unmounted ${remote} from ${mountPoint}`, {
                            title: 'Unmount Success',
                        })
                    } catch (err) {
                        console.error('Unmount operation failed:', err)
                        await message(`Failed to unmount ${remote}: ${err}`, {
                            title: 'Unmount Error',
                        })
                    }
                },
            })
            submenuItems.push(unmountMenuItem)

            // Add "Open in Finder" option for mounted remotes
            const mountPoint = storeState.mountedRemotes[remote]
            console.log('Adding Open in Finder', mountPoint)
            const openInFinderItem = await MenuItem.new({
                id: `open-${remote}`,

                text: 'Open in Finder',
                action: async () => {
                    console.log('Open in Finder')
                    console.log(mountPoint)
                    if (mountPoint) {
                        console.log('Opening in Finder')
                        await revealItemInDir(mountPoint)
                        console.log('Opened in Finder')
                    }
                },
            })
            submenuItems.push(openInFinderItem)
        }

        if (!alreadyMounted && !remoteConfig?.disabledActions?.includes('mount')) {
            const mountMenuItem = await MenuItem.new({
                id: `mount-${remote}`,
                text: 'Quick Mount',
                action: async () => {
                    await getMainTray().then((t) => t?.setVisible(false))

                    await getLoadingTray().then((t) => t?.setVisible(true))

                    const needsPlugin = await needsMountPlugin()
                    if (needsPlugin) {
                        console.log('Mount plugin not installed')
                        await dialogGetMountPlugin()
                        await getLoadingTray().then((t) => t?.setVisible(false))
                        await getMainTray().then((t) => t?.setVisible(true))
                        return
                    }
                    console.log('Mount plugin installed')

                    try {
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

                        // Check if directory is empty
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

        if (!remoteConfig?.disabledActions?.includes('browse')) {
            const browseMenuItem = await MenuItem.new({
                id: `browse-${remote}`,
                text: 'Browse',
                action: async () => {
                    // await openBrowser(`http://localhost:5572/[${remote}:]/`)
                    await openFullWindow({
                        name: 'Browse',
                        // url: 'browse.html?url=https%3A%2F%2Fwww.google.com%2F',
                        url:
                            'browse.html?url=' +
                            encodeURIComponent(`http://localhost:5572/[${remote}:]/`),
                    })
                },
            })
            submenuItems.push(browseMenuItem)
        }

        if (!remoteConfig?.disabledActions?.includes('remove')) {
            const removeMenuItem = await MenuItem.new({
                id: `remove-${remote}`,
                text: 'Remove',
                action: async () => {
                    const confirmation = await confirm(
                        `Are you sure you want to remove ${remote}? This action cannot be reverted.`,
                        { title: `Removing ${remote}`, kind: 'warning' }
                    )

                    if (!confirmation) {
                        return
                    }

                    await deleteRemote(remote)
                    // await rebuildTrayMenu()
                },
            })
            submenuItems.push(removeMenuItem)
        }

        const sub = await Submenu.new({
            items: submenuItems,
            text: remote,
        })

        menuItems.push(sub)
    }

    await PredefinedMenuItem.new({
        item: 'Separator',
    }).then((item) => {
        menuItems.push(item)
    })

    if (!persistedStoreState.disabledActions?.includes('mount')) {
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

    if (!persistedStoreState.disabledActions?.includes('copy')) {
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

    if (!persistedStoreState.disabledActions?.includes('sync')) {
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

    const jobsMenuItem = await MenuItem.new({
        id: 'jobs',
        text: 'Jobs',
        action: async () => {
            await openTrayWindow({
                name: 'Jobs',
                url: '/jobs',
            })
        },
    })
    menuItems.push(jobsMenuItem)

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
            await exit(0)
        },
    })

    menuItems.push(quitItem)

    const testItem = await MenuItem.new({
        id: 'test',
        text: 'Test',
        action: async () => {
            await openWindow({
                name: 'Test',
                url: '/test',
                width: 400,
                height: 400,
            })
        },
    })
    menuItems.push(testItem)

    const test2Item = await MenuItem.new({
        id: 'test2',
        text: 'Test2',
        action: async () => {
            await openWindow({
                name: 'Test2',
                url: '/test',
                width: 400,
                height: 400,
            })
        },
    })
    menuItems.push(test2Item)

    return await Menu.new({
        id: 'main-menu',

        items: menuItems,
    })
}
