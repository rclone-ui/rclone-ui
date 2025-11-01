import * as Sentry from '@sentry/browser'
import { Menu, MenuItem, PredefinedMenuItem, Submenu } from '@tauri-apps/api/menu'
import { resolveResource, sep } from '@tauri-apps/api/path'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { ask, message, open } from '@tauri-apps/plugin-dialog'
import { exists, mkdir, remove } from '@tauri-apps/plugin-fs'
import { openPath, openUrl } from '@tauri-apps/plugin-opener'
import { platform } from '@tauri-apps/plugin-os'
import { isDirectoryEmpty } from './fs'
import notify from './notify'
import {
    cleanupRemote,
    deleteRemote,
    getRemote,
    listMounts,
    listServes,
    mountRemote,
    stopServe,
    unmountRemote,
} from './rclone/api'
import { compareVersions, getRcloneVersion } from './rclone/common'
import { dialogGetMountPlugin, needsMountPlugin } from './rclone/mount'
import { usePersistedStore, useStore } from './store'
import { showDefaultTray, showLoadingTray } from './tray'
import { lockWindows, openFullWindow, openWindow, unlockWindows } from './window'

const SUPPORTS_CLEANUP = [
    's3',
    'b2',
    'box',
    'drive',
    'onedrive',
    'internetarchive',
    'jottacloud',
    'mailru',
    'mega',
    'oos',
    'pcloud',
    'pikpak',
    'putio',
    'qingstor',
    'protondrive',
    'seafile',
    'yandex',
]

