import { getCurrentWindow } from '@tauri-apps/api/window'
import { ask, message } from '@tauri-apps/plugin-dialog'
import { debug, error, info, trace, warn } from '@tauri-apps/plugin-log'
import { platform } from '@tauri-apps/plugin-os'
import { exit } from '@tauri-apps/plugin-process'
import type { Command } from '@tauri-apps/plugin-shell'
import { validateLicense } from './lib/license'
import { listRemotes, mountRemote, unmountAllRemotes } from './lib/rclone/api'
import { initRclone } from './lib/rclone/init'
import { usePersistedStore, useStore } from './lib/store'
import { initLoadingTray, initTray, rebuildTrayMenu } from './lib/tray'

// forward console logs in webviews to the tauri logger, so they show up in terminal
function forwardConsole(
    fnName: 'log' | 'debug' | 'info' | 'warn' | 'error',
    logger: (message: string) => Promise<void>
) {
    const original = console[fnName]
    console[fnName] = (message, ...args) => {
        original(message, ...args)
        logger(
            `${message} ${args?.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' ')}`
        )
    }
}

forwardConsole('log', trace)
forwardConsole('debug', debug)
forwardConsole('info', info)
forwardConsole('warn', warn)
forwardConsole('error', error)

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
        await ask(
            'You are not connected to the internet. Please check your connection and try again.',
            {
                title: 'Error',
                kind: 'error',
                okLabel: 'Exit',
                cancelLabel: '',
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
        if (e instanceof Error) {
            await ask(e.message, {
                title: 'Error',
                kind: 'error',
                okLabel: 'Exit',
                cancelLabel: '',
            })
            await exit(0)
            return
        }

        await ask('An error occurred while validating your license. Please try again.', {
            title: 'Error',
            kind: 'error',
            okLabel: 'Exit',
            cancelLabel: '',
        })
        await exit(0)
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

    let rclone

    try {
        rclone = await initRclone()
    } catch (error) {
        await ask(error.message || 'Failed to start rclone, please try again later.', {
            title: 'Error',
            kind: 'error',
            okLabel: 'Exit',
            cancelLabel: '',
        })
        return await exit(0)
    }

    const sessionPassword = Math.random().toString(36).substring(2, 15)
    useStore.setState({ rcloneAuth: sessionPassword })
    useStore.setState({ rcloneAuthHeader: 'Basic ' + btoa(`admin:${sessionPassword}`) })

    const rcloneCommandFn = rclone.system || rclone.internal

    const command = (await rcloneCommandFn([
        'rcd',
        // ...(platform() === 'macos'
        //     ? ['--rc-no-auth'] // webkit doesn't allow for credentials in the url
        //     : ['--rc-user', 'admin', '--rc-pass', sessionPassword]),
        '--rc-no-auth',
        '--rc-serve',
        // defaults
        // '-rc-addr',
        // ':5572',
    ])) as Command<string>

    // command.stdout.on('data', (line) => {
    //     console.log('stdout ' + line)
    // })
    // command.stderr.on('data', (line) => {
    //     console.log('stderr ' + line)
    // })

    command.addListener('close', async (event) => {
        console.log('close', event)

        if (event.code === 1 || event.code === 143) {
            await message('Rclone has crashed', {
                title: 'Error',
                kind: 'error',
            })
            await exit(0)
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

        if (rclone.system) {
            const answer = await ask('Unmount all remotes before exiting?', {
                title: 'Exit',
                kind: 'info',
                okLabel: 'Unmount',
                cancelLabel: 'Exit',
            })
            if (answer) {
                await unmountAllRemotes()
            }
        }

        await childProcess.kill()
    })
    console.log('[startRclone] set listener for close-app')

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

    if (!remoteConfigList) {
        return
    }

    for (const remote in remoteConfigList) {
        const remoteConfig = remoteConfigList[remote]
        if (remoteConfig.mountOnStart && remoteConfig.defaultMountPoint) {
            try {
                await mountRemote({
                    remotePath: `${remote}:${remoteConfig?.defaultRemotePath || ''}`,
                    mountPoint: remoteConfig.defaultMountPoint,
                    mountOptions: remoteConfig?.mountDefaults,
                    vfsOptions: remoteConfig?.vfsDefaults,
                })
            } catch (error) {
                console.error('Error mounting remote:', error)
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
        await message('Rclone has initialized, you can now find it in the tray menu!', {
            title: 'Welcome to Rclone UI',
            kind: 'info',
            okLabel: 'Got it',
        })
        usePersistedStore.setState({ isFirstOpen: false })
    }
}
getCurrentWindow().listen('tauri://close-requested', async (e) => {
    console.log('(main) window close requested')
})

getCurrentWindow().listen('rebuild-tray', async (e) => {
    console.log('(main) window rebuild-tray requested')

    // wait for store to be updated
    await new Promise((resolve) => setTimeout(resolve, 250))

    await rebuildTrayMenu()
})

// function handleNetworkStatusChange() {
//     console.log('Network status changed. Online:', navigator.onLine)
//     // rebuildTrayMenu().catch(console.error)
// }

// window.addEventListener('online', handleNetworkStatusChange)
// window.addEventListener('offline', handleNetworkStatusChange)

initLoadingTray()
    .then(() => waitForHydration())
    .then(() => validateInstance())
    .then(() => startRclone())
    .then(() => onboardUser())
    .then(() => startupMounts())
    .then(() => initTray())
    .catch(console.error)
