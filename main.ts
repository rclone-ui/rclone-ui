import * as Sentry from '@sentry/browser'
import { getVersion as getUiVersion } from '@tauri-apps/api/app'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { getCurrent, onOpenUrl } from '@tauri-apps/plugin-deep-link'
import { ask, message } from '@tauri-apps/plugin-dialog'
import { debug, error, info, trace, warn } from '@tauri-apps/plugin-log'
import { platform } from '@tauri-apps/plugin-os'
import { exit, relaunch } from '@tauri-apps/plugin-process'
import type { Child } from '@tauri-apps/plugin-shell'
import { check } from '@tauri-apps/plugin-updater'
import { CronExpressionParser } from 'cron-parser'
import { defaultOptions } from 'tauri-plugin-sentry-api'
import { getDeepLinkUrl, handleDeepLinkUrl } from './lib/deep'
import { isDirectoryEmpty } from './lib/fs'
import { LOCAL_HOST_ID, getHostInfo } from './lib/hosts'
import { validateLicense } from './lib/license'
import notify from './lib/notify'
import queryClient from './lib/query'
import {
    listTransfers,
    startBisync,
    startCopy,
    startDelete,
    startMount,
    startMove,
    startPurge,
    startSync,
} from './lib/rclone/api'
import rcloneClient from './lib/rclone/client'
import { compareVersions } from './lib/rclone/common'
import { initRclone } from './lib/rclone/init'
import { initTray } from './lib/tray'
import { openSmallWindow } from './lib/window'
import { initHostStore, useHostStore } from './store/host'
import { useStore } from './store/memory'
import { usePersistedStore } from './store/persisted'
import type { ScheduledTask } from './types/schedules'

let currentRcloneChild: Child | null = null
let rcloneListenersRegistered = false

try {
    Sentry.init({
        ...defaultOptions,
        sendDefaultPii: false,
    })
} catch {
    console.error('Error initializing Sentry')
}

// forward console logs in webviews to the tauri logger, so they show up in terminal
function forwardConsole(
    fnName: 'log' | 'debug' | 'info' | 'warn' | 'error',
    logger: (message: string) => Promise<void>
) {
    try {
        const original = console[fnName]
        console[fnName] = (message, ...args) => {
            original(message, ...args)
            logger(
                `${message} ${args?.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' ')}`
            )
        }
    } catch {}
}

try {
    forwardConsole('log', trace)
    forwardConsole('debug', debug)
    forwardConsole('info', info)
    forwardConsole('warn', warn)
    forwardConsole('error', error)
} catch (error) {
    console.error('Could not enable console logs', error)
}

async function waitForHydration() {
    console.log('[waitForHydration] waiting for store hydration')

    await new Promise((resolve) => setTimeout(resolve, 50))
    if (!usePersistedStore.persist.hasHydrated()) {
        await waitForHydration()
    }
    console.log('[waitForHydration] store hydrated')
}

async function initializeHostStore() {
    console.log('[initializeHostStore] initializing')
    const currentHost = usePersistedStore.getState().currentHost
    // Default to 'local' if fresh install/no host selected
    const hostId = currentHost?.id || 'local'

    await initHostStore(hostId)

    console.log('[initializeHostStore] initialized for', hostId)
}

async function checkHostReachability(): Promise<void> {
    console.log('[checkHostReachability] checking host reachability')

    const currentHost = usePersistedStore.getState().currentHost

    // If no host selected or local host, skip check (local rclone hasn't started yet)
    if (!currentHost || currentHost.id === LOCAL_HOST_ID) {
        console.log('[checkHostReachability] local or no host, skipping')
        return
    }

    console.log('[checkHostReachability] checking remote host:', currentHost.name)

    const checkReachability = async (): Promise<boolean> => {
        try {
            const hostInfo = await getHostInfo({
                url: currentHost.url,
                authUser: currentHost.authUser,
                authPassword: currentHost.authPassword,
            })
            return hostInfo !== null
        } catch (err) {
            console.error('[checkHostReachability] error:', err)
            return false
        }
    }

    let isReachable = await checkReachability()

    while (!isReachable) {
        console.log('[checkHostReachability] host not reachable')

        const answer = await ask(
            `The selected host "${currentHost.name}" is not reachable.\n\nURL: ${currentHost.url}\n\nWould you like to retry, switch to local host, or exit?`,
            {
                title: 'Host Not Reachable',
                kind: 'warning',
                okLabel: 'Retry',
                cancelLabel: 'Use Local',
            }
        )

        if (answer) {
            // User chose to retry
            console.log('[checkHostReachability] retrying connection')
            isReachable = await checkReachability()
        } else {
            // User chose to use local host
            console.log('[checkHostReachability] switching to local host')
            const hosts = usePersistedStore.getState().hosts
            const localHost = hosts.find((h) => h.id === LOCAL_HOST_ID)
            if (localHost) {
                usePersistedStore.setState({ currentHost: localHost })
            }
            // Re-initialize host store for local
            await initHostStore(LOCAL_HOST_ID)
            return
        }
    }

    console.log('[checkHostReachability] host is reachable')
}

