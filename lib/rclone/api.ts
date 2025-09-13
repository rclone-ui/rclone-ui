import * as Sentry from '@sentry/browser'
import { fetch } from '@tauri-apps/plugin-http'
import { platform } from '@tauri-apps/plugin-os'
import { useStore } from '../store'
import { parseRcloneOptions } from './common'

/* UTILS */
const SUPPORTED_BACKENDS = [
    'sftp',
    's3',
    'b2',
    'drive',
    'dropbox',
    'ftp',
    'azurefiles',
    'azureblob',
    'gcs',
    'protondrive',
    'box',
    'webdav',
    'onedrive',
]

function getAuthHeader() {
    return

    // biome-ignore lint/correctness/noUnreachable: <explanation>
    if (platform() === 'macos') {
        return
    }

    const state = useStore.getState()

    if (!state.rcloneAuthHeader) {
        throw new Error('Rclone auth header is not set')
    }

    return { Authorization: state.rcloneAuthHeader }
}

/* DATA */
export async function getVersion() {
    console.log('[getVersion]')

    const r = await fetch('http://localhost:5572/core/version', {
        method: 'POST',
        headers: getAuthHeader(),
    })
        .catch((e) => {
            Sentry.captureException(e)
            console.log('error', e)
            throw e
        })
        .then(
            (res) =>
                res.json() as Promise<{
                    version: `v${string}`
                    decomposed: [number, number, number]
                    isGit: boolean
                    isBeta: boolean
                    os: string
                    arch: string
                    goVersion: string
                    linking: string
                    goTags: string
                }>
        )

    console.log('[getVersion] r', r)

    return r
}

export async function listRemotes() {
    console.log('[listRemotes]')

    const r = await fetch('http://localhost:5572/config/listremotes', {
        method: 'POST',
        headers: getAuthHeader(),
    })
        .catch((e) => {
            Sentry.captureException(e)
            console.log('error', e)
            throw e
        })
        .then((res) => res.json() as Promise<{ remotes: string[] }>)

    if (typeof r?.remotes === 'undefined') {
        throw new Error('Failed to fetch remotes')
    }

    return r.remotes || []
}

export async function getRemote(remote: string) {
    console.log('[getRemote]', remote)

    const r = await fetch(`http://localhost:5572/config/get?name=${remote}`, {
        method: 'POST',
        headers: getAuthHeader(),
    }).then(
        (res) => res.json() as Promise<{ type: string } & Record<string, string | number | boolean>>
    )

    // console.log(JSON.stringify(r, null, 2))

    return r
}

export async function updateRemote(
    remote: string,
    parameters: Record<string, string | number | boolean>
) {
    console.log('[updateRemote]', remote, parameters)

    const options = new URLSearchParams()
    options.set('name', remote)
    options.set('parameters', JSON.stringify(parameters))

    await fetch(`http://localhost:5572/config/update?${options.toString()}`, {
        method: 'POST',
        headers: getAuthHeader(),
    })

    // console.log(JSON.stringify(r, null, 2))
}

export async function createRemote(
    name: string,
    type: string,
    parameters: Record<string, string | number | boolean>
) {
    console.log('[createRemote]', name, type, parameters)

    const options = new URLSearchParams()
    options.set('name', name)
    options.set('type', type)
    options.set('parameters', JSON.stringify(parameters))

    await fetch(`http://localhost:5572/config/create?${options.toString()}`, {
        method: 'POST',
        headers: getAuthHeader(),
    })

    // console.log(JSON.stringify(r, null, 2))
}

export async function deleteRemote(remote: string) {
    console.log('[deleteRemote]', remote)

    await fetch(`http://localhost:5572/config/delete?name=${remote}`, {
        method: 'POST',
        headers: getAuthHeader(),
    })

    // console.log(JSON.stringify(r, null, 2))
}

export async function cleanupRemote(remote: string) {
    console.log('[cleanupRemote]', remote)

    const r = await fetch(`http://localhost:5572/operations/cleanup?fs=${remote}&_async=true`, {
        method: 'POST',
        headers: getAuthHeader(),
    })

    if (!r.ok) {
        throw new Error('Failed to start cleanup job')
    }

    // console.log(JSON.stringify(r, null, 2))
}

export async function listMounts() {
    console.log('[listMounts]')

    const r = await fetch('http://localhost:5572/mount/listmounts', {
        method: 'POST',
        headers: getAuthHeader(),
    }).then(
        (res) =>
            res.json() as Promise<{
                mountPoints: {
                    Fs: string
                    MountPoint: string
                    MountedOn: string
                }[]
            }>
    )

    if (!Array.isArray(r?.mountPoints)) {
        throw new Error('Failed to get mount points')
    }

    return r.mountPoints
}

