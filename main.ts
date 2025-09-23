import * as Sentry from '@sentry/browser'
import { getVersion as getUiVersion } from '@tauri-apps/api/app'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { ask, message } from '@tauri-apps/plugin-dialog'
import { debug, error, info, trace, warn } from '@tauri-apps/plugin-log'
import { platform } from '@tauri-apps/plugin-os'
import { exit, relaunch } from '@tauri-apps/plugin-process'
import { check } from '@tauri-apps/plugin-updater'
import { CronExpressionParser } from 'cron-parser'
import { defaultOptions } from 'tauri-plugin-sentry-api'
import { isDirectoryEmpty } from './lib/fs'
import { validateLicense } from './lib/license'
import notify from './lib/notify'
import {
    listJobs,
    listRemotes,
    mountRemote,
    startCopy,
    startDelete,
    startMove,
    startPurge,
    startSync,
} from './lib/rclone/api'
import { compareVersions } from './lib/rclone/common'
import { initRclone } from './lib/rclone/init'
import { usePersistedStore, useStore } from './lib/store'
import { initTray, showDefaultTray, showLoadingTray } from './lib/tray'
import { openSmallWindow } from './lib/window'
import type { ScheduledTask } from './types/task'

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
    console.log('waiting for store hydration')
    await new Promise((resolve) => setTimeout(resolve, 50))
    if (!usePersistedStore.persist.hasHydrated()) {
        await waitForHydration()
    }
    console.log('store hydrated')
}

async function validateInstance() {
    const isOnline = navigator.onLine

    if (!isOnline && platform() !== 'linux') {
        await message(
            'You are not connected to the internet. Please check your connection and try again.',
            {
                title: 'Error',
                kind: 'error',
                okLabel: 'Exit',
            }
        )
        return await exit(0)
    }

    const licenseKey = usePersistedStore.getState().licenseKey
    if (!licenseKey) {
        usePersistedStore.setState({ licenseValid: false })
        return
    }

    try {
        await validateLicense(licenseKey)
    } catch (e) {
        usePersistedStore.setState({ licenseValid: false })

        if (e instanceof Error) {
            await message(e.message, {
                title: 'Error Validating License',
                kind: 'error',
                okLabel: 'OK',
            })
            return
        }

        await message('An error occurred while validating your license. Please try again.', {
            title: 'Error',
            kind: 'error',
            okLabel: 'OK',
        })
    }
}