async function validateInstance() {
    console.log('[validateInstance] validating license')

    const licenseKey = usePersistedStore.getState().licenseKey
    if (!licenseKey) {
        console.log('[validateInstance] no license key, skipping license validation')
        usePersistedStore.setState({ licenseValid: false })
        return
    }

    if (!navigator.onLine) {
        console.log('[validateInstance] not online, skipping license validation')
        return
    }

    try {
        await validateLicense(licenseKey)
    } catch (e) {
        console.log('[validateInstance] error validating license, marking as invalid')
        usePersistedStore.setState({ licenseValid: false })

        if (e instanceof Error) {
            await message(e.message, {
                title: 'Error Validating License',
                kind: 'error',
                okLabel: 'OK',
            })
            console.log('[validateInstance] error message displayed, returning')
            return
        }

        await message('An error occurred while validating your license. Please try again.', {
            title: 'Error',
            kind: 'error',
            okLabel: 'OK',
        })
        console.log('[validateInstance] default error message displayed, returning')
    } finally {
        console.log('[validateInstance] license validation complete')
    }
}

async function checkAlreadyRunning() {
    console.log('[checkAlreadyRunning]')

    try {
        const rcPort = 5572
        const running = await invoke<boolean>('is_rclone_running', { port: rcPort })
        console.log('[checkAlreadyRunning] running', running)

        if (running) {
            const confirmed = await ask(
                'Rclone is already running on this system.\n\nPlease stop it before launching Rclone UI.',
                {
                    title: 'Rclone Already Running',
                    kind: 'info',
                    okLabel: 'Close Rclone',
                    cancelLabel: 'Exit UI',
                }
            )
            console.log('[checkAlreadyRunning] confirmed', confirmed)

            if (confirmed) {
                console.log('[checkAlreadyRunning] closing rclone')

                if (platform() === 'windows') {
                    console.log('[checkAlreadyRunning] windows, showing message')

                    await message(
                        "If you're on Windows, you might notice a few powershell/terminal dialogs open and close.\n\nThis is normal and expected, imagine we are playing whack-a-mole with the rclone process to close it.",
                        {
                            'title': 'Trigger Warning',
                            'kind': 'info',
                            'okLabel': 'Got it',
                        }
                    )
                }
                const result = await invoke('stop_rclone_processes')
                console.log('[checkAlreadyRunning] stop_rclone_processes', result)
                await new Promise((resolve) => setTimeout(resolve, 700))
            } else {
                console.log('[checkAlreadyRunning] exiting')
                await exit(0)
            }
        }
    } catch (err) {
        console.error('[checkAlreadyRunning] error', err)
        Sentry.captureException(err)
    }
}

