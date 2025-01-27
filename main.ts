import { appLocalDataDir } from '@tauri-apps/api/path'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { confirm, message } from '@tauri-apps/plugin-dialog'
import {} from '@tauri-apps/plugin-fs'
import { debug, error, info, trace, warn } from '@tauri-apps/plugin-log'
import { exit } from '@tauri-apps/plugin-process'
import { Command } from '@tauri-apps/plugin-shell'
import { listRemotes } from './lib/rclone/api'
import { checkRcloneBundled, checkRcloneInstalled, provisionRclone } from './lib/rclone/init'
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
    let hasLocalRclone = false
    try {
        hasLocalRclone = await checkRcloneInstalled()
        console.log('hasLocalRclone', hasLocalRclone)
    } catch (error) {
        console.error('Failed to check if rclone is installed', error)
    }
    console.log('hasLocalRclone', hasLocalRclone)

    let hasBundledRclone = false
    try {
        hasBundledRclone = await checkRcloneBundled()
        console.log('hasBundledRclone', hasBundledRclone)
    } catch (error) {
        console.error('Failed to check if rclone is bundled', error)
    }
    console.log('hasBundledRclone', hasBundledRclone)

    if (!hasLocalRclone && !hasBundledRclone) {
        try {
            await provisionRclone()
        } catch (error) {
            await confirm(error?.message || 'Failed to provision rclone, please try again later.', {
                title: 'Error',
                kind: 'error',
            })
            return await exit(0)
        }
    }

    try {
        const remotes = await listRemotes()
        console.log('rclone rcd already running')
        useStore.setState({ rcloneLoaded: true })
        useStore.setState({ remotes: remotes })
        return
    } catch {}

    //! this works
    // const command = Command.sidecar('binaries/rclone', [
    //     'rcd',
    //     '--rc-no-auth',
    //     '--rc-serve',
    //     // '-rc-addr',
    //     // ':5572',
    // ])

    //! sidecar does not work with global or appdata binaries
    const command = Command.create(
        hasLocalRclone ? 'rclone' : './rclone',
        [
            'rcd',
            '--rc-no-auth',
            '--rc-serve',
            // '-rc-addr',
            // ':5572',
        ],
        hasLocalRclone
            ? undefined
            : {
                  cwd: `${await appLocalDataDir()}`,
              }
    )

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

    //! so we have to do this:
    //! not await the call
    const childProcess = command.execute()

    await new Promise((resolve) => setTimeout(resolve, 200))

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
