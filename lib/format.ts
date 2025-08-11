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

    const lastSegment = path.split('\\').slice(-1).join('').split('/').slice(-1).join('')

    if (type === 'short') {
        return lastSegment
    }

    return `${path.split(':')[0]}:/.../${lastSegment}`
}