async function registerRcloneWindowListeners() {
    if (rcloneListenersRegistered) {
        return
    }

    const window = getCurrentWindow()

    await window.listen('close-app', async () => {
        console.log('[registerRcloneWindowListeners] close-app requested')

        const transfers = await queryClient.ensureQueryData({
            queryKey: ['transfers', 'list', 'all'],
            queryFn: async () => await listTransfers(),
            staleTime: 10_000, // 10 seconds
            gcTime: 60_000, // 1 minute
        })

        if (transfers?.active && transfers.active.length > 0) {
            const answer = await ask('All active transfers will be stopped.', {
                title: 'Exit',
                kind: 'info',
                okLabel: 'Quit',
                cancelLabel: 'Cancel',
            })

            if (!answer) {
                return
            }
        }

        const child = currentRcloneChild

        if (child) {
            try {
                await child.kill()
            } catch (error) {
                console.error('[close-app] failed to kill rclone child', error)
                Sentry.captureException(error)
            }
            currentRcloneChild = null
            await new Promise((resolve) => setTimeout(resolve, 1000))
        }

        await exit(0)
    })
    console.log('[registerRcloneWindowListeners] close-app listener registered')

    await window.listen('relaunch-app', async () => {
        console.log('[registerRcloneWindowListeners] relaunch-app requested')

        const transfers = await queryClient.ensureQueryData({
            queryKey: ['transfers', 'list', 'all'],
            queryFn: async () => await listTransfers(),
            staleTime: 10_000, // 10 seconds
            gcTime: 60_000, // 1 minute
        })

        if (transfers?.active && transfers.active.length > 0) {
            const answer = await ask('All active transfers will be stopped.', {
                title: 'Exit',
                kind: 'info',
                okLabel: 'Relaunch',
                cancelLabel: 'Cancel',
            })
            if (!answer) {
                return
            }
        }

        const child = currentRcloneChild

        if (child) {
            try {
                await child.kill()
            } catch (error) {
                console.error('[relaunch-app] failed to kill rclone child', error)
                Sentry.captureException(error)
            }
            currentRcloneChild = null
            await new Promise((resolve) => setTimeout(resolve, 1000))
        }

        await relaunch()
    })
    console.log('[registerRcloneWindowListeners] relaunch-app listener registered')

    await window.listen('restart-rclone', async () => {
        console.log('[registerRcloneWindowListeners] restart-rclone requested')

        if (useStore.getState().isRestartingRclone) {
            console.log('[restart-rclone] restart already in progress, ignoring request')
            return
        }

        useStore.setState({ isRestartingRclone: true })

        try {
            const child = currentRcloneChild

            if (child) {
                try {
                    await child.kill()
                } catch (error) {
                    console.error('[restart-rclone] failed to exit rclone process', error)
                    Sentry.captureException(error)
                }
                currentRcloneChild = null
                await new Promise((resolve) => setTimeout(resolve, 1000))
            }

            await startRclone()
        } catch (error) {
            console.error('[restart-rclone] failed to restart rclone', error)
            Sentry.captureException(error)
        } finally {
            useStore.setState({ isRestartingRclone: false })
        }
    })
    console.log('[registerRcloneWindowListeners] restart-rclone listener registered')

    rcloneListenersRegistered = true
}

async function startRclone() {
    console.log('[startRclone]')

    await registerRcloneWindowListeners()

    let rclone: Awaited<ReturnType<typeof initRclone>> | null = null

    try {
        rclone = await initRclone([
            'rcd',
            // ...(platform() === 'macos'
            //     ? ['--rc-no-auth'] // webkit doesn't allow for credentials in the url
            //     : ['--rc-user', 'admin', '--rc-pass', sessionPassword]),
            '--rc-no-auth',
            '--rc-serve',
            '--rc-job-expire-duration',
            '24h',
            '--rc-job-expire-interval',
            '1h',
            // defaults
            // '-rc-addr',
            // ':5572',
        ])
    } catch (error) {
        Sentry.captureException(error)
        await message(
            error instanceof Error
                ? error.message
                : 'Failed to start rclone, please try again later.',
            {
                title: 'Error',
                kind: 'error',
                okLabel: 'Exit',
            }
        )
        return await exit(0)
    }

    const rcloneCommandFn = rclone?.system || rclone?.internal

    const command = rcloneCommandFn!

    command.addListener('close', async (event) => {
        console.log('close', event)
        currentRcloneChild = null

        if (platform() === 'windows') {
            return await exit(0)
        }

        console.log('event.code', event.code)

        if (event.code === 143 || event.code === 1) {
            Sentry.captureException(new Error('Rclone has crashed'))
            const confirmed = await ask('Rclone has crashed', {
                title: 'Error',
                kind: 'error',
                okLabel: 'Relaunch',
                cancelLabel: 'Exit',
            })
            if (!confirmed) {
                return await exit(0)
            }
            await relaunch()
        }
    })

    command.addListener('error', (event) => {
        console.log('error', event)
    })

    console.log('[startRclone] starting rclone')
    const childProcess = await command.spawn()
    currentRcloneChild = childProcess
    console.log('[startRclone] running rclone')

    await new Promise((resolve) => setTimeout(resolve, 500))
}

