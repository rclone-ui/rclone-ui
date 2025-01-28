import { getCurrentWindow } from '@tauri-apps/api/window'
import { confirm, message } from '@tauri-apps/plugin-dialog'
import {} from '@tauri-apps/plugin-fs'
import { debug, error, info, trace, warn } from '@tauri-apps/plugin-log'
import { platform } from '@tauri-apps/plugin-os'
import { exit } from '@tauri-apps/plugin-process'
import { listRemotes } from './lib/rclone/api'
import { initRclone } from './lib/rclone/init'
import { useStore } from './lib/store'
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

async function startRclone() {
    try {
        const remotes = await listRemotes()
        console.log('rclone rcd already running')
        useStore.setState({ rcloneLoaded: true })
        useStore.setState({ remotes: remotes })
        return
    } catch {}

    let rclone

    try {
        rclone = await initRclone()
    } catch (error) {
        await confirm(error.message || 'Failed to provision rclone, please try again later.', {
            title: 'Error',
            kind: 'error',
        })
        return await exit(0)
    }

    const sessionPassword = Math.random().toString(36).substring(2, 15)
    useStore.setState({ rcloneAuth: sessionPassword })
    useStore.setState({ rcloneAuthHeader: 'Basic ' + btoa(`admin:${sessionPassword}`) })

    const rcloneCommandFn = rclone.system || rclone.internal

    const command = await rcloneCommandFn([
        'rcd',
        ...(platform() === 'macos'
            ? ['--rc-no-auth'] // webkit doesn't allow for credentials in the url
            : ['--rc-user', 'admin', '--rc-pass', sessionPassword]),
        '--rc-serve',
        // defaults
        // '-rc-addr',
        // ':5572',
    ])

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

    console.log('running rclone')
    const childProcess = await command.spawn()

    await new Promise((resolve) => setTimeout(resolve, 200))

    useStore.setState({ rcloneLoaded: true })

    const remotes = await listRemotes()
    console.log('remotes', remotes)
    useStore.setState({ remotes: remotes })

    // console.log('childProcess', JSON.stringify(childProcess)) // prints `pid`
}

getCurrentWindow().listen('tauri://close-requested', async (e) => {
    console.log('(main) window close requested')
})

getCurrentWindow().listen('rebuild-tray', async (e) => {
    console.log('(main) window rebuild-tray requested')
    await rebuildTrayMenu()
})

initLoadingTray()
    .then(() => startRclone())
    .then(() => initTray())
    .catch(console.error)
