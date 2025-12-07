import { useQuery } from '@tanstack/react-query'
import { sortByName } from './flags'
import rclone from './rclone/client'
import { SERVE_TYPES } from './rclone/constants'

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
            acc[type] =
                allFlags?.[type] ||
                []
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