export async function getBackends() {
    console.log('[getBackends]')

    const providers = await fetch('http://localhost:5572/config/providers', {
        method: 'POST',
        headers: getAuthHeader(),
    })
        .then((res) => res.json() as Promise<any>)
        .then((r) => r.providers)

    return providers.filter((b: any) => SUPPORTED_BACKENDS.includes(b.Prefix))
}

export interface ListOptions {
    recurse?: boolean
    noModTime?: boolean
    showEncrypted?: boolean
    showOrigIDs?: boolean
    showHash?: boolean
    noMimeType?: boolean
    dirsOnly?: boolean
    filesOnly?: boolean
    metadata?: boolean
    hashTypes?: string[]
}

export async function listPath(remote: string, path: string = '', options: ListOptions = {}) {
    console.log('[listPath]', remote, path, options)

    const params = new URLSearchParams()
    params.set('fs', `${remote}:`)
    params.set('remote', path)

    // Add optional parameters
    for (const [key, value] of Object.entries(options)) {
        if (Array.isArray(value)) {
            for (const v of value) {
                params.append(key, v)
            }
        } else if (value !== undefined) {
            params.set(key, value.toString())
        }
    }

    const response = await fetch(`http://localhost:5572/operations/list?${params.toString()}`, {
        method: 'POST',
        headers: getAuthHeader(),
    }).then(
        (res) =>
            res.json() as Promise<{
                list: {
                    Hashes?: Record<string, string>
                    ID?: string
                    OrigID?: string
                    IsBucket?: boolean
                    IsDir: boolean
                    MimeType?: string
                    ModTime?: string
                    Name: string
                    Encrypted?: string
                    EncryptedPath?: string
                    Path: string
                    Size?: number
                    Tier?: string
                }[]
            }>
    )

    return response?.list || []
}

/* JOBS */
export async function listJobs() {
    console.log('[listJobs]')

    const allStats = await fetch('http://localhost:5572/core/stats', {
        method: 'POST',
        headers: getAuthHeader(),
    }).then((res) => res.json() as any)

    const transferring = allStats?.transferring

    const transferredStats = await fetch('http://localhost:5572/core/transferred', {
        method: 'POST',
        headers: getAuthHeader(),
    }).then((res) => res.json() as any)

    const transferred = transferredStats?.transferred

    const jobs = {
        active: [] as any[],
        inactive: [] as any[],
    }

    const activeJobIds = new Set(
        transferring
            ?.filter((t: any) => t.group.startsWith('job/'))
            .map((t: any) => Number(t.group.split('/')[1]))
            .sort((a: number, b: number) => a - b)
    )
    console.log('[listJobs] activeJobIds', activeJobIds.size)

    const isWindows = platform() === 'windows'
    console.log('[listJobs] isWindows', isWindows)

    for (const jobId of activeJobIds) {
        const job = await fetch(`http://localhost:5572/core/stats?group=job/${jobId}`, {
            method: 'POST',
            headers: getAuthHeader(),
        }).then((res) => res.json() as Promise<any>)

        const srcFs = transferred.find((t: any) => t.group === `job/${jobId}`)?.srcFs
        const dstFs = transferred.find((t: any) => t.group === `job/${jobId}`)?.dstFs

        if (!srcFs) {
            console.log('[listJobs] srcFs not found', jobId)
            continue
        }

        jobs.active.push({
            id: jobId,
            bytes: job.bytes,
            totalBytes: job.totalBytes,
            speed: job.speed,

            done: job.bytes === job.totalBytes,
            progress: Math.round((job.bytes / job.totalBytes) * 100),
            fatal: job.fatalError,

            srcFs: isWindows ? srcFs.replace(/^(\/\/\?\/|\\\\\?\\)/, '') : srcFs,
            dstFs: isWindows ? dstFs.replace(/^(\/\/\?\/|\\\\\?\\)/, '') : dstFs,
        })
    }

    const inactiveJobIds = new Set(
        transferred
            ?.filter((t: any) => t.group.startsWith('job/'))
            .map((t: any) => Number(t.group.split('/')[1]))
            .filter((id: number) => !activeJobIds.has(id))
            .sort((a: number, b: number) => a - b)
    )

    for (const jobId of inactiveJobIds) {
        const job = await fetch(`http://localhost:5572/core/stats?group=job/${jobId}`, {
            method: 'POST',
            headers: getAuthHeader(),
        }).then((res) => res.json() as Promise<any>)

        const srcFs = transferred.find((t: any) => t.group === `job/${jobId}`)?.srcFs
        const dstFs = transferred.find((t: any) => t.group === `job/${jobId}`)?.dstFs

        if (!srcFs) {
            console.log('[listJobs] srcFs not found', jobId)
            continue
        }

        jobs.inactive.push({
            id: jobId,
            bytes: job.bytes,
            totalBytes: job.totalBytes,
            speed: 0,

            done: job.bytes === job.totalBytes,
            progress: Math.round((job.bytes / job.totalBytes) * 100),
            fatal: job.fatalError,

            srcFs: isWindows ? srcFs.replace(/^(\/\/\?\/|\\\\\?\\)/, '') : srcFs,
            dstFs: isWindows ? dstFs.replace(/^(\/\/\?\/|\\\\\?\\)/, '') : dstFs,
        })
    }

    return jobs
}

