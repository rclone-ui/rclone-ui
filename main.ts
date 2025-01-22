import { getCurrentWindow } from '@tauri-apps/api/window'
import { message } from '@tauri-apps/plugin-dialog'
import { debug, error, info, trace, warn } from '@tauri-apps/plugin-log'
import { exit } from '@tauri-apps/plugin-process'
import { Command } from '@tauri-apps/plugin-shell'
import { listRemotes } from './lib/rclone'
import { useStore } from './lib/store'
import { initLoadingTray, initTray, rebuildTrayMenu } from './lib/tray'

// forward console logs in webviews to the tauri logger, so they show up in the console
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

console.log('main')
console.error('main')

async function startRclone() {
    try {
        const remotes = await listRemotes()
        console.log('rclone already running', remotes)
        useStore.setState({ rcloneLoaded: true })
        useStore.setState({ remotes: remotes })
        return
    } catch (e) {
        console.error('Failed to start rclone', e)
    }

    const command = Command.sidecar('binaries/rclone', [
        'rcd',
        '--rc-no-auth',
        '--rc-serve',
        // '-rc-addr',
        // ':5572',
    ])

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

    // console.log('command', command)

    const childProcess = await command.spawn()

    await new Promise((resolve) => setTimeout(resolve, 100))

    useStore.setState({ rcloneLoaded: true })

    const remotes = await listRemotes()
    console.log('remotes', remotes)
    useStore.setState({ remotes: remotes })

    // console.log('childProcess', JSON.stringify(childProcess)) // prints `pid`

    // console.log('command', JSON.stringify(command))
}

getCurrentWindow().listen('tauri://close-requested', async (e) => {
    console.log('MAIN window close requested')
})

getCurrentWindow().listen('rebuild-tray', async (e) => {
    console.log('MAIN window rebuild-tray requested')
    await rebuildTrayMenu()
})

initLoadingTray()
    .then(() => startRclone())
    .then(() => initTray())

// await initLoadingTray()
// await startRclone()
// await initTray()