async function startRclone() {
    console.log('[startRclone]')

    try {
        const remotes = await listRemotes()
        console.log('[startRclone] rclone rcd already running')
        useStore.setState({ rcloneLoaded: true })
        useStore.setState({ remotes: remotes })
        return
    } catch {}

    let rclone: Awaited<ReturnType<typeof initRclone>> | null = null

    try {
        const sessionPassword = Math.random().toString(36).substring(2, 15)
        useStore.setState({ rcloneAuth: sessionPassword })
        useStore.setState({ rcloneAuthHeader: 'Basic ' + btoa(`admin:${sessionPassword}`) })

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

    // command.stdout.on('data', (line) => {
    //     console.log('stdout ' + line)
    // })
    // command.stderr.on('data', (line) => {
    //     console.log('stderr ' + line)
    // })

    command.addListener('close', async (event) => {
        console.log('close', event)

        if (event.code === 143 || (platform() === 'windows' && event.code === 1)) {
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
    console.log('[startRclone] running rclone')

    getCurrentWindow().listen('close-app', async (e) => {
        console.log('[startRclone] (main) window close-app requested')

        await showLoadingTray()

        const jobs = await listJobs().catch(() => ({ active: [] }))

        if (jobs.active.length > 0) {
            const answer = await ask('All active jobs will be stopped.', {
                title: 'Exit',
                kind: 'info',
                okLabel: 'Quit',
                cancelLabel: 'Cancel',
            })

            if (!answer) {
                await showDefaultTray()
                return
            }
        }

        await childProcess.kill()

        await new Promise((resolve) => setTimeout(resolve, 1000))

        await exit(0)
    })
    console.log('[startRclone] set listener for close-app')

    getCurrentWindow().listen('relaunch-app', async (e) => {
        console.log('[startRclone] (main) window relaunch-app requested')
        await showLoadingTray()

        const jobs = await listJobs().catch(() => ({ active: [] }))

        if (jobs.active.length > 0) {
            const answer = await ask('All active jobs will be stopped.', {
                title: 'Exit',
                kind: 'info',
                okLabel: 'Relaunch',
                cancelLabel: 'Cancel',
            })
            if (!answer) {
                await showDefaultTray()
                return
            }
        }

        await childProcess.kill()

        await new Promise((resolve) => setTimeout(resolve, 1000))

        await relaunch()
    })
    console.log('[startRclone] set listener for relaunch-app')

    await new Promise((resolve) => setTimeout(resolve, 200))

    useStore.setState({ rcloneLoaded: true })

    console.log('[startRclone] listing remotes')
    const remotes = await listRemotes()
    console.log('[startRclone] got remotes')
    useStore.setState({ remotes: remotes })

    // console.log('childProcess', JSON.stringify(childProcess)) // prints `pid`
}

async function startupMounts() {
    const remoteConfigList = usePersistedStore.getState().remoteConfigList
    const remotes = useStore.getState().remotes

    for (const remote in remotes) {
        const remoteConfig = remoteConfigList[remote]
        if (!remoteConfig) continue
        if (remoteConfig.mountOnStart && remoteConfig.defaultMountPoint) {
            try {
                const isEmpty = await isDirectoryEmpty(remoteConfig.defaultMountPoint)
                if (!isEmpty) {
                    continue
                }

                await mountRemote({
                    remotePath: `${remote}:${remoteConfig?.defaultRemotePath || ''}`,
                    mountPoint: remoteConfig.defaultMountPoint,
                    mountOptions: remoteConfig?.mountDefaults,
                    vfsOptions: remoteConfig?.vfsDefaults,
                })
            } catch (error) {
                console.error('Error mounting remote:', error)
                Sentry.captureException(error)
                await message(`Failed to mount ${remote} on startup.`, {
                    title: 'Automount Error',
                    kind: 'error',
                    okLabel: 'Got it',
                })
            }
        }
    }
}

async function onboardUser() {
    const firstOpen = usePersistedStore.getState().isFirstOpen
    if (firstOpen) {
        useStore.setState({ startupStatus: 'initialized' })
        await openSmallWindow({
            name: 'Startup',
            url: '/startup',
        })
        usePersistedStore.setState({ isFirstOpen: false })
    }
}

const MAX_INT_MS = 2_147_483_647
let hasScheduledTasks = false
async function resumeTasks() {
    console.log('resuming tasks')

    if (hasScheduledTasks) {
        return
    }

    const scheduledTasks = usePersistedStore.getState().scheduledTasks
    const activeConfigId = usePersistedStore.getState().activeConfigFile?.id

    if (!activeConfigId) {
        return
    }

    for (const task of scheduledTasks) {
        if (task.isRunning) {
            usePersistedStore.getState().updateScheduledTask(task.id, {
                isRunning: false,
                currentRunId: undefined,
                error: 'Task closed prematurely',
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
                setTimeout(() => {
                    console.log('running task', task)
                    notify({
                        title: 'Task Started',
                        body: `Task ${task.type} (${task.id}) started`,
                    })
                    handleTask(task)
                }, difference)
                console.log('scheduled task', task.type, task.id, nextRun)
            }
        } catch (error) {
            console.error('Error scheduling task:', error)
            Sentry.captureException(error)
        }
    }

    hasScheduledTasks = true
}

async function handleTask(task: ScheduledTask) {
    const currentTask = usePersistedStore.getState().scheduledTasks.find((t) => t.id === task.id)

    if (!currentTask) {
        return
    }

    if (currentTask.isRunning) {
        return
    }

    const freshRunId = crypto.randomUUID()

    usePersistedStore.getState().updateScheduledTask(task.id, {
        isRunning: true,
        currentRunId: freshRunId,
        lastRun: new Date().toISOString(),
    })

    console.log('running task', task.type, task.id)

    const currentRunId = usePersistedStore
        .getState()
        .scheduledTasks.find((t) => t.id === task.id)?.currentRunId

    if (currentRunId !== freshRunId) {
        return
    }

    try {
        const {
            srcFs,
            dstFs,
            _config,
            _filter,
            createEmptySrcDirs,
            deleteEmptyDstDirs,
            fs,
            rmDirs,
            remote,
        } = task.args

        switch (task.type) {
            case 'delete':
                await startDelete({
                    fs,
                    rmDirs,
                    _filter,
                    _config,
                })
                break
            case 'copy':
                await startCopy({
                    srcFs,
                    dstFs,
                    _config,
                    _filter,
                })
                break
            case 'move':
                await startMove({
                    srcFs,
                    dstFs,
                    createEmptySrcDirs,
                    deleteEmptyDstDirs,
                    _config,
                    _filter,
                })
                break
            case 'sync':
                await startSync({
                    srcFs,
                    dstFs,
                    _config,
                    _filter,
                })
                break
            case 'purge':
                await startPurge({
                    fs,
                    remote,
                    _filter,
                    _config,
                })
                break
            default:
                break
        }
    } catch (err) {
        Sentry.captureException(err)
        console.error('Failed to start task:', err)
        usePersistedStore.getState().updateScheduledTask(task.id, {
            isRunning: false,
            currentRunId: undefined,
            error: err instanceof Error ? err.message : 'Unknown error',
        })
    } finally {
    }
}

async function checkVersion() {
    try {
        const metaJson = await fetch(
            'https://raw.githubusercontent.com/rclone-ui/rclone-ui/refs/heads/main/meta.json'
        )
        const metaJsonData = await metaJson.json()

        const { minimumVersion, okVersion } = metaJsonData

        const currentVersion = await getUiVersion()

        if (
            compareVersions(currentVersion, minimumVersion) >= 0 &&
            compareVersions(currentVersion, okVersion) >= 0
        ) {
            return
        }

        const receivedUpdate = await check({
            allowDowngrades: true,
            timeout: 30000,
        })

        if (!receivedUpdate) {
            return
        }

        if (compareVersions(currentVersion, minimumVersion) < 0) {
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
                return await exit(0)
            }

            await receivedUpdate.downloadAndInstall()

            await message('Rclone UI has been updated. Please restart the application.', {
                title: 'Update Complete',
                kind: 'info',
                okLabel: 'Restart',
            })

            await getCurrentWindow().emit('relaunch-app')
        } else if (compareVersions(currentVersion, okVersion) < 0) {
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
                return
            }

            await receivedUpdate.downloadAndInstall()

            await message('Rclone UI has been updated. Please restart the application.', {
                title: 'Update Complete',
                kind: 'info',
                okLabel: 'Restart',
            })

            await getCurrentWindow().emit('relaunch-app')
        }
    } catch {}
}

getCurrentWindow().listen('tauri://close-requested', async (e) => {
    console.log('(main) window close requested')
})

getCurrentWindow().listen('rebuild-tray', async (e) => {
    console.log('(main) window rebuild-tray requested')

    // wait for store to be updated
    await new Promise((resolve) => setTimeout(resolve, 250))

    await showDefaultTray()
})

initTray()
    .then(() => showLoadingTray())
    .then(() => waitForHydration())
    .then(() => checkVersion())
    .then(() => validateInstance())
    .then(() => startRclone())
    .then(() => onboardUser())
    .then(() => startupMounts())
    .then(() => resumeTasks())
    .then(() => showDefaultTray())
    .catch(console.error)
