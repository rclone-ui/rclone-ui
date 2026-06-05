import { sep } from '@tauri-apps/api/path'

export function isRemotePath(path: string): boolean {
    return path.includes(':/') && !path.startsWith(sep())
}
