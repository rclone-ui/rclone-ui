import { useQuery } from '@tanstack/react-query'
import { invoke } from '@tauri-apps/api/core'
import { message } from '@tauri-apps/plugin-dialog'
import { useCallback, useMemo } from 'react'
import { getFsInfo } from '../../../lib/format'
import rclone from '../../../lib/rclone/client'
import { supportsPersistentEmptyFolders } from '../../../lib/rclone/constants'
import type { RemoteString } from './types'
import { RE_TRAILING_SEPARATORS } from './utils'

export default function useCreateFolder(
    remote: RemoteString,
    cwd: string,
    refresh: () => void
) {
    const remoteConfigQuery = useQuery({
        queryKey: ['remote', remote, 'config'],
        queryFn: async () => {
            return await rclone('/config/get', {
                params: { query: { name: remote! } },
            })
        },
        enabled: !!remote && remote !== 'UI_LOCAL_FS' && remote !== 'UI_FAVORITES',
    })

    const backendType = useMemo(() => {
        if (!remote || remote === 'UI_FAVORITES') return null
        if (remote === 'UI_LOCAL_FS') return 'local'
        return remoteConfigQuery.data?.type ?? null
    }, [remote, remoteConfigQuery.data])

    const canCreateFolder = useMemo(() => {
        if (!remote || remote === 'UI_FAVORITES') return false
        if (remote === 'UI_LOCAL_FS') return true
        return supportsPersistentEmptyFolders(backendType)
    }, [remote, backendType])

    const createFolder = useCallback(async () => {
        if (!remote || remote === 'UI_FAVORITES') return

        if (!canCreateFolder) {
            await message(
                'This backend does not support persistent empty folders. Create a folder by uploading a file into it.',
                { title: 'Unsupported Backend', kind: 'warning' }
            )
            return
        }

        const folderName = await invoke<string | null>('prompt', {
            title: 'New Folder',
            message: 'Enter a name for the new folder',
            default: 'New Folder',
            sensitive: false,
        })
        const normalizedFolderName = folderName?.trim()
        if (!normalizedFolderName) return

        try {
            const normalizedPath = cwd.replace(RE_TRAILING_SEPARATORS, '')
            const fullTargetPath =
                remote === 'UI_LOCAL_FS'
                    ? `${normalizedPath}${normalizedPath ? '/' : ''}${normalizedFolderName}`
                    : `${remote}:/${normalizedPath}${normalizedPath ? '/' : ''}${normalizedFolderName}`
            const info = getFsInfo(fullTargetPath)

            await rclone('/operations/mkdir' as any, {
                params: {
                    query: {
                        fs: info.root === ':local:' ? ':local:/' : info.root,
                        remote: info.filePath,
                    },
                },
            })

            refresh()
        } catch (error) {
            await message(error instanceof Error ? error.message : 'Create folder failed', {
                title: 'Error',
                kind: 'error',
            })
        }
    }, [remote, cwd, refresh, canCreateFolder])

    return { canCreateFolder, createFolder }
}
