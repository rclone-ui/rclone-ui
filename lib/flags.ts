import type { FlagValue } from '../types/rclone'
import { SERVE_TYPES } from './rclone/constants'

export const FLAG_CATEGORIES = [
    'copy',
    'sync',
    'config',
    'vfs',
    'filter',
    'mount',
    ...SERVE_TYPES.map((type) => `serve.${type}` as const),
] as const

function returnFlag(
    category: (typeof FLAG_CATEGORIES)[number],
    flag: string
): { category: (typeof FLAG_CATEGORIES)[number]; flag: string } {
    return {
        category,
        flag,
    }
}

export function getFlagCategory(
    flag: string,
    flags: Record<string, { Name: string; Groups?: string }[]>
) {
    console.log('[getFlagCategory] flag', flag)
    const normalizedFlag = (flag.startsWith('--') ? flag.slice(2) : flag).replace(/-/g, '_')

    console.log('[getFlagCategory] normalized flag', normalizedFlag)
    let foundFlag = null

    foundFlag = flags.main.find((f) => f.Name === normalizedFlag)

    if (foundFlag) {
        if (foundFlag.Groups?.includes('Copy')) {
            return returnFlag('copy', normalizedFlag)
        }
        if (foundFlag.Groups?.includes('Sync')) {
            return returnFlag('sync', normalizedFlag)
        }
        return returnFlag('config', normalizedFlag)
    }

    foundFlag = flags.vfs.find((f) => f.Name === normalizedFlag)
    if (foundFlag) {
        return returnFlag('vfs', normalizedFlag)
    }

    foundFlag = flags.filter.find((f) => f.Name === normalizedFlag)
    if (foundFlag) {
        return returnFlag('filter', normalizedFlag)
    }

    foundFlag = flags.mount.find((f) => f.Name === normalizedFlag)
    if (foundFlag) {
        return returnFlag('mount', normalizedFlag)
    }

    for (const serveType of SERVE_TYPES) {
        foundFlag = flags[serveType].find((f) => f.Name === normalizedFlag)
        if (foundFlag) {
            return returnFlag(`serve.${serveType}`, normalizedFlag)
        }
    }

    return null
}

export function sortByName(flag1: { Name: string }, flag2: { Name: string }) {
    return flag1.Name.localeCompare(flag2.Name)
}

export const getOptionsSubtitle = (count: number) =>
    count > 0 ? `${count} option${count !== 1 ? 's' : ''} set` : undefined

export const getJsonKeyCount = (json: string) => {
    try {
        const parsed = JSON.parse(json) as Record<string, unknown>
        return Object.keys(parsed).length
    } catch {
        return 0
    }
}

export function groupByCategory(
    flags: Record<string, FlagValue>,
    allFlags: Record<string, { Name: string; Groups?: string }[]>
) {
    const collectedFlags = {
        mount: {} as Record<string, FlagValue>,
        config: {} as Record<string, FlagValue>,
        vfs: {} as Record<string, FlagValue>,
        filter: {} as Record<string, FlagValue>,
        copy: {} as Record<string, FlagValue>,
        sync: {} as Record<string, FlagValue>,
        serve: {
            ...SERVE_TYPES.reduce(
                (acc, type) => {
                    acc[type] = {}
                    return acc
                },
                {} as Record<(typeof SERVE_TYPES)[number], Record<string, FlagValue>>
            ),
        },
    }

    for (const [k, v] of Object.entries(flags)) {
        const category = getFlagCategory(k, allFlags)
        if (!category) continue
        if (category.category.startsWith('serve.')) {
            const serveType = category.category.slice(5) as (typeof SERVE_TYPES)[number]
            collectedFlags.serve[serveType] = {
                ...collectedFlags.serve[serveType],
                [k]: v,
            }
            continue
        }
        collectedFlags[category.category as keyof Omit<typeof collectedFlags, 'serve'>] = {
            ...collectedFlags[category.category as keyof Omit<typeof collectedFlags, 'serve'>],
            [k]: v,
        }
    }

    return collectedFlags
}
