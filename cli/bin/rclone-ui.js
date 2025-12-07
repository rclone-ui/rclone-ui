#!/usr/bin/env node

import readline from 'node:readline'
import { isInstalled } from '../lib/detect.js'
import { download, install } from '../lib/install.js'
import { openApp } from '../lib/open.js'
import { getLatestVersion } from '../lib/platform.js'

function waitForEnter(prompt) {
    return new Promise((resolve) => {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        })

        rl.question(prompt, () => {
            rl.close()
            resolve()
        })
    })
}

function clearLine() {
    process.stdout.write('\r\x1b[K')
}

function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

async function main() {
    const args = process.argv.slice(2)

    // Handle --version
    if (args.includes('--version') || args.includes('-v')) {
        const version = await getLatestVersion()
        console.log(`rclone-ui v${version} (latest)`)
        process.exit(0)
    }

    // Handle --help
    if (args.includes('--help') || args.includes('-h')) {
        console.log(`
rclone-ui - The GUI for rclone

Usage:
  npx rclone-ui              Open Rclone UI (installs if not found)
  npx rclone-ui --install    Reinstall (or update)
  npx rclone-ui --version    Show version
  npx rclone-ui --help       Show this help

More info: https://rcloneui.com
`)
        process.exit(0)
    }

    const forceInstall = args.includes('--install')

    // Check if already installed
    if (isInstalled() && !forceInstall) {
        console.log('Opening Rclone UI...')
        try {
            await openApp()
            process.exit(0)
        } catch (err) {
            console.error('Failed to open Rclone UI:', err.message)
            process.exit(1)
        }
    }

    // Not installed - prompt for installation
    console.log('')
    await waitForEnter(
        'Rclone UI is not installed. Press Enter to install the latest release from GitHub...'
    )
    console.log('')

    // Download
    process.stdout.write('Downloading...')
    let installerPath
    try {
        installerPath = await download((downloaded, total) => {
            clearLine()
            const percent = Math.round((downloaded / total) * 100)
            const downloadedStr = formatBytes(downloaded)
            const totalStr = formatBytes(total)
            process.stdout.write(`Downloading... ${percent}% (${downloadedStr} / ${totalStr})`)
        })
        clearLine()
        console.log('Downloading... Done!')
    } catch (err) {
        clearLine()
        console.error('Download failed:', err.message)
        process.exit(1)
    }

    // Install
    console.log('Installing...')
    try {
        await install(installerPath)
        console.log('Installing... Done!')
    } catch (err) {
        console.error('Installation failed:', err.message)
        console.error('You may need to run with elevated permissions (sudo on macOS/Linux).')
        process.exit(1)
    }

    console.log('')
    await waitForEnter('Installed! Press Enter to run Rclone UI...')

    try {
        await openApp()
    } catch (err) {
        console.error('Failed to open Rclone UI:', err.message)
        process.exit(1)
    }
}

main().catch((err) => {
    console.error('Error:', err.message)
    process.exit(1)
})
