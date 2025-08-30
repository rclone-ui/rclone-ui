import * as Sentry from '@sentry/browser'
import { readDir } from '@tauri-apps/plugin-fs'

export async function isDirectoryEmpty(path: string): Promise<boolean> {
    try {
        const entries = await readDir(path)
        return entries.length === 0
    } catch (err) {
        Sentry.captureException(err)
        console.error('Error checking directory:', err)
        return false
    }
}

export function isRemotePath(path: string): boolean {
    return path.includes(':/') && !path.startsWith('/')
}