export async function stopJob(jobId: number) {
    console.log('[stopJob]', jobId)

    await fetch(`http://localhost:5572/job/stopgroup?group=job/${jobId}`, {
        method: 'POST',
        headers: getAuthHeader(),
    })
}

/* OPERATIONS */
export async function mountRemote({
    remotePath,
    mountPoint,
    mountOptions,
    vfsOptions,
    _filter,
    _config,
}: {
    remotePath: string
    mountPoint: string
    mountOptions?: Record<string, string | number | boolean | string[]>
    vfsOptions?: Record<string, string | number | boolean | string[]>
    _filter?: Record<string, string | number | boolean | string[]>
    _config?: Record<string, string | number | boolean | string[]>
}) {
    console.log('[mountRemote]', remotePath, mountPoint)

    const options = new URLSearchParams()
    options.set('fs', remotePath)
    options.set('mountPoint', mountPoint)

    if (mountOptions && Object.keys(mountOptions).length > 0) {
        options.set('mountOpt', JSON.stringify(parseRcloneOptions(mountOptions)))
    }

    if (vfsOptions && Object.keys(vfsOptions).length > 0) {
        options.set('vfsOpt', JSON.stringify(parseRcloneOptions(vfsOptions)))
    }

    if (_filter && Object.keys(_filter).length > 0) {
        options.set('_filter', JSON.stringify(parseRcloneOptions(_filter)))
    }

    if (_config && Object.keys(_config).length > 0) {
        options.set('_config', JSON.stringify(parseRcloneOptions(_config)))
    }

    const r = await fetch(`http://localhost:5572/mount/mount?${options.toString()}`, {
        method: 'POST',
        headers: getAuthHeader(),
    })
        .then((res) => res.json() as Promise<{ remotes: string[] } | Promise<{ error: string }>>)
        .catch((e) => {
            Sentry.captureException(e)
            console.log('error', e)
            throw e
        })

    if ('error' in r) {
        throw new Error(r.error)
    }

    return
}

export async function unmountRemote({
    mountPoint,
}: {
    mountPoint: string
}) {
    console.log('[unmountRemote]', mountPoint)

    const options = new URLSearchParams()
    options.set('mountPoint', mountPoint)

    const r = await fetch(`http://localhost:5572/mount/unmount?${options.toString()}`, {
        method: 'POST',
        headers: getAuthHeader(),
    })
        .then((res) => res.json())
        .catch((e) => {
            Sentry.captureException(e)
            console.log('error', e)
            throw e
        })

    if ('error' in r) {
        throw new Error(r.error)
    }

    return
}

export async function unmountAllRemotes() {
    console.log('[unmountAllRemotes]')

    const r = await fetch('http://localhost:5572/mount/unmountall', {
        method: 'POST',
        headers: getAuthHeader(),
    })
        .then((res) => res.json())
        .catch((e) => {
            Sentry.captureException(e)
            console.log('error', e)
            throw e
        })

    if ('error' in r) {
        throw new Error(r.error)
    }

    return
}