async function parseRemotes(remotes: string[]) {
    console.log('[parseRemotes] remotes', remotes)

    const persistedStoreState = usePersistedStore.getState()

    console.log('[parseRemotes] listing mounts')
    const currentMounts = await listMounts()
    console.log('[parseRemotes] currentMounts', currentMounts)
    const currentServes = await listServes()
    console.log('[parseRemotes] currentServes', currentServes)

    const parsedRemotes: Record<
        string,
        { icon: string; items: (MenuItem | Submenu | PredefinedMenuItem)[] }
    > = {}

    for (const remote of remotes) {
        console.log('[parseRemotes] remote', remote)

        const remoteConfig = persistedStoreState.remoteConfigList?.[remote]
        if (remoteConfig?.disabledActions?.includes('tray')) {
            continue
        }

        const remoteInfo = await getRemote(remote).catch(null)
        console.log('[parseRemotes] remoteInfo', remoteInfo?.provider, remoteInfo?.type)

        const submenuItems: (MenuItem | Submenu | PredefinedMenuItem)[] = []

        if (!remoteConfig?.disabledActions?.includes('tray-mount')) {
            const mountMenuItem = await MenuItem.new({
                id: `mount-${remote}`,
                text: 'Quick Mount',
                action: async () => {
                    await showLoadingTray()

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
                            await getCurrentWindow().setFocus()
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
                        } catch (error) {
                            console.error('Error checking if directory exists:', error)
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
                                Sentry.captureException(error)
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

                        await notify({
                            title: 'Mounted',
                            body: `Successfully mounted ${remote} to ${selectedPath}`,
                        })

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
                    } catch (error) {
                        // await resetMainWindow()
                        Sentry.captureException(error)
                        console.error('Mount operation failed:', error)
                        await message(`Failed to mount ${remote}: ${error}`, {
                            title: 'Mount Error',
                        })
                    } finally {
                        await unlockWindows()
                        await showDefaultTray()
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
                    } catch (error) {
                        Sentry.captureException(error)
                        await message('Could not open browse window. Please try again.', {
                            title: 'Error',
                            kind: 'error',
                            okLabel: 'OK',
                        })
                    }
                },
            })
            submenuItems.push(browseMenuItem)
        }

        if (!remoteConfig?.disabledActions?.includes('tray-cleanup')) {
            if (remoteInfo?.provider && SUPPORTS_CLEANUP.includes(remoteInfo.provider)) {
                const cleanupMenuItem = await MenuItem.new({
                    id: `cleanup-${remote}`,
                    text: 'Cleanup',
                    action: async () => {
                        try {
                            const confirmed = await ask(`Start cleanup on ${remote}?`, {
                                title: `Cleaning up ${remote}`,
                                kind: 'warning',
                                okLabel: 'Start',
                                cancelLabel: 'Cancel',
                            })

                            if (!confirmed) {
                                return
                            }

                            await cleanupRemote(remote)
                            await message(`Cleanup started for ${remote}`, {
                                title: 'Cleanup Started',
                                okLabel: 'OK',
                            })
                        } catch (error) {
                            await message(`Failed to start cleanup job, ${error}`, {
                                title: 'Cleanup Error',
                                kind: 'error',
                                okLabel: 'OK',
                            })
                        }
                    },
                })
                submenuItems.push(cleanupMenuItem)
            }
        }

        if (!remoteConfig?.disabledActions?.includes('tray-remove')) {
            const removeMenuItem = await MenuItem.new({
                id: `remove-${remote}`,
                text: 'Remove',
                action: async () => {
                    await showLoadingTray()
                    const answer = await ask(
                        `Are you sure you want to remove ${remote}? This action cannot be reverted.`,
                        { title: `Removing ${remote}`, kind: 'warning' }
                    )

                    if (!answer) {
                        return
                    }

                    await deleteRemote(remote)
                    await showDefaultTray()
                },
            })
            submenuItems.push(removeMenuItem)
        }

        const currentRemoteMounts = currentMounts.filter(
            (mount) => mount.Fs.split(':')[0] === remote
        )

        console.log('[parseRemotes] currentRemoteMounts', currentRemoteMounts)

        for (const currentMount of currentRemoteMounts) {
            console.log(
                '[parseRemotes] Adding Unmount (' +
                    currentMount.MountPoint.split(sep()).pop() +
                    ') for ',
                remote
            )
            const unmountMenuItem = await MenuItem.new({
                id: `unmount-${remote}-${currentMount.MountPoint}`,
                text: 'Unmount (' + currentMount.MountPoint.split(sep()).pop() + ')',
                action: async () => {
                    try {
                        await showLoadingTray()
                        await unmountRemote({ mountPoint: currentMount.MountPoint })
                        await message(
                            `Successfully unmounted ${remote} from ${currentMount.MountPoint.split('/').pop()}`,
                            {
                                title: 'Success',
                            }
                        )
                    } catch (error) {
                        Sentry.captureException(error)
                        console.error('Unmount operation failed:', error)
                        await message(`Failed to unmount ${remote}: ${error}`, {
                            kind: 'error',
                            title: 'Unmount Error',
                        })
                    } finally {
                        await showDefaultTray()
                    }
                },
            })
            submenuItems.push(unmountMenuItem)

            console.log(
                '[parseRemotes] Adding Open (' +
                    currentMount.MountPoint.split('/').pop() +
                    ') for ',
                remote
            )
            const showLocationItem = await MenuItem.new({
                id: `open-${remote}-${currentMount.MountPoint}`,

                text: 'Open (' + currentMount.MountPoint.split('/').pop() + ')',
                action: async () => {
                    console.log(
                        '[parseRemotes] Opening (' + currentMount.MountPoint.split('/').pop() + ')'
                    )
                    try {
                        await openPath(currentMount.MountPoint)
                    } catch (error) {
                        Sentry.captureException(error)
                        console.error('Error opening path:', error)
                        await message(`Failed to open ${currentMount.MountPoint} (${error})`, {
                            title: 'Open Error',
                            kind: 'error',
                        })
                    }
                },
            })
            submenuItems.push(showLocationItem)
        }

        for (const currentServe of currentServes) {
            // console.log('[parseRemotes] Adding Stop Serve (' + currentServe.Addr.split(':')[0] + ') for ', remote)
            const stopServeMenuItem = await MenuItem.new({
                id: `stop-serve-${currentServe.id}`,
                text: 'Stop Serve',
                action: async () => {
                    try {
                        await showLoadingTray()
                        await stopServe(currentServe.id)

                        await message(`Successfully stopped serve ${currentServe.id}`, {
                            title: 'Success',
                        })
                    } catch (error) {
                        Sentry.captureException(error)
                        console.error('Stop serve operation failed:', error)
                        await message(`Failed to stop serve ${currentServe.id}: ${error}`, {
                            kind: 'error',
                            title: 'Stop Serve Error',
                        })
                    } finally {
                        await showDefaultTray()
                    }
                },
            })
            submenuItems.push(stopServeMenuItem)
        }

        let iconPath = await resolveResource('icons/favicon/icon.png')

        try {
            if (remoteInfo?.provider && !remoteInfo.type) {
                console.log('[parseRemotes] resolving provider icon', remoteInfo.provider)
                iconPath = await resolveResource(`icons/small/providers/${remoteInfo.provider}.png`)
            } else if (remoteInfo?.type) {
                console.log('[parseRemotes] resolving backend icon', remoteInfo.type)
                iconPath = await resolveResource(`icons/small/backends/${remoteInfo?.type}.png`)
            }
        } catch (error) {
            Sentry.captureException(new Error(`Error resolving icon path for ${remote}: ${error}`))
            Sentry.captureException(error)
            console.error('Error resolving icon path for', remote, error)
        }

        console.log('[parseRemotes] iconPath', iconPath)

        parsedRemotes[remote] = {
            icon: iconPath,
            items: submenuItems,
        }
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
            text: 'Add Remotes in Settings!',
            enabled: false,
        })
        menuItems.push(noRemotesMenuItem)
    } else if (remotes.length > 5) {
        const parsedRemotes = await parseRemotes(remotes)
        const submenuItems: (MenuItem | Submenu | PredefinedMenuItem)[] = []

        for (const r in parsedRemotes) {
            const sub = await Submenu.new({
                items: parsedRemotes[r].items,
                icon: parsedRemotes[r].icon,
                text: r,
            })
            submenuItems.push(sub)
        }

        const sub = await Submenu.new({
            items: submenuItems,
            text: 'Remotes',
        })

        menuItems.push(sub)
    } else {
        const parsedRemotes = await parseRemotes(remotes)

        for (const r in parsedRemotes) {
            const sub = await Submenu.new({
                items: parsedRemotes[r].items,
                icon: parsedRemotes[r].icon,
                text: r,
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

    if (!persistedStoreState.disabledActions?.includes('tray-download')) {
        const downloadMenuItem = await MenuItem.new({
            id: 'download',
            text: 'Download',
            action: async () => {
                await openWindow({
                    name: 'Download',
                    url: '/download',
                })
            },
        })
        menuItems.push(downloadMenuItem)
    }

    const allowsAdditional =
        !persistedStoreState.disabledActions?.includes('tray-sync') ||
        !persistedStoreState.disabledActions?.includes('tray-move') ||
        !persistedStoreState.disabledActions?.includes('tray-serve') ||
        !persistedStoreState.disabledActions?.includes('tray-purge') ||
        !persistedStoreState.disabledActions?.includes('tray-delete')

    if (allowsAdditional) {
        const commandsSubmenuItems: (MenuItem | Submenu | PredefinedMenuItem)[] = []

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
            commandsSubmenuItems.push(syncMenuItem)
        }

        if (!persistedStoreState.disabledActions?.includes('tray-move')) {
            const moveMenuItem = await MenuItem.new({
                id: 'move',
                text: 'Move',
                action: async () => {
                    await openWindow({
                        name: 'Move',
                        url: '/move',
                    })
                },
            })
            commandsSubmenuItems.push(moveMenuItem)
        }

        const rcloneVersion = await getRcloneVersion()

        if (
            rcloneVersion?.yours &&
            compareVersions(rcloneVersion.yours, '1.70.0') === 1 &&
            !persistedStoreState.disabledActions?.includes('tray-serve')
        ) {
            const serveToMenuItem = await MenuItem.new({
                id: 'serve',
                text: 'Serve',
                action: async () => {
                    await openWindow({
                        name: 'Serve',
                        url: '/serve',
                    })
                },
            })
            commandsSubmenuItems.push(serveToMenuItem)
        }

        if (!persistedStoreState.disabledActions?.includes('tray-purge')) {
            const purgeMenuItem = await MenuItem.new({
                id: 'purge',
                text: 'Purge',
                action: async () => {
                    await openWindow({
                        name: 'Purge',
                        url: '/purge',
                    })
                },
            })
            commandsSubmenuItems.push(purgeMenuItem)
        }

        if (!persistedStoreState.disabledActions?.includes('tray-delete')) {
            const deleteMenuItem = await MenuItem.new({
                id: 'delete',
                text: 'Delete',
                action: async () => {
                    await openWindow({
                        name: 'Delete',
                        url: '/delete',
                    })
                },
            })
            commandsSubmenuItems.push(deleteMenuItem)
        }

        const commandsSubmenu = await Submenu.new({
            items: commandsSubmenuItems,
            text: 'Commands',
        })
        menuItems.push(commandsSubmenu)
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
