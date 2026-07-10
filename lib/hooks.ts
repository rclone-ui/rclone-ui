import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { sortByName } from './flags'
import rclone from './rclone/client'
import { SERVE_TYPES } from './rclone/constants'

// Wall-clock tick for values derived from "now" (relative timestamps, next cron occurrences).
// Memoizing such values without a time dep freezes them at their last dep change. Pass null to
// pause (e.g. while a drawer is closed); re-arming refreshes immediately.
export function useNow(intervalMs: number | null = 30_000): number {
    const [now, setNow] = useState(() => Date.now())

    useEffect(() => {
        if (intervalMs === null) {
            return
        }
        setNow(Date.now())
        const id = setInterval(() => setNow(Date.now()), intervalMs)
        return () => clearInterval(id)
    }, [intervalMs])

    return now
}

// Shared query options for a remote's `/config/get`. No default staleTime: most consumers rely on
// staleTime-0 refetch-on-mount for cross-window freshness (each webview has its own QueryClient);
// the handful that want caching spread `staleTime` per-site.
export function remoteConfigQueryOptions(remote: string | undefined | null) {
    return {
        queryKey: ['remote', remote, 'config'] as const,
        queryFn: () => rclone('/config/get', { params: { query: { name: remote! } } }),
        enabled: !!remote && remote !== 'UI_LOCAL_FS' && remote !== 'UI_FAVORITES',
    }
}

export function useRemoteConfig(remote: string | undefined | null) {
    return useQuery(remoteConfigQueryOptions(remote))
}

export function useFlags() {
    const allFlagsQuery = useQuery({
        queryKey: ['options', 'all'],
        queryFn: async () => await rclone('/options/info'),
    })

    const globalFlagsQuery = useQuery({
        queryKey: ['options', 'global'],
        queryFn: async () => await rclone('/options/get'),
    })

    const globalFlags = globalFlagsQuery.data
    const allFlags = allFlagsQuery.data

    const filterFlags = allFlags?.filter
        .filter((flag) => !flag.Groups?.includes('Metadata'))
        .sort(sortByName)

    const configFlags = allFlags?.main
        .filter(
            (flag) =>
                flag.Groups?.includes('Performance') ||
                flag.Groups?.includes('Listing') ||
                flag.Groups?.includes('Networking') ||
                flag.Groups?.includes('Check') ||
                flag.Name === 'use_server_modtime'
        )
        .sort(sortByName)

    const mountFlags = allFlags?.mount
        .filter((flag) => !flag.Groups?.includes('Metadata'))
        .sort(sortByName)

    const vfsFlags = allFlags?.vfs
        .filter((flag) => !flag.Groups?.includes('Metadata'))
        .sort(sortByName)

    const copyFlags = allFlags?.main
        .filter((flag) => flag.Groups?.includes('Copy'))
        .sort(sortByName)

    const syncFlags = allFlags?.main
        .filter((flag) => flag.Groups?.includes('Copy') || flag.Groups?.includes('Sync'))
        .sort(sortByName)

    const serveFlags = SERVE_TYPES.reduce(
        (acc, type) => {
            acc[type] = (allFlags?.[type] || [])
                .map((flag: any) => ({
                    ...flag,
                    FieldName: flag.Name,
                    DefaultStr:
                        flag.Name === 'addr'
                            ? flag.DefaultStr.replace('[', '').replace(']', '')
                            : flag.DefaultStr,
                }))
                .sort((a: any, b: any) => a.Name.localeCompare(b.Name))
            return acc
        },
        {} as Record<(typeof SERVE_TYPES)[number], any[]>
    )

    return {
        allFlags,
        globalFlags,
        filterFlags,
        configFlags,
        mountFlags,
        vfsFlags,
        copyFlags,
        syncFlags,
        serveFlags,
    }
}