export async function startCopy({
    srcFs,
    dstFs,
    _config,
    _filter,
}: {
    srcFs: string
    dstFs: string
    _config?: Record<string, string | number | boolean | string[]>
    _filter?: Record<string, string | number | boolean | string[]>
}) {
    console.log('[startCopy]', srcFs, dstFs)

    const params = new URLSearchParams()
    params.set('srcFs', srcFs)
    params.set('dstFs', dstFs)
    // params.set('b2_disable_checksum', 'true')
    params.set('_async', 'true')

    if (_config && Object.keys(_config).length > 0) {
        params.set('_config', JSON.stringify(parseRcloneOptions(_config)))
    }

    if (_filter && Object.keys(_filter).length > 0) {
        params.set('_filter', JSON.stringify(parseRcloneOptions(_filter)))
    }

    const r = await fetch(`http://localhost:5572/sync/copy?${params.toString()}`, {
        method: 'POST',
        headers: getAuthHeader(),
    }).then((res) => res.json() as Promise<{ jobid: string }>)

    console.log('[startCopy] operation started:', r)

    if (!r.jobid) {
        throw new Error('Failed to start copy job')
    }

    return r.jobid
}

export async function startMove({
    srcFs,
    dstFs,
    createEmptySrcDirs,
    deleteEmptyDstDirs,
    _config,
    _filter,
}: {
    srcFs: string
    dstFs: string
    createEmptySrcDirs?: boolean // create empty src directories on destination if set
    deleteEmptyDstDirs?: boolean // delete empty src directories if set
    _config?: Record<string, string | number | boolean | string[]>
    _filter?: Record<string, string | number | boolean | string[]>
}) {
    console.log('[startMove]', srcFs, dstFs, createEmptySrcDirs, deleteEmptyDstDirs)

    const params = new URLSearchParams()
    params.set('srcFs', srcFs)
    params.set('dstFs', dstFs)

    if (createEmptySrcDirs) {
        params.set('createEmptySrcDirs', 'true')
    }

    if (deleteEmptyDstDirs) {
        params.set('deleteEmptyDstDirs', 'true')
    }

    // params.set('b2_disable_checksum', 'true')
    params.set('_async', 'true')

    if (_config && Object.keys(_config).length > 0) {
        params.set('_config', JSON.stringify(parseRcloneOptions(_config)))
    }

    if (_filter && Object.keys(_filter).length > 0) {
        params.set('_filter', JSON.stringify(parseRcloneOptions(_filter)))
    }

    const r = await fetch(`http://localhost:5572/sync/move?${params.toString()}`, {
        method: 'POST',
        headers: getAuthHeader(),
    }).then((res) => res.json() as Promise<{ jobid: string }>)

    console.log('[startMove] operation started:', r)

    if (!r.jobid) {
        throw new Error('Failed to start move job')
    }

    return r.jobid
}

export async function startSync({
    srcFs,
    dstFs,
    _config,
    _filter,
}: {
    srcFs: string
    dstFs: string
    _config?: Record<string, string | number | boolean | string[]>
    _filter?: Record<string, string | number | boolean | string[]>
}) {
    console.log('[startSync]', srcFs, dstFs)

    const params = new URLSearchParams()
    params.set('srcFs', srcFs)
    params.set('dstFs', dstFs)
    // params.set('b2_disable_checksum', 'true')
    params.set('_async', 'true')

    if (_config && Object.keys(_config).length > 0) {
        params.set('_config', JSON.stringify(parseRcloneOptions(_config)))
    }

    if (_filter && Object.keys(_filter).length > 0) {
        params.set('_filter', JSON.stringify(parseRcloneOptions(_filter)))
    }

    const r = await fetch(`http://localhost:5572/sync/sync?${params.toString()}`, {
        method: 'POST',
        headers: getAuthHeader(),
    }).then((res) => res.json() as Promise<{ jobid: string }>)

    console.log('[startSync] operation started:', r)

    if (!r.jobid) {
        throw new Error('Failed to start sync job')
    }
}

export async function startDelete({
    fs,
    rmDirs,
    _filter,
    _config,
}: {
    fs: string
    rmDirs?: boolean // delete empty src directories if set
    _filter?: Record<string, string | number | boolean | string[]>
    _config?: Record<string, string | number | boolean | string[]>
}) {
    console.log('[startDelete]', fs, rmDirs)

    const params = new URLSearchParams()
    params.set('fs', fs)

    if (rmDirs) {
        params.set('rmDirs', 'true')
    }

    params.set('_async', 'true')

    if (_filter && Object.keys(_filter).length > 0) {
        params.set('_filter', JSON.stringify(parseRcloneOptions(_filter)))
    }

    if (_config && Object.keys(_config).length > 0) {
        params.set('_config', JSON.stringify(parseRcloneOptions(_config)))
    }

    const r = await fetch(`http://localhost:5572/operations/delete?${params.toString()}`, {
        method: 'POST',
        headers: getAuthHeader(),
    })

    console.log('[startDelete] operation started:', r)

    if (!r.ok) {
        throw new Error('Failed to start delete job')
    }
}

