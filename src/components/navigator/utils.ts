import { dirname, join, sep } from '@tauri-apps/api/path'
import { readDir } from '@tauri-apps/plugin-fs'
import type { LucideIcon } from 'lucide-react'
import {
    DownloadIcon,
    FileTextIcon,
    HardDriveIcon,
    HouseIcon,
    MonitorIcon,
    UsbIcon,
} from 'lucide-react'
import { createRef } from 'react'
import rclone from '../../../lib/rclone/client.ts'
import type { SelectItem } from './types'

export const dragStateRef = createRef<SelectItem[] | null>() as { current: SelectItem[] | null }
dragStateRef.current = null

export const dropTargetsRef = createRef<
    Map<
        string,
        {
            element: HTMLElement
            onDrop: (items: SelectItem[], destination: string) => void
            getDestination: () => string
        }
    >
>() as {
    current: Map<
        string,
        {
            element: HTMLElement
            onDrop: (items: SelectItem[], destination: string) => void
            getDestination: () => string
        }
    >
}
dropTargetsRef.current = new Map()

export const RE_BACKSLASH = /\\/g
export const RE_TRAILING_SLASH = /\/+$/g
export const RE_LEADING_SLASH = /^\/+/
export const RE_PATH_SEPARATOR = /[/\\]/
export const RE_TRAILING_SEPARATORS = /[\\/]+$/

export const VIRTUAL_PADDING_COUNT = 2

export function log(msg: string, ...args: any[]) {
    console.log(`[Navigator] ${msg}`, ...args)
}

export async function joinLocal(base: string, name: string) {
    if (!base) return join(sep(), name)
    return join(base, name)
}

export async function getLocalParent(path: string) {
    if (!path) return ''
    return dirname(path)
}

export function getRemoteParent(path: string) {
    if (!path) return ''
    const parts = path.split('/').filter(Boolean)
    if (parts.length === 0) return ''
    return parts.slice(0, -1).join('/')
}

export function serializeRemotePath(remote: string, relPath: string) {
    return `${remote}:/${relPath}`
}

export function cacheKey(remote: string | 'UI_LOCAL_FS' | null, dir: string) {
    return `${remote ?? 'NONE'}::${dir || '/'}`
}

export function normalizeRemoteDir(path: string) {
    if (!path) return ''
    const cleaned = path.replace(RE_BACKSLASH, '/').replace(RE_TRAILING_SLASH, '')
    return cleaned
}

export async function listRemotePath(
    remote: string,
    dir: string,
    options: { noModTime?: boolean; noMimeType?: boolean }
) {
    const base = normalizeRemoteDir(dir)
    const slashed = base ? `${base}/` : ''
    log('listRemotePath', { remote, dir, base, slashed, options })

    const tasks: Promise<any>[] = []

    const p1 = {
        fs: `${remote}:`,
        remote: base,
        ...options,
    }
    log('listRemotePath: rclone call 1 params', p1)
    tasks.push(
        rclone('/operations/list', {
            params: {
                query: p1,
            },
        })
    )

    if (slashed) {
        const p2 = {
            fs: `${remote}:`,
            remote: slashed,
            ...options,
        }
        log('listRemotePath: rclone call 2 params', p2)
        tasks.push(
            rclone('/operations/list', {
                params: {
                    query: p2,
                },
            })
        )
    }
    const settled = await Promise.allSettled(tasks)
    log('listRemotePath: settled', settled)

    const merged: any[] = []
    let anyFulfilled = false
    for (let i = 0; i < settled.length; i++) {
        const r = settled[i]
        if (r.status === 'fulfilled') {
            const list = Array.isArray(r.value) ? r.value : r.value?.list

            if (Array.isArray(list)) {
                anyFulfilled = true
                for (let j = 0; j < list.length; j++) {
                    merged.push(list[j])
                }
            }
        }
    }
    if (!anyFulfilled) {
        log('listRemotePath: no successful tasks')
        throw new Error('No access or folder does not exist')
    }
    const seen = new Set<string>()
    const deduped: any[] = []
    for (let i = 0; i < merged.length; i++) {
        const it = merged[i]
        const k = (it && (it.Path || it.Name)) || ''
        if (!k) continue
        if (seen.has(k)) continue
        seen.add(k)
        deduped.push(it)
    }
    log('listRemotePath: result count', deduped.length)
    return { list: deduped, baseDir: base }
}

export async function listLocalPath(dir: string) {
    log('listLocalPath', { dir })
    const entries = await readDir(dir)
    log('listLocalPath: entries', entries.length)
    return entries
}

export function parseRemotePath(fullPath: string): { remote: string | null; path: string } {
    if (fullPath.includes(':/')) {
        const [remote, ...rest] = fullPath.split(':/')
        return { remote, path: rest.join('/') }
    }
    return { remote: null, path: fullPath }
}

export function getPathSegments(path: string): string[] {
    if (!path) return []
    return path.replace(RE_BACKSLASH, '/').split('/').filter(Boolean)
}

export function buildPathFromSegments(segments: string[], upToIndex: number): string {
    return segments.slice(0, upToIndex + 1).join('/')
}

export function getFileExtension(filename: string): string {
    const lastDot = filename.lastIndexOf('.')
    if (lastDot === -1 || lastDot === 0) return ''
    return filename.slice(lastDot + 1).toLowerCase()
}

export function getDiskLabel(disk: string): string {
    const last = disk.split(/[/\\]/).filter(Boolean).pop()
    return last ?? disk
}

const SHOWN_DISKS = new Set(['desktop', 'documents', 'downloads'])

export function shouldShowDisk(disk: string): boolean {
    if (disk === '/' || /^[A-Z]:[\\/]?$/i.test(disk)) return true
    const last = disk.split(/[/\\]/).filter(Boolean).pop()?.toLowerCase()
    if (last && SHOWN_DISKS.has(last)) return true
    // Home folder: parent is a known users directory
    if (/[\\/](?:Users|home)[\\/][^/\\]+\/?$/i.test(disk)) return true
    // USB / external volumes
    if (/[\\/](?:media|Volumes|mnt)[\\/]/i.test(disk)) return true
    return false
}

export function getDiskIcon(disk: string): { icon: LucideIcon; className: string } {
    const last = disk.split(/[/\\]/).filter(Boolean).pop()?.toLowerCase()
    switch (last) {
        case 'desktop':
            return { icon: MonitorIcon, className: 'text-sky-400' }
        case 'documents':
            return { icon: FileTextIcon, className: 'text-blue-400' }
        case 'downloads':
            return { icon: DownloadIcon, className: 'text-green-400' }
    }
    if (disk === '/' || /^[A-Z]:[\\/]?$/i.test(disk))
        return { icon: HardDriveIcon, className: 'text-zinc-400' }
    if (/[\\/](?:media|Volumes|mnt)[\\/]/i.test(disk))
        return { icon: UsbIcon, className: 'text-orange-400' }
    return { icon: HouseIcon, className: 'text-amber-400' }
}

export function formatModTime(modTime: string | undefined): string {
    if (!modTime) return '—'
    try {
        const date = new Date(modTime)
        return date.toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
        })
    } catch {
        return modTime
    }
}
