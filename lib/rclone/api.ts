import { fetch } from '@tauri-apps/plugin-http'
import { platform } from '@tauri-apps/plugin-os'
import { useStore } from '../store'

/* UTILS */
const SUPPORRTED_BACKENDS = ['sftp', 's3', 'b2', 'drive', 'dropbox']

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

export async function getMountPoints() {
    console.log('[getMountPoints]')

    const r = await fetch('http://localhost:5572/mount/listmounts', {
        method: 'POST',
        headers: getAuthHeader(),
    }).then(
        (res) =>
            res.json() as Promise<{
                mountPoints: string[]
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

    return providers.filter((b: any) => SUPPORRTED_BACKENDS.includes(b.Name))
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

    for (const jobId of activeJobIds) {
        const job = await fetch(`http://localhost:5572/core/stats?group=job/${jobId}`, {
            method: 'POST',
            headers: getAuthHeader(),
        }).then((res) => res.json() as Promise<any>)

        const srcFs = transferred.find((t: any) => t.group === `job/${jobId}`)?.srcFs
        const dstFs = transferred.find((t: any) => t.group === `job/${jobId}`)?.dstFs

        if (!srcFs) {
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

            srcFs,
            dstFs,
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

            srcFs,
            dstFs,
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
}: {
    remotePath: string
    mountPoint: string
    mountOptions?: Record<string, string | number | boolean>
    vfsOptions?: Record<string, string | number | boolean>
}) {
    console.log('[mountRemote]', remotePath, mountPoint)

    const options = new URLSearchParams()
    options.set('fs', remotePath)
    options.set('mountPoint', mountPoint)

    if (mountOptions && Object.keys(mountOptions).length > 0) {
        options.set('mountOpt', JSON.stringify(mountOptions))
    }

    if (vfsOptions && Object.keys(vfsOptions).length > 0) {
        options.set('vfsOpt', JSON.stringify(vfsOptions))
    }

    const r = await fetch(`http://localhost:5572/mount/mount?${options.toString()}`, {
        method: 'POST',
        headers: getAuthHeader(),
    })
        .then((res) => res.json() as Promise<{ remotes: string[] } | Promise<{ error: string }>>)
        .catch((e) => {
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
        params.set('_config', JSON.stringify(_config))
    }

    if (_filter && Object.keys(_filter).length > 0) {
        params.set('_filter', JSON.stringify(_filter))
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
        params.set('_config', JSON.stringify(_config))
    }

    if (_filter && Object.keys(_filter).length > 0) {
        params.set('_filter', JSON.stringify(_filter))
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
        params.set('_config', JSON.stringify(_config))
    }

    if (_filter && Object.keys(_filter).length > 0) {
        params.set('_filter', JSON.stringify(_filter))
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
}: {
    fs: string
    rmDirs?: boolean // delete empty src directories if set
    _filter?: Record<string, string | number | boolean | string[]>
}) {
    console.log('[startDelete]', fs, rmDirs)

    const params = new URLSearchParams()
    params.set('fs', fs)

    if (rmDirs) {
        params.set('rmDirs', 'true')
    }

    params.set('_async', 'true')

    if (_filter && Object.keys(_filter).length > 0) {
        params.set('_filter', JSON.stringify(_filter))
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

export async function getGlobalFlags() {
    console.log('[getGlobalFlags]')

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

    const copyFlags = mainFlags.filter(
        (flag: any) => flag?.Groups?.includes('Copy') || flag?.Groups?.includes('Performance')
    )

    return copyFlags
}

export async function getSyncFlags() {
    console.log('[getSyncFlags]')

    const r = await fetch('http://localhost:5572/options/info', {
        method: 'POST',
        headers: getAuthHeader(),
    }).then((res) => res.json() as Promise<any>)

    const mainFlags = r.main

    const syncFlags = mainFlags.filter(
        (flag: any) =>
            flag?.Groups?.includes('Copy') ||
            flag?.Groups?.includes('Sync') ||
            flag?.Groups?.includes('Performance')
    )

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
    const filteredFlags = filterFlags.filter((flag: any) => !flag.Groups.includes('Metadata'))

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

    const filteredFlags = vfsFlags.filter((flag: any) => !IGNORED_FLAGS.includes(flag.Name))

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

    const filteredFlags = mountFlags.filter((flag: any) => !IGNORED_FLAGS.includes(flag.Name))

    return filteredFlags
}