async function startupMounts() {
    console.log('[startupMounts]')

    const remoteConfigList = useHostStore.getState().remoteConfigs

    const remotes = await queryClient.ensureQueryData({
        queryKey: ['remotes', 'list', 'all'],
        queryFn: async () => await rcloneClient('/config/listremotes').then((r) => r?.remotes),
        staleTime: 1000 * 60,
    })
    console.log('[startupMounts] remotes', remotes)

    for (const remote of remotes) {
        console.log('[startupMounts] remote', remote)

        const remoteConfig = remoteConfigList[remote]
        if (!remoteConfig) {
            console.log('[startupMounts] remote config not found', remote)
            continue
        }
        console.log('[startupMounts] remote config found', remoteConfig)
        if (remoteConfig.mountOnStart?.enabled && remoteConfig.mountOnStart?.mountPoint) {
            console.log(
                '[startupMounts] remote config mount on start enabled',
                remoteConfig.mountOnStart
            )
            try {
                const isEmpty = await isDirectoryEmpty(remoteConfig.mountOnStart.mountPoint)
                if (!isEmpty) {
                    console.log(
                        '[startupMounts] remote config mount point is not empty',
                        remoteConfig.mountOnStart.mountPoint
                    )
                    throw new Error(
                        `Mount point for ${remote} is not empty, make sure ${remoteConfig.mountOnStart.mountPoint} is empty`
                    )
                }

                const {
                    mountPoint,
                    remotePath,
                    mountOptions,
                    vfsOptions,
                    filterOptions,
                    configOptions,
                } = remoteConfig.mountOnStart

                console.log('[startupMounts] starting mount', {
                    source: `${remote}:${remotePath}`,
                    destination: mountPoint,
                    options: {
                        mount: mountOptions,
                        vfs: vfsOptions,
                        filter: filterOptions,
                        config: configOptions,
                    },
                })

                console.log('[startupMounts] starting mount')

                await startMount({
                    source: `${remote}:${remotePath}`,
                    destination: mountPoint,
                    options: {
                        mount: mountOptions,
                        vfs: vfsOptions,
                        filter: filterOptions,
                        config: configOptions,
                    },
                })

                console.log('[startupMounts] mount started')
            } catch (error) {
                console.error('Error mounting remote:', error)
                Sentry.captureException(error)
                await message(
                    error instanceof Error
                        ? error.message
                        : `Failed to mount ${remote} on startup.`,
                    {
                        title: 'Automount Error',
                        kind: 'error',
                        okLabel: 'Got it',
                    }
                )
            }
        }
    }
}

async function showStartup() {
    console.log('[showStartup] showing startup')
    const hideStartup = usePersistedStore.getState().hideStartup
    if (hideStartup) {
        console.log('[showStartup] startup hidden, returning')
        return
    }

    const startupDisplayed = useStore.getState().startupDisplayed
    if (startupDisplayed) {
        console.log('[showStartup] startup already displayed, returning')
        return
    }

    console.log('[showStartup] startup not displayed, setting displayed and status')
    useStore.setState({ startupDisplayed: true, startupStatus: 'initialized' })
    console.log('[showStartup] store updated with startup displayed and status set')
    await openSmallWindow({
        name: 'Startup',
        url: '/startup',
    })
    console.log('[showStartup] startup window opened')
    if (!['windows', 'macos'].includes(platform())) {
        usePersistedStore.setState({ hideStartup: true })
    }
    console.log('[showStartup] startup hidden')
}

const MAX_INT_MS = 2_147_483_647
let hasScheduledTasks = false
async function resumeTasks() {
    console.log('[resumeTasks] resuming tasks')

    if (hasScheduledTasks) {
        console.log('[resumeTasks] tasks already resumed')
        return
    }

    const scheduledTasks = useHostStore.getState().scheduledTasks
    const activeConfigId = useHostStore.getState().activeConfigFile?.id

    if (!activeConfigId) {
        console.log('[resumeTasks] no active config id')
        return
    }

    hasScheduledTasks = true

    console.log('[resumeTasks] resuming tasks for config', activeConfigId)

    for (const task of scheduledTasks) {
        if (task.isRunning) {
            useHostStore.getState().updateScheduledTask(task.id, {
                isRunning: false,
                currentRunId: undefined,
                lastRunError: 'Task closed prematurely',
            })
            continue
        }

        if (task.configId !== activeConfigId) {
            continue
        }

        try {
            const cronInterval = CronExpressionParser.parse(task.cron)
            const nextRun = cronInterval.next().toDate()
            const difference = nextRun.getTime() - Date.now()

            if (difference <= MAX_INT_MS && difference > 0) {
                setTimeout(async () => {
                    console.log('running task', task)
                    notify({
                        title: 'Task Started',
                        body: `Task ${task.operation} (${task.id}) started`,
                    })
                    await handleTask(task)
                }, difference)
                console.log('scheduled task', task.operation, task.id, nextRun)
            }
        } catch (error) {
            console.error('Error scheduling task:', error)
            Sentry.captureException(error)
        }
    }

    console.log('[resumeTasks] tasks resumed')
}

