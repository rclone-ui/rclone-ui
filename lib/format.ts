import { sep } from '@tauri-apps/api/path'

export function formatBytes(bytes: number) {
    if (bytes < 1024) {
        return `${bytes} B`
    }

    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(2)} KB`
    }

    if (bytes < 1024 * 1024 * 1024) {
        return `${(bytes / 1024 / 1024).toFixed(2)} MB`
    }

    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

export function replaceSmartQuotes(value: string) {
    const replacements: { [key: string]: string } = {
        '‘': "'",
        '’': "'",
        '‚': "'",
        '“': '"',
        '”': '"',
        '„': '"',
    }
    return value.replace(/[‘’‚“”„]/g, (match) => replacements[match])
}

export function getRemoteName(path?: string) {
    if (!path?.includes(':')) return null // Return null for local paths
    return path.split(':')[0]
}

export function buildReadablePath(path: string, type: 'short' | 'long' = 'long') {
    if (!path) {
        return ''
    }

    const lastSegment = path.split(sep()).slice(-1).join('')

    if (type === 'short') {
        return lastSegment
    }

    return `${path.split(':')[0]}:/.../${lastSegment}`
}

export function getConfigParentFolder(path: string) {
    console.log('[getConfigParentFolder] path', path)
    if (path.endsWith('\\rclone.conf')) {
        console.log('[getConfigParentFolder] path ends with \\rclone.conf')
        return path.slice(0, -11)
    }

    if (path.endsWith('/rclone.conf')) {
        console.log('[getConfigParentFolder] path ends with /rclone.conf')
        return path.slice(0, -11)
    }

    console.log('[getConfigParentFolder] path does not end with \\rclone.conf or /rclone.conf')
    return path
}
