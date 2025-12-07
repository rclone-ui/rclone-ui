import https from 'node:https'
import os from 'node:os'

const GITHUB_REPO = 'rclone-ui/rclone-ui'

export function getLatestVersion() {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'api.github.com',
            path: `/repos/${GITHUB_REPO}/releases/latest`,
            headers: { 'User-Agent': 'rclone-ui-npm' },
        }

        https
            .get(options, (res) => {
                let data = ''
                res.on('data', (chunk) => (data += chunk))
                res.on('end', () => {
                    try {
                        const release = JSON.parse(data)
                        const version = release.tag_name?.replace(/^v/, '') || 'unknown'
                        resolve(version)
                    } catch {
                        resolve('unknown')
                    }
                })
            })
            .on('error', () => resolve('unknown'))
    })
}

export function getPlatform() {
    const platform = os.platform()
    const arch = os.arch()

    return {
        os: platform,
        arch: arch,
        isWindows: platform === 'win32',
        isMac: platform === 'darwin',
        isLinux: platform === 'linux',
        isArm: arch === 'arm64',
        isX64: arch === 'x64',
    }
}

export function getDownloadUrl(version = 'latest') {
    const { os: platform, arch } = getPlatform()
    const tag = version === 'latest' ? 'latest/download' : `download/v${version}`
    const base = `https://github.com/${GITHUB_REPO}/releases/${tag}`

    // Map platform + arch to release filename
    if (platform === 'darwin') {
        // macOS
        const archSuffix = arch === 'arm64' ? 'aarch64' : 'x64'
        return {
            url: `${base}/Rclone.UI_${archSuffix}.dmg`,
            filename: `Rclone.UI_${archSuffix}.dmg`,
            type: 'dmg',
        }
    }

    if (platform === 'win32') {
        // Windows
        const archSuffix = arch === 'arm64' ? 'arm64' : 'x64'
        return {
            url: `${base}/Rclone.UI_${archSuffix}.exe`,
            filename: `Rclone.UI_${archSuffix}.exe`,
            type: 'exe',
        }
    }

    if (platform === 'linux') {
        // Linux - prefer AppImage for portability
        const archSuffix = arch === 'arm64' ? 'aarch64' : 'amd64'
        return {
            url: `${base}/Rclone.UI_${archSuffix}.AppImage`,
            filename: `Rclone.UI_${archSuffix}.AppImage`,
            type: 'appimage',
        }
    }

    throw new Error(`Unsupported platform: ${platform} ${arch}`)
}

export function getAppName() {
    const { isMac } = getPlatform()
    return isMac ? 'Rclone UI.app' : 'Rclone UI'
}
