import { execSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import https from 'node:https'
import os from 'node:os'
import path from 'node:path'
import { getDownloadUrl, getPlatform } from './platform.js'

function followRedirects(url, callback) {
    https.get(url, (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
            followRedirects(response.headers.location, callback)
        } else {
            callback(response)
        }
    })
}

export function download(onProgress) {
    return new Promise((resolve, reject) => {
        const { url, filename } = getDownloadUrl()
        const tempDir = os.tmpdir()
        const filePath = path.join(tempDir, filename)

        followRedirects(url, (response) => {
            if (response.statusCode !== 200) {
                reject(new Error(`Failed to download: ${response.statusCode}`))
                return
            }

            const totalSize = Number.parseInt(response.headers['content-length'], 10)
            let downloadedSize = 0

            const file = fs.createWriteStream(filePath)

            response.on('data', (chunk) => {
                downloadedSize += chunk.length
                if (onProgress && totalSize) {
                    onProgress(downloadedSize, totalSize)
                }
            })

            response.pipe(file)

            file.on('finish', () => {
                file.close()
                resolve(filePath)
            })

            file.on('error', (err) => {
                fs.unlink(filePath, () => {})
                reject(err)
            })
        })
    })
}

export async function install(installerPath) {
    const { isMac, isWindows, isLinux } = getPlatform()
    const { type } = getDownloadUrl()

    if (isMac && type === 'dmg') {
        return installMacDmg(installerPath)
    }

    if (isWindows && type === 'exe') {
        return installWindowsExe(installerPath)
    }

    if (isLinux && type === 'appimage') {
        return installLinuxAppImage(installerPath)
    }

    throw new Error(`Unsupported installer type: ${type}`)
}

async function installMacDmg(dmgPath) {
    // Mount the DMG
    const mountOutput = execSync(`hdiutil attach -nobrowse -readonly "${dmgPath}"`, {
        encoding: 'utf-8',
    })

    // Parse mount point from output
    const mountMatch = mountOutput.match(/\/Volumes\/[^\n]+/)
    if (!mountMatch) {
        throw new Error('Failed to mount DMG')
    }
    const mountPoint = mountMatch[0].trim()

    try {
        // Find the .app in the mounted volume
        const apps = fs.readdirSync(mountPoint).filter((f) => f.endsWith('.app'))
        if (apps.length === 0) {
            throw new Error('No .app found in DMG')
        }

        const appName = apps[0]
        const sourcePath = path.join(mountPoint, appName)
        const destPath = path.join('/Applications', appName)

        // Remove existing installation if present
        if (fs.existsSync(destPath)) {
            fs.rmSync(destPath, { recursive: true, force: true })
        }

        // Copy to Applications
        execSync(`cp -R "${sourcePath}" "/Applications/"`, { encoding: 'utf-8' })
    } finally {
        // Unmount the DMG
        try {
            execSync(`hdiutil detach "${mountPoint}" -quiet`, { encoding: 'utf-8' })
        } catch {
            // Ignore unmount errors
        }
    }
}

async function installWindowsExe(exePath) {
    return new Promise((resolve, reject) => {
        // Run NSIS installer with /S for silent mode
        const child = spawn(exePath, ['/S'], {
            stdio: 'ignore',
            shell: true,
        })

        child.on('error', reject)
        child.on('close', (code) => {
            if (code === 0) {
                resolve()
            } else {
                reject(new Error(`Installer exited with code ${code}`))
            }
        })
    })
}

async function installLinuxAppImage(appImagePath) {
    const homeDir = os.homedir()
    const binDir = path.join(homeDir, '.local', 'bin')
    const destPath = path.join(binDir, 'rclone-ui')

    // Ensure ~/.local/bin exists
    fs.mkdirSync(binDir, { recursive: true })

    // Copy AppImage to destination
    fs.copyFileSync(appImagePath, destPath)

    // Make executable
    fs.chmodSync(destPath, 0o755)

    // Create .desktop file for application menu
    const desktopDir = path.join(homeDir, '.local', 'share', 'applications')
    fs.mkdirSync(desktopDir, { recursive: true })

    const desktopEntry = `[Desktop Entry]
Name=Rclone UI
Exec=${destPath}
Type=Application
Categories=Utility;
Comment=The GUI for rclone
`

    fs.writeFileSync(path.join(desktopDir, 'rclone-ui.desktop'), desktopEntry)
}
