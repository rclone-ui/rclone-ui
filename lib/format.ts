import { sep } from '@tauri-apps/api/path'

const RE_WINDOWS_DRIVE = /^[a-zA-Z]:[/\\]/
const RE_WINDOWS_DRIVE_WITH_SLASH = /^([a-zA-Z]:)\/?/
const RE_LOCAL_WINDOWS_PATH = /^:local:([a-zA-Z]:\/?.*)$/
const RE_PATH_SEPARATOR = /[/\\]/

export function formatBytes(bytes: number) {
    if (bytes < 1024) {
        return `${bytes} B`
    }

    if (bytes < 1024 * 1024) {
        return `${Number.parseFloat((bytes / 1024).toFixed(2))} KB`
    }

    if (bytes < 1024 * 1024 * 1024) {
        return `${Number.parseFloat((bytes / 1024 / 1024).toFixed(2))} MB`
    }

    return `${Number.parseFloat((bytes / 1024 / 1024 / 1024).toFixed(2))} GB`
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
    if (path.startsWith(':local:')) {
        return ':local'
    }
    // Windows drive letter check (C:\, D:/, etc.)
    if (RE_WINDOWS_DRIVE.test(path)) {
        return null
    }
    return path.split(':')[0]
}

export function buildReadablePath(path: string, type: 'short' | 'long' = 'long') {
    console.log('[buildReadablePath] path', path)
    console.log('[buildReadablePath] sep()', sep())

    if (!path) {
        return ''
    }

    const lastSegment = path.split(RE_PATH_SEPARATOR).filter(Boolean).pop()
    console.log('[buildReadablePath] lastSegment', lastSegment)

    if (type === 'short') {
        return lastSegment
    }

    return `${path.split(':')[0]}:/.../${lastSegment}`
}

export function buildReadablePathMultiple(
    paths: string[],
    type: 'short' | 'long',
    truncate: boolean = false
) {
    console.log('[buildReadablePathMultiple] paths', paths)

    if (paths.length < 2) {
        return buildReadablePath(paths[0], type)
    }

    const readablePath = `${buildReadablePath(paths[0], type)} + ${paths.length - 1} more`

    if (truncate) {
        let [start, end] = readablePath.split(' + ')

        if (start.length <= 30) {
            return readablePath
        }

        start = start.slice(0, 47) + '...'

        return `${start} + ${end}`
    }

    return readablePath
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

export function getFsInfo(fs: string, sep = '/') {
    let normalizedFs = fs.replace(/\\/g, '/')

    const localWindowsMatch = normalizedFs.match(RE_LOCAL_WINDOWS_PATH)
    if (localWindowsMatch) {
        normalizedFs = localWindowsMatch[1]
    }

    console.log('[getFsInfo] ', normalizedFs)

    const fsRemote = getRemoteName(normalizedFs)
    console.log('[getFsInfo] ', normalizedFs, 'fsRemote', fsRemote)

    let root: string
    let path: string

    if (fsRemote) {
        root = `${fsRemote}:`
        path = normalizedFs.replace(fsRemote, '').split(':')[1]
    } else {
        const windowsDriveMatch = normalizedFs.match(RE_WINDOWS_DRIVE_WITH_SLASH)
        if (windowsDriveMatch) {
            root = `:local:${windowsDriveMatch[1]}/`
            path = normalizedFs.slice(windowsDriveMatch[0].length)
        } else {
            root = ':local:'
            path = normalizedFs
        }
    }

    console.log('[getFsInfo] ', normalizedFs, 'root', root)
    console.log('[getFsInfo] ', normalizedFs, 'path', path)

    let type = 'file'

    if (normalizedFs.endsWith('/') || normalizedFs.endsWith('\\')) {
        type = 'folder'
    }

    while (path.startsWith('/')) {
        path = path.slice(1)
    }

    while (path.endsWith('/') || path.endsWith('\\')) {
        path = path.slice(0, -1)
    }

    const dirPath = `${path}${sep}`

    const name = path.split('/').pop()!

    console.log('[getFsInfo] ', normalizedFs, 'name', name)
    console.log('[getFsInfo] ', normalizedFs, 'fullFilePath', `${root}${path}`)
    console.log('[getFsInfo] ', normalizedFs, 'fullDirPath', `${root}${dirPath}`)
    console.log('[getFsInfo] ', normalizedFs, 'type', type)
    console.log('[getFsInfo] ', normalizedFs, 'remoteName', fsRemote || ':local')
    console.log('[getFsInfo] ', normalizedFs, 'isRemote', !!fsRemote)
    console.log('[getFsInfo] ', normalizedFs, 'root', root || '/')
    console.log('[getFsInfo] ', normalizedFs, 'filePath', path)
    console.log('[getFsInfo] ', normalizedFs, 'dirPath', dirPath)

    return {
        isRemote: !!fsRemote,
        root,
        filePath: path,
        dirPath,
        fullFilePath: `${root}${path}`,
        fullDirPath: `${root}${dirPath}`,
        name,
        type,
        remoteName: fsRemote || ':local',
    }
}
