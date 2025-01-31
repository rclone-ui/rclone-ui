import { fetch } from '@tauri-apps/plugin-http'
import { platform } from '@tauri-apps/plugin-os'
import { useStore } from '../store'

/* UTILS */
const SUPPORRTED_BACKENDS = ['sftp', 's3', 'b2', 'drive']

function getAuthHeader() {
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
export async function listRemotes() {
    const r = await fetch('http://localhost:5572/config/listremotes', {
        method: 'POST',
        headers: getAuthHeader(),
    }).then((res) => res.json() as Promise<{ remotes: string[] }>)
    // .catch((e) => {
    // 	console.log("error", e);
    // 	throw e;
    // });

    if (typeof r?.remotes === 'undefined') {
        throw new Error('Failed to fetch remotes')
    }

    return r.remotes || []
}

export async function getRemote(remote: string) {
    const r = await fetch(`http://localhost:5572/config/get?name=${remote}`, {
        method: 'POST',
        headers: getAuthHeader(),
    }).then(
        (res) => res.json() as Promise<{ type: string } & Record<string, string | number | boolean>>
    )
    // .catch((e) => {
    // 	console.log("error", e);
    // 	throw e;
    // });

    // console.log(JSON.stringify(r, null, 2))

    return r
}

export async function updateRemote(
    remote: string,
    parameters: Record<string, string | number | boolean>
) {
    console.log('updateRemote', remote, parameters)

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
    console.log('createRemote', name, type, parameters)

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
    await fetch(`http://localhost:5572/config/delete?name=${remote}`, {
        method: 'POST',
        headers: getAuthHeader(),
    })

    // console.log(JSON.stringify(r, null, 2))
}

export async function getMountPoints() {
    const r = await fetch('http://localhost:5572/mount/listmounts', {
        method: 'POST',
        headers: getAuthHeader(),
    }).then(
        (res) =>
            res.json() as Promise<{
                mountPoints: string[]
            }>
    )

    // console.log('Mount points:', r)

    if (!Array.isArray(r?.mountPoints)) {
        throw new Error('Failed to get mount points')
    }

    return r.mountPoints
}

export async function getBackends() {
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

        jobs.active.push({
            id: jobId,
            bytes: job.bytes,
            totalBytes: job.totalBytes,
            speed: job.speed,

            done: job.bytes === job.totalBytes,
            progress: Math.round((job.bytes / job.totalBytes) * 100),
            fatal: job.fatalError,

            srcFs: transferred.find((t: any) => t.group === `job/${jobId}`)?.srcFs,
            dstFs: transferred.find((t: any) => t.group === `job/${jobId}`)?.dstFs,
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

        jobs.inactive.push({
            id: jobId,
            bytes: job.bytes,
            totalBytes: job.totalBytes,
            speed: 0,

            done: job.bytes === job.totalBytes,
            progress: Math.round((job.bytes / job.totalBytes) * 100),
            fatal: job.fatalError,

            srcFs: transferred.find((t: any) => t.group === `job/${jobId}`)?.srcFs,
            dstFs: transferred.find((t: any) => t.group === `job/${jobId}`)?.dstFs,
        })
    }

    return jobs
}

export async function stopJob(jobId: number) {
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

export async function startCopy({
    source,
    dest,
    copyOptions,
    filterOptions,
}: {
    source: string
    dest: string
    copyOptions: Record<string, string | number | boolean> | undefined
    filterOptions: Record<string, string | number | boolean> | undefined
}) {
    const params = new URLSearchParams()
    params.set('srcFs', source)
    params.set('dstFs', dest)
    // params.set('b2_disable_checksum', 'true')
    params.set('_async', 'true')

    console.log('params', params.toString())

    if (copyOptions && Object.keys(copyOptions).length > 0) {
        params.set('_config', JSON.stringify(copyOptions))
    }
    console.log('copyOptions', copyOptions)

    if (filterOptions && Object.keys(filterOptions).length > 0) {
        params.set('_filter', JSON.stringify(filterOptions))
    }
    console.log('filterOptions', filterOptions)

    const r = await fetch(`http://localhost:5572/sync/copy?${params.toString()}`, {
        method: 'POST',
        headers: getAuthHeader(),
    }).then((res) => res.json() as Promise<{ jobid: string }>)

    console.log('Copy operation started:', r)
    return

    // if (!r.jobid) {
    // 	throw new Error("Failed to start copy job");
    // }

    // Monitor job status
    // while (true) {
    // 	const status = await fetch(
    // 		`http://localhost:5572/job/status/${r.jobid}`,
    // 		{
    // 			method: "POST",
    // 		},
    // 	).then((res) => res.json() as Promise<RcloneJobStatus>);

    // 	if (status.finished) {
    // 		return status.success;
    // 	}

    // 	// Wait a bit before checking again
    // 	await new Promise((resolve) => setTimeout(resolve, 1000));
    // }
}

export async function startSync({
    source,
    dest,
    syncOptions,
    filterOptions,
}: {
    source: string
    dest: string
    syncOptions: Record<string, string | number | boolean> | undefined
    filterOptions: Record<string, string | number | boolean> | undefined
}) {
    const params = new URLSearchParams()
    params.set('srcFs', source)
    params.set('dstFs', dest)
    // params.set('b2_disable_checksum', 'true')
    params.set('_async', 'true')

    console.log('params', params.toString())

    if (syncOptions && Object.keys(syncOptions).length > 0) {
        params.set('_config', JSON.stringify(syncOptions))
    }
    console.log('syncOptions', syncOptions)

    if (filterOptions && Object.keys(filterOptions).length > 0) {
        params.set('_filter', JSON.stringify(filterOptions))
    }
    console.log('filterOptions', filterOptions)

    const r = await fetch(`http://localhost:5572/sync/sync?${params.toString()}`, {
        method: 'POST',
        headers: getAuthHeader(),
    }).then((res) => res.json() as Promise<{ jobid: string }>)

    console.log('Sync operation started:', r)
    return

    // if (!r.jobid) {
    // 	throw new Error("Failed to start copy job");
    // }

    // Monitor job status
    // while (true) {
    // 	const status = await fetch(
    // 		`http://localhost:5572/job/status/${r.jobid}`,
    // 		{
    // 			method: "POST",
    // 		},
    // 	).then((res) => res.json() as Promise<RcloneJobStatus>);

    // 	if (status.finished) {
    // 		return status.success;
    // 	}

    // 	// Wait a bit before checking again
    // 	await new Promise((resolve) => setTimeout(resolve, 1000));
    // }
}

/* FLAGS */

export async function getGlobalFlags() {
    const r = await fetch('http://localhost:5572/options/get', {
        method: 'POST',
        headers: getAuthHeader(),
    }).then((res) => res.json() as Promise<any>)

    return r
}

export async function getCopyFlags() {
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
    const r = await fetch('http://localhost:5572/options/info', {
        method: 'POST',
        headers: getAuthHeader(),
    }).then((res) => res.json() as Promise<any>)

    const mountFlags = r.mount

    const IGNORED_FLAGS = ['debug_fuse', 'daemon', 'daemon_timeout']

    const filteredFlags = mountFlags.filter((flag: any) => !IGNORED_FLAGS.includes(flag.Name))

    return filteredFlags
}