/* FLAGS */
export async function getCurrentGlobalFlags() {
    console.log('[getCurrentGlobalFlags]')

    const r = await fetch('http://localhost:5572/options/get', {
        method: 'POST',
        headers: getAuthHeader(),
    }).then((res) => res.json() as Promise<any>)

    return r
}

export async function getCopyFlags() {
    console.log('[getCopyFlags]')

    const r = await fetch('http://localhost:5572/options/info', {
        method: 'POST',
        headers: getAuthHeader(),
    }).then((res) => res.json() as Promise<any>)

    const mainFlags = r.main

    const copyFlags = mainFlags
        .filter((flag: any) => flag?.Groups?.includes('Copy'))
        .sort((a: any, b: any) => a.Name.localeCompare(b.Name))

    return copyFlags
}

export async function getSyncFlags() {
    console.log('[getSyncFlags]')

    const r = await fetch('http://localhost:5572/options/info', {
        method: 'POST',
        headers: getAuthHeader(),
    }).then((res) => res.json() as Promise<any>)

    const mainFlags = r.main

    const syncFlags = mainFlags
        .filter((flag: any) => flag?.Groups?.includes('Copy') || flag?.Groups?.includes('Sync'))
        .sort((a: any, b: any) => a.Name.localeCompare(b.Name))

    return syncFlags
}

export async function getFilterFlags() {
    console.log('[getFilterFlags]')

    const r = await fetch('http://localhost:5572/options/info', {
        method: 'POST',
        headers: getAuthHeader(),
    }).then((res) => res.json() as Promise<any>)

    const filterFlags = r.filter

    // ignore "Metadata" fields as they have the same FieldNames as the normal non-metadata filters
    const filteredFlags = filterFlags
        .filter((flag: any) => !flag.Groups.includes('Metadata'))
        .sort((a: any, b: any) => a.Name.localeCompare(b.Name))

    return filteredFlags
}

export async function getVfsFlags() {
    console.log('[getVfsFlags]')

    const r = await fetch('http://localhost:5572/options/info', {
        method: 'POST',
        headers: getAuthHeader(),
    }).then((res) => res.json() as Promise<any>)

    const vfsFlags = r.vfs

    const IGNORED_FLAGS = ['NONE']

    const filteredFlags = vfsFlags
        .filter((flag: any) => !IGNORED_FLAGS.includes(flag.Name))
        .sort((a: any, b: any) => a.Name.localeCompare(b.Name))

    return filteredFlags
}

export async function getMountFlags() {
    console.log('[getMountFlags]')

    const r = await fetch('http://localhost:5572/options/info', {
        method: 'POST',
        headers: getAuthHeader(),
    }).then((res) => res.json() as Promise<any>)

    const mountFlags = r.mount

    const IGNORED_FLAGS = ['debug_fuse', 'daemon', 'daemon_timeout']

    const filteredFlags = mountFlags
        .filter((flag: any) => !IGNORED_FLAGS.includes(flag.Name))
        .sort((a: any, b: any) => a.Name.localeCompare(b.Name))

    return filteredFlags
}

export async function getConfigFlags() {
    console.log('[getConfigFlags]')

    const r = await fetch('http://localhost:5572/options/info', {
        method: 'POST',
        headers: getAuthHeader(),
    }).then((res) => res.json() as Promise<any>)

    const mainFlags = r.main

    const copyFlags = mainFlags
        .filter(
            (flag: any) =>
                flag?.Groups?.includes('Performance') ||
                flag?.Groups?.includes('Listing') ||
                flag?.Groups?.includes('Networking') ||
                flag?.Groups?.includes('Check') ||
                flag?.Name === 'use_server_modtime'
        )
        .sort((a: any, b: any) => a.Name.localeCompare(b.Name))

    return copyFlags
}

export async function getSftpFlags() {
    console.log('[getSftpFlags]')

    const r = await fetch('http://localhost:5572/options/info', {
        method: 'POST',
        headers: getAuthHeader(),
    }).then((res) => res.json() as Promise<any>)

    const sftpFlags = r.sftp

    return sftpFlags.sort((a: any, b: any) => a.Name.localeCompare(b.Name))
}

export async function getFtpFlags() {
    console.log('[getFtpFlags]')

    const r = await fetch('http://localhost:5572/options/info', {
        method: 'POST',
        headers: getAuthHeader(),
    }).then((res) => res.json() as Promise<any>)

    const ftpFlags = r.ftp

    return ftpFlags.sort((a: any, b: any) => a.Name.localeCompare(b.Name))
}