async function handleTask(task: ScheduledTask) {
    const currentTask = useHostStore.getState().scheduledTasks.find((t) => t.id === task.id)

    if (!currentTask) {
        return
    }

    if (currentTask.isRunning) {
        return
    }

    const freshRunId = crypto.randomUUID()

    useHostStore.getState().updateScheduledTask(task.id, {
        isRunning: true,
        currentRunId: freshRunId,
        lastRun: new Date().toISOString(),
    })

    console.log('running task', task.operation, task.id)

    const currentRunId = useHostStore
        .getState()
        .scheduledTasks.find((t) => t.id === task.id)?.currentRunId

    if (currentRunId !== freshRunId) {
        return
    }

    try {
        switch (task.operation) {
            case 'copy': {
                const { sources, options, destination } = task.args
                await startCopy({
                    sources,
                    destination,
                    options,
                })
                break
            }
            case 'move': {
                const { sources, options, destination } = task.args
                await startMove({
                    sources,
                    destination,
                    options,
                })
                break
            }
            case 'sync': {
                const { source, destination, options } = task.args
                await startSync({
                    source,
                    destination,
                    options,
                })
                break
            }
            case 'bisync': {
                const { source, destination, options } = task.args
                await startBisync({
                    source,
                    destination,
                    options,
                })
                break
            }
            case 'delete': {
                const { sources, options } = task.args
                await startDelete({
                    sources,
                    options,
                })
                break
            }
            case 'purge': {
                const { sources, options } = task.args
                await startPurge({
                    sources,
                    options,
                })
                break
            }
            default:
                break
        }
    } catch (err) {
        Sentry.captureException(err)
        console.error('Failed to start task:', err)
        useHostStore.getState().updateScheduledTask(task.id, {
            isRunning: false,
            currentRunId: undefined,
            lastRunError: err instanceof Error ? err.message : 'Unknown error',
        })
    } finally {
    }
}

async function checkVersion() {
    console.log('[checkVersion]')

    try {
        console.log('[checkVersion] fetching meta.json')

        const metaJson = await fetch(
            'https://raw.githubusercontent.com/rclone-ui/rclone-ui/refs/heads/main/meta.json'
        )
        console.log('[checkVersion] meta.json fetched')

        const metaJsonData = (await metaJson.json()) as {
            minimumVersion: string
            okVersion: string
        }
        console.log('[checkVersion] meta.json parsed')

        const { minimumVersion, okVersion } = metaJsonData

        console.log('[checkVersion] minimumVersion', minimumVersion)
        console.log('[checkVersion] okVersion', okVersion)

        const currentVersion = await getUiVersion()
        console.log('[checkVersion] currentVersion', currentVersion)

        if (
            compareVersions(currentVersion, minimumVersion) >= 0 &&
            compareVersions(currentVersion, okVersion) >= 0
        ) {
            console.log('[checkVersion] currentVersion is up to date')
            return
        }

        console.log('[checkVersion] checking for update')

        const receivedUpdate = await check({
            allowDowngrades: true,
            timeout: 30000,
        })

        console.log('[checkVersion] update check complete')

        if (!receivedUpdate) {
            console.log('[checkVersion] no update found')
            return
        }

        if (compareVersions(currentVersion, minimumVersion) < 0) {
            console.log('[checkVersion] currentVersion is outdated')

            const confirmed = await ask(
                'You are running an outdated version of Rclone UI. Please update to the latest version.',
                {
                    title: 'Update Required',
                    kind: 'info',
                    okLabel: 'Update',
                    cancelLabel: 'Exit',
                }
            )

            if (!confirmed) {
                console.log('[checkVersion] user cancelled update')
                return await exit(0)
            }

            console.log('[checkVersion] downloading and installing update')

            await receivedUpdate.downloadAndInstall()

            console.log('[checkVersion] update downloaded and installed')

            await message('Rclone UI has been updated. Please restart the application.', {
                title: 'Update Complete',
                kind: 'info',
                okLabel: 'Restart',
            })

            console.log('[checkVersion] relaunching app')

            await getCurrentWindow().emit('relaunch-app')
        } else if (compareVersions(currentVersion, okVersion) < 0) {
            console.log('[checkVersion] checking for update')

            const confirmed = await ask(
                'You are running an outdated version of Rclone UI. Please update to the latest version.',
                {
                    title: 'Update Available',
                    kind: 'info',
                    okLabel: 'Update',
                    cancelLabel: 'Cancel',
                }
            )

            if (!confirmed) {
                console.log('[checkVersion] user cancelled update')
                return
            }

            console.log('[checkVersion] downloading and installing update')

            await receivedUpdate.downloadAndInstall()

            console.log('[checkVersion] update downloaded and installed')

            await message('Rclone UI has been updated. Please restart the application.', {
                title: 'Update Complete',
                kind: 'info',
                okLabel: 'Restart',
            })

            console.log('[checkVersion] relaunching app')

            await getCurrentWindow().emit('relaunch-app')
        }
    } catch (error) {
        console.error('[checkVersion] error', error)
        Sentry.captureException(error)
    }
}

async function checkRclone() {
    let currentHost = usePersistedStore.getState().currentHost

    if (!currentHost) {
        currentHost = {
            id: 'local',
            name: 'Local Machine',
            url: 'http://localhost:5572',
            os: 'linux',
            cliVersion: 'unknown',
        }
    }

    let hostInfo = await getHostInfo({
        url: currentHost.url,
        authUser: currentHost.authUser,
        authPassword: currentHost.authPassword,
    })

    if (!hostInfo) {
        await message(
            'Failed to get host info, is it online and reachable?\n\nSwitching to local host.',
            {
                title: 'Host Not Reachable',
                kind: 'error',
            }
        )
        currentHost = {
            id: 'local',
            name: 'Local Machine',
            url: 'http://localhost:5572',
            os: 'linux',
            cliVersion: 'unknown',
        }

        hostInfo = await getHostInfo({
            url: currentHost.url,
            authUser: currentHost.authUser,
            authPassword: currentHost.authPassword,
        })

        if (!hostInfo) {
            const confirmed = await ask(
                'Local host is not reachable, please try again or file an issue on Github if the problem persists.',
                {
                    title: 'Local Host Not Reachable',
                    kind: 'error',
                    okLabel: 'Exit',
                }
            )

            if (confirmed) {
                return await exit(0)
            }

            await new Promise((resolve) => setTimeout(resolve, 60_000))
            return await exit(0)
        }
    }

    currentHost = {
        ...currentHost,
        os: hostInfo.os,
        cliVersion: hostInfo.cliVersion,
    }

    console.log('[checkRclone] setting currentHost', currentHost)

    usePersistedStore.setState({ currentHost })
    usePersistedStore.setState((prev) => ({
        hosts: [...prev.hosts.filter((h) => h.id !== currentHost!.id), currentHost],
    }))
}

getCurrentWindow().listen('tauri://close-requested', async (e) => {
    console.log('(main) window close requested')
    await getCurrentWindow().destroy()
})

// maybe place this inside handleDeepLink?
onOpenUrl((urls) => {
    console.log('deep links while running', urls)
    const receivedUrl = urls[0]

    const deepLinkUrl = getDeepLinkUrl(receivedUrl)

    console.log('deep link url', deepLinkUrl)

    handleDeepLinkUrl(deepLinkUrl)

    useStore.setState({ startupDisplayed: true, startupStatus: 'initializing' })
})

async function handleDeepLink() {
    console.log('[handleDeepLink] getting current deep links')
    const urls = await getCurrent()
    if (!urls || urls.length === 0) {
        console.log('[handleDeepLink] no deep links found')
        return
    }

    console.log('[handleDeepLink] getting deep link url')
    const deepLinkUrl = getDeepLinkUrl(urls[0])
    console.log('[handleDeepLink] deep link url', deepLinkUrl)

    console.log('[handleDeepLink] handling deep link url')
    handleDeepLinkUrl(deepLinkUrl)
    console.log('[handleDeepLink] deep link url handled')

    console.log('[handleDeepLink] setting startup displayed and status')
    useStore.setState({ startupDisplayed: true, startupStatus: 'initializing' })
    console.log('[handleDeepLink] startup displayed and status set')
}

waitForHydration()
    .then(() => initializeHostStore())
    .then(() => checkHostReachability())
    .then(() => checkVersion())
    .then(() => validateInstance())
    .then(() => checkAlreadyRunning())
    .then(() => startRclone())
    .then(() => checkRclone())
    .then(() => handleDeepLink())
    .then(() => showStartup())
    .then(() => startupMounts())
    .then(() => resumeTasks())
    .then(() => initTray())
    .catch(console.error)
