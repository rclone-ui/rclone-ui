import * as Sentry from '@sentry/browser'
import { message } from '@tauri-apps/plugin-dialog'
import { platform } from '@tauri-apps/plugin-os'
import pRetry from 'p-retry'
import { useHostStore } from '../../store/host'
import type { JobItem } from '../../types/jobs'
import type { FlagValue } from '../../types/rclone'
import { getFsInfo } from '../format'
import { restartActiveRclone, runRcloneCli } from './cli'
import rclone from './client'
import { parseRcloneOptions } from './common'

const RE_BACKSLASH = /\\/g
const RE_PATH_SEPARATOR = /[/\\]/
const RE_WINDOWS_EXTENDED_PATH = /(\/\/\?\/|\\\\\?\\)/
const RE_WINDOWS_DRIVE_ROOT = /^:local:[a-zA-Z]:\/$/
const RE_WINDOWS_DRIVE_LETTER = /^[a-zA-Z]:$/

function serializeOptions(
    remotePath: string,
    options: {
        remote?: Record<string, FlagValue>
        global?: Record<string, FlagValue>
    }
) {
    console.log('[serializeRemoteOptions] ', remotePath)

    const { remoteName, filePath, dirPath, type, root } = getFsInfo(remotePath)

    console.log('[serializeRemoteOptions] ', remotePath, 'remoteName', remoteName)
    console.log('[serializeRemoteOptions] ', remotePath, 'filePath', filePath)
    console.log('[serializeRemoteOptions] ', remotePath, 'dirPath', dirPath)
    console.log('[serializeRemoteOptions] ', remotePath, 'type', type)
    console.log('[serializeRemoteOptions] ', remotePath, 'root', root)

    let serialized = `${remoteName}`

    if (
        Object.keys(options.remote || {}).length > 0 ||
        Object.keys(options.global || {}).length > 0
    ) {
        serialized += ','
    }

    if (options.remote && Object.keys(options.remote).length > 0) {
        serialized += Object.entries(options.remote)
            .map(([key, value]) => `${key}="${value}"`)
            .join(',')
    }

    if (options.global && Object.keys(options.global).length > 0) {
        serialized += Object.entries(options.global)
            .map(([key, value]) => `global.${key}="${value}"`)
            .join(',')
    }

    serialized += ':'

    if (remoteName === ':local') {
        if (RE_WINDOWS_DRIVE_ROOT.test(root)) {
            const driveLetter = root.slice(7)
            console.log(
                '[serializeRemoteOptions] ',
                remotePath,
                'adding Windows drive',
                driveLetter
            )
            serialized += driveLetter
        } else {
            console.log('[serializeRemoteOptions] ', remotePath, 'adding / for Unix local')
            serialized += '/'
        }
    }

    if (type === 'folder') {
        serialized += dirPath
    } else {
        serialized += filePath
    }

    console.log('[serializeRemoteOptions] ', remotePath, 'serialized', serialized)

    return serialized
}

async function hasStat(path: string) {
    try {
        const { root, filePath } = getFsInfo(path)
        const r = await rclone('/operations/stat', {
            params: {
                query: {
                    fs: root === ':local:' ? ':local:/' : root,
                    remote: filePath,
                },
            },
        })
        if (!r || !r.item) {
            return false
        }
        return true
    } catch {
        return false
    }
}

export async function startCopy({
    sources,
    destination,
    options,
}: {
    sources: string[]
    destination: string
    options: {
        copy?: Record<string, FlagValue>
        config?: Record<string, FlagValue>
        filter?: Record<string, FlagValue>
        remotes?: Record<string, Record<string, FlagValue>>
    }
}) {
    console.log('[startCopy] starting', {
        sources,
        destination,
        optionKeys: Object.keys(options),
    })

    for (const source of sources) {
        const sourceExists = await hasStat(source)
        if (!sourceExists) {
            throw new Error(`Source does not exist, ${source} is missing`)
        }
    }

    if (
        sources.length > 1 &&
        options.filter &&
        ('include' in options.filter || 'include_from' in options.filter)
    ) {
        throw new Error('Include rules are not supported with multiple sources')
    }

    const mergedOptions = {
        ...(options.config || {}),
        ...(options.copy || {}),
        ...(options.filter || {}),
    }

    const pendingJobs: Parameters<typeof startBatch>[0] = []
    const handledSourcePaths: Record<string, true> = {}
    const folderSources = sources.filter((path) => path.endsWith('/') || path.endsWith('\\'))

    console.log('[Copy] ======DST INFO====== ', destination, ' ====================')
    const {
        root: dstRoot,
        dirPath: dstDirPath,
        fullDirPath: dstFullDirPath,
        remoteName: dstRemoteName,
    } = getFsInfo(destination)

    console.log('[Copy] ======DST INFO====== ', destination, ' ====================')

    const dstOptions =
        options.remotes && dstRemoteName && dstRemoteName in options.remotes
            ? (JSON.parse(options.remotes[dstRemoteName] as unknown as string) as any)
            : undefined

    for (const source of sources) {
        console.log('[Copy] ======START====== ', source, ' ====================')
        if (handledSourcePaths[source]) {
            console.log('[Copy] skipping because source is already handled', source)
            continue
        }

        handledSourcePaths[source] = true

        console.log('[Copy] ======SRC INFO====== ', source, ' ====================')

        const {
            root: srcRoot,
            filePath: srcFilePath,
            fullDirPath: srcFullDirPath,
            type: srcType,
            name: srcName,
            remoteName: srcRemoteName,
        } = getFsInfo(source)

        console.log('[Copy] ======SRC INFO====== ', source, ' ====================')

        const srcOptions =
            options.remotes && srcRemoteName && srcRemoteName in options.remotes
                ? (JSON.parse(options.remotes[srcRemoteName] as unknown as string) as any)
                : undefined

        if (srcType === 'folder') {
            const jobParams: Parameters<typeof startBatch>[0][number] = {
                _path: 'sync/copy',
                srcFs: serializeOptions(srcFullDirPath, {
                    remote: srcOptions,
                    global: mergedOptions,
                }),
                dstFs: serializeOptions(`${dstFullDirPath}${srcName}`, {
                    remote: dstOptions,
                }),
                createEmptySrcDirs: true,
            }

            pendingJobs.push(jobParams)
            continue
        }

        if (folderSources.some((folder) => source.startsWith(folder))) {
            console.log(
                '[Copy] skipping because source or parent folder is already handled',
                source
            )
            continue
        }

        console.log('[Copy] ', source, 'srcRoot', srcRoot, srcFilePath)
        console.log('[Copy] ', destination, 'dstRoot', dstRoot, dstDirPath)

        const jobParams: Parameters<typeof startBatch>[0][number] = {
            _path: 'operations/copyfile',
            srcFs: serializeOptions(srcRoot, {
                remote: srcOptions,
                global: mergedOptions,
            }),
            srcRemote: srcFilePath,
            dstFs: serializeOptions(dstRoot, {
                remote: dstOptions,
            }),
            dstRemote: `${dstDirPath === '/' ? '' : dstDirPath}${srcName}`,
        }

        pendingJobs.push(jobParams)
    }

    console.log('[startCopy] submitting batch', { jobCount: pendingJobs.length })
    return startBatch(pendingJobs)
}

export async function startMove({
    sources,
    destination,
    options,
}: {
    sources: string[]
    destination: string
    options: {
        move?: Record<string, FlagValue>
        config?: Record<string, FlagValue>
        filter?: Record<string, FlagValue>
        remotes?: Record<string, Record<string, FlagValue>>
    }
}) {
    console.log('[startMove] starting', {
        sources,
        destination,
        optionKeys: Object.keys(options),
    })

    for (const source of sources) {
        const sourceExists = await hasStat(source)
        if (!sourceExists) {
            throw new Error(`Source does not exist, ${source} is missing`)
        }
    }

    if (
        sources.length > 1 &&
        options.filter &&
        ('include' in options.filter || 'include_from' in options.filter)
    ) {
        throw new Error('Include rules are not supported with multiple sources')
    }

    const mergedOptions = {
        ...(options.config || {}),
        ...(options.move || {}),
        ...(options.filter || {}),
    }

    const pendingJobs: Parameters<typeof startBatch>[0] = []
    const handledSourcePaths: Record<string, true> = {}
    const folderSources = sources.filter((path) => path.endsWith('/') || path.endsWith('\\'))

    const {
        root: dstRoot,
        dirPath: dstDirPath,
        fullDirPath: dstFullDirPath,
        remoteName: dstRemoteName,
    } = getFsInfo(destination)

    const dstOptions =
        options.remotes && dstRemoteName && dstRemoteName in options.remotes
            ? (JSON.parse(options.remotes[dstRemoteName] as unknown as string) as any)
            : undefined

    for (const source of sources) {
        if (handledSourcePaths[source]) {
            console.log('[Move] skipping because source is already handled', source)
            continue
        }

        handledSourcePaths[source] = true

        const {
            root: srcRoot,
            filePath: srcFilePath,
            fullDirPath: srcFullDirPath,
            type: srcType,
            name: srcName,
            remoteName: srcRemoteName,
        } = getFsInfo(source)

        const srcOptions =
            options.remotes && srcRemoteName && srcRemoteName in options.remotes
                ? (JSON.parse(options.remotes[srcRemoteName] as unknown as string) as any)
                : undefined

        if (srcType === 'folder') {
            const jobParams: Parameters<typeof startBatch>[0][number] = {
                _path: 'sync/move',
                srcFs: serializeOptions(srcFullDirPath, {
                    remote: srcOptions,
                    global: mergedOptions,
                }),
                dstFs: serializeOptions(`${dstFullDirPath}${srcName}`, {
                    remote: dstOptions,
                }),
                createEmptySrcDirs: true,
            }

            pendingJobs.push(jobParams)
            continue
        }

        if (folderSources.some((folder) => source.startsWith(folder))) {
            console.log(
                '[Move] skipping because source or parent folder is already handled',
                source
            )
            continue
        }

        const jobParams: Parameters<typeof startBatch>[0][number] = {
            _path: 'operations/movefile',
            srcFs: serializeOptions(srcRoot, {
                remote: srcOptions,
                global: mergedOptions,
            }),
            srcRemote: srcFilePath,
            dstFs: serializeOptions(dstRoot, {
                remote: dstOptions,
            }),
            dstRemote: `${dstDirPath === '/' ? '' : dstDirPath}${srcName}`,
        }

        pendingJobs.push(jobParams)
    }

    console.log('[startMove] submitting batch', { jobCount: pendingJobs.length })
    return startBatch(pendingJobs)
}

/* JOBS */
async function fetchTransferred() {
    const transferredStats = await rclone('/core/transferred')

    const transferred = transferredStats?.transferred

    return transferred
}

async function fetchJob(jobId: number, transferred: Awaited<ReturnType<typeof fetchTransferred>>) {
    const job = await rclone('/core/stats', {
        params: {
            query: {
                group: `job/${jobId}`,
            },
        },
    })
    console.log('[fetchJob] job stats', jobId, JSON.stringify(job, null, 2))

    const jobStatus = await rclone('/job/status', {
        params: {
            query: {
                jobid: jobId,
            },
        },
    })
    console.log('[fetchJob] job status', jobId, JSON.stringify(jobStatus, null, 2))

    let hasError = !!jobStatus?.error

    if (
        !hasError &&
        jobStatus.output &&
        typeof jobStatus.output === 'object' &&
        'results' in jobStatus.output &&
        Array.isArray(jobStatus.output.results)
    ) {
        hasError = jobStatus.output.results.some((result: any) => !!result?.error)
    }

    const relatedItems = transferred.filter((t) => t.group === `job/${jobId}`)
    if (relatedItems.length === 0) {
        console.log('[fetchJob] relatedItems not found', jobId)
        return null
    }

    console.log('[fetchJob] relatedItems', JSON.stringify(relatedItems, null, 2))

    const sources = new Set<string>()

    if (relatedItems.length === 1) {
        if (relatedItems[0].srcFs) {
            const combinedSource = `${relatedItems[0].srcFs}${relatedItems[0].name}`

            sources.add(
                platform() === 'windows'
                    ? combinedSource.replace(RE_WINDOWS_EXTENDED_PATH, '')
                    : combinedSource
            )
        }
    } else {
        for (const item of relatedItems) {
            if (item.srcFs) {
                sources.add(
                    platform() === 'windows'
                        ? item.srcFs.replace(RE_WINDOWS_EXTENDED_PATH, '')
                        : item.srcFs
                )
            }
        }
    }

    if (sources.size === 0 && !hasError) {
        console.log('[fetchJob] source or hasError not found', jobId)
        return null
    }

    return {
        id: jobId,
        bytes: job.bytes,
        totalBytes: job.totalBytes,
        speed: job.speed,

        done: job.bytes === job.totalBytes,
        progress: Math.round((job.bytes / job.totalBytes) * 100),
        hasError: hasError,

        sources: Array.from(sources),
    }
}

export async function listTransfers() {
    console.log('[listTransfers] starting')

    const allStats = await rclone('/core/stats')
    console.log('[listTransfers] allStats', JSON.stringify(allStats, null, 2))

    const transferring = allStats?.transferring || []

    console.log('[listTransfers] transferring count:', transferring.length)

    const transferred = await fetchTransferred()
    console.log('[listTransfers] transferred count:', transferred?.length || 0)

    const jobs = {
        active: [] as JobItem[],
        inactive: [] as JobItem[],
    }

    const activeJobIds = new Set(
        transferring
            ?.filter((t) => t.group?.startsWith('job/'))
            .map((t) => Number(t.group!.split('/')[1]))
            .sort((a, b) => a - b)
    )
    console.log('[listTransfers] activeJobIds', activeJobIds.size)

    const isWindows = platform() === 'windows'
    console.log('[listTransfers] isWindows', isWindows)

    for (const jobId of activeJobIds) {
        const job = await fetchJob(jobId, transferred)
        if (job) {
            jobs.active.push({
                ...job,
                type: 'active',
            })
        }
    }

    const inactiveJobIds = new Set(
        transferred
            ?.filter((t) => t.group?.startsWith('job/'))
            .map((t) => Number(t.group!.split('/')[1]))
            .filter((id) => !activeJobIds.has(id))
            .sort((a, b) => a - b)
    )
    console.log('[listTransfers] inactive job IDs:', Array.from(inactiveJobIds))

    for (const jobId of inactiveJobIds) {
        const job = await fetchJob(jobId, transferred)
        if (job) {
            jobs.inactive.push({
                ...job,
                speed: 0,
                type: 'inactive',
            })
        }
    }

    console.log(
        '[listTransfers] final result - active:',
        jobs.active.length,
        'inactive:',
        jobs.inactive.length
    )

    return jobs
}

/* OPERATIONS */
export async function startMount({
    source,
    destination,
    options,
}: {
    source: string
    destination: string
    options: {
        mount?: Record<string, FlagValue>
        vfs?: Record<string, FlagValue>
        filter?: Record<string, FlagValue>
        config?: Record<string, FlagValue>
        remotes?: Record<string, Record<string, FlagValue>>
    }
}) {
    const currentPlatform = platform()
    let needsVolumeName = currentPlatform === 'macos'

    if (
        currentPlatform === 'windows' &&
        destination !== '*' &&
        !RE_WINDOWS_DRIVE_LETTER.test(destination)
    ) {
        needsVolumeName = true
    }

    const mountOptions = { ...(options.mount || {}) }

    const hasVolumeName = 'volname' in mountOptions && mountOptions.volname
    if (!hasVolumeName && needsVolumeName) {
        const segments = source.split(RE_PATH_SEPARATOR).filter(Boolean)
        console.log('[Mount] segments', segments)

        const sourcePath = segments.length === 1 ? segments[0].replace(/:/g, '') : segments.pop()
        console.log('[Mount] sourcePath', sourcePath)

        mountOptions.volname = `${sourcePath}-${Math.random().toString(36).substring(2, 3).toUpperCase()}`
    }

    const mergedOptions = {
        ...mountOptions,
        ...(options.config || {}),
        ...(options.vfs || {}),
        ...(options.filter || {}),
    }

    const { fullDirPath: srcFullDirPath, remoteName: srcRemoteName } = getFsInfo(source)

    const srcOptions =
        options.remotes && srcRemoteName && srcRemoteName in options.remotes
            ? (JSON.parse(options.remotes[srcRemoteName] as unknown as string) as any)
            : undefined

    if (destination === '*' && currentPlatform === 'windows') {
        await pRetry(
            async () =>
                await rclone('/mount/mount', {
                    params: {
                        query: {
                            fs: serializeOptions(srcFullDirPath, {
                                global: mergedOptions,
                                remote: srcOptions,
                            }),
                            mountPoint: '*',
                            mount: 'nfsmount',
                        },
                    },
                }),
            {
                retries: 3,
            }
        )
        return
    }

    const {
        root: dstRoot,
        filePath: dstFilePath,
        fullDirPath: dstFullDirPath,
    } = getFsInfo(destination)

    const dstFs = dstRoot === ':local:' ? ':local:/' : dstRoot
    const dstFilePathNormalized = dstFilePath.replace(RE_BACKSLASH, '/')

    let directoryExists: boolean | undefined

    try {
        const r = await pRetry(
            async () =>
                await rclone('/operations/stat', {
                    params: {
                        query: {
                            fs: dstFs,
                            remote: dstFilePathNormalized,
                        },
                    },
                }),
            {
                retries: 3,
            }
        )
        if (!r || !r.item) {
            directoryExists = false
        } else {
            if (!r.item.IsDir) {
                throw new Error('The selected directory is not a directory')
            }
            directoryExists = true
        }
    } catch (err) {
        console.error('[Mount] Error checking if directory exists:', err)
    }
    console.log('[Mount] directoryExists', directoryExists)

    const isPlatformWindows = platform() === 'windows'

    if (directoryExists) {
        let isEmpty = false
        try {
            const { list } = await pRetry(
                async () =>
                    await rclone('/operations/list', {
                        params: {
                            query: {
                                fs: dstRoot === ':local:' ? ':local:/' : dstRoot,
                                remote: dstFilePath,
                            },
                        },
                    }),
                {
                    retries: 3,
                }
            )
            isEmpty = !list || list.length === 0
        } catch (err) {
            console.error('[Mount] Error checking if directory is empty:', err)
        }

        if (!isEmpty) {
            throw new Error('The selected directory must be empty to mount a remote.')
        }

        if (isPlatformWindows) {
            try {
                await pRetry(
                    async () =>
                        await rclone('/operations/rmdir', {
                            params: {
                                query: {
                                    fs: dstRoot === ':local:' ? ':local:/' : dstRoot,
                                    remote: dstFilePath,
                                },
                            },
                        }),
                    {
                        retries: 3,
                    }
                )
            } catch (err) {
                console.error('[Mount] Error removing directory:', err)
            }
        }
    } else if (!isPlatformWindows) {
        try {
            await pRetry(
                async () =>
                    await rclone('/operations/mkdir', {
                        params: {
                            query: {
                                fs: dstRoot === ':local:' ? ':local:/' : dstRoot,
                                remote: dstFilePath,
                            },
                        },
                    }),
                {
                    retries: 3,
                }
            )
        } catch (error) {
            console.error('[Mount] Error creating directory:', error)
            throw new Error('Failed to create mount directory. Try creating it manually first.')
        }
    }

    await pRetry(
        async () =>
            await rclone('/mount/mount', {
                params: {
                    query: {
                        fs: serializeOptions(srcFullDirPath, {
                            global: mergedOptions,
                            remote: srcOptions,
                        }),
                        mountPoint: (() => {
                            if (platform() !== 'windows') {
                                return dstFullDirPath.replace(':local:', '/')
                            }
                            const mp = dstFullDirPath
                                .replace(':local:', '')
                                .replace(RE_BACKSLASH, '/')
                            if (/^[a-zA-Z]:\/$/.test(mp)) {
                                return mp.slice(0, -1)
                            }
                            return mp
                        })(),
                        mount: 'nfsmount',
                    },
                },
            }),
        {
            retries: 3,
        }
    )
}

export async function startBisync({
    source,
    destination,
    options,
}: {
    source: string
    destination: string
    options: {
        config?: Record<string, FlagValue>
        bisync?: Record<string, FlagValue>
        filter?: Record<string, FlagValue>
        remotes?: Record<string, Record<string, FlagValue>>
        outer?: Record<string, FlagValue>
    }
}) {
    const sourceExists = await hasStat(source)
    if (!sourceExists) {
        throw new Error(`Source does not exist, ${source} is missing`)
    }

    const mergedOptions = {
        ...(options.config || {}),
        ...(options.bisync || {}),
        ...(options.filter || {}),
    }

    const { fullDirPath: srcFullDirPath, remoteName: srcRemoteName } = getFsInfo(source)
    const { fullDirPath: dstFullDirPath, remoteName: dstRemoteName } = getFsInfo(destination)

    const srcOptions =
        options.remotes && srcRemoteName && srcRemoteName in options.remotes
            ? (JSON.parse(options.remotes[srcRemoteName] as unknown as string) as any)
            : undefined

    const dstOptions =
        options.remotes && dstRemoteName && dstRemoteName in options.remotes
            ? (JSON.parse(options.remotes[dstRemoteName] as unknown as string) as any)
            : undefined

    const r = await pRetry(
        async () =>
            await rclone('/sync/bisync', {
                params: {
                    query: {
                        path1: serializeOptions(srcFullDirPath, {
                            global: mergedOptions,
                            remote: srcOptions,
                        }),
                        path2: serializeOptions(dstFullDirPath, {
                            remote: dstOptions,
                        }),
                        _async: true,
                        ...(options.outer && Object.keys(options.outer).length > 0
                            ? Object.fromEntries(
                                  Object.entries(options.outer).map(([key, value]) => [
                                      key,
                                      Array.isArray(value) ? value.join(',') : value,
                                  ])
                              )
                            : {}),
                    },
                },
            }),
        {
            retries: 3,
        }
    )

    if (!r?.jobid) {
        console.error('Failed to start job: missing jobid', r)
        throw new Error('Failed to start operation')
    }

    await new Promise((resolve) => setTimeout(resolve, 1000))

    const jobStatus = await pRetry(
        async () =>
            await rclone('/job/status', {
                params: {
                    query: {
                        jobid: r.jobid!,
                    },
                },
            }),
        {
            retries: 3,
        }
    ).catch(null)

    console.log('jobStatus', JSON.stringify(jobStatus, null, 2))

    if (!jobStatus) {
        console.error('Failed to start job:', r.jobid)
        throw new Error('Failed to start operation')
    }

    if (jobStatus.error) {
        console.error('Failed to start job:', r.jobid, jobStatus.error)
        throw new Error(jobStatus.error)
    }

    return r.jobid
}

export async function startSync({
    source,
    destination,
    options,
}: {
    source: string
    destination: string
    options: {
        config?: Record<string, FlagValue>
        sync?: Record<string, FlagValue>
        filter?: Record<string, FlagValue>
        remotes?: Record<string, Record<string, FlagValue>>
    }
}) {
    const sourceExists = await hasStat(source)
    if (!sourceExists) {
        throw new Error(`Source does not exist, ${source} is missing`)
    }

    const mergedOptions = {
        ...(options.config || {}),
        ...(options.sync || {}),
        ...(options.filter || {}),
    }

    const { fullDirPath: srcFullDirPath, remoteName: srcRemoteName } = getFsInfo(source)
    const { fullDirPath: dstFullDirPath, remoteName: dstRemoteName } = getFsInfo(destination)

    const srcOptions =
        options.remotes && srcRemoteName && srcRemoteName in options.remotes
            ? (JSON.parse(options.remotes[srcRemoteName] as unknown as string) as any)
            : undefined

    const dstOptions =
        options.remotes && dstRemoteName && dstRemoteName in options.remotes
            ? (JSON.parse(options.remotes[dstRemoteName] as unknown as string) as any)
            : undefined

    const r = await pRetry(
        async () =>
            await rclone('/sync/sync', {
                params: {
                    query: {
                        srcFs: serializeOptions(srcFullDirPath, {
                            global: mergedOptions,
                            remote: srcOptions,
                        }),
                        dstFs: serializeOptions(dstFullDirPath, {
                            remote: dstOptions,
                        }),
                        createEmptySrcDirs: true,
                        _async: true,
                    },
                },
            }),
        {
            retries: 3,
        }
    )

    if (!r?.jobid) {
        console.error('Failed to start job: missing jobid', r)
        throw new Error('Failed to start operation')
    }

    await new Promise((resolve) => setTimeout(resolve, 1000))

    const jobStatus = await pRetry(
        async () =>
            await rclone('/job/status', {
                params: {
                    query: {
                        jobid: r.jobid!,
                    },
                },
            }),
        {
            retries: 3,
        }
    ).catch(null)

    console.log('jobStatus', JSON.stringify(jobStatus, null, 2))

    if (!jobStatus) {
        console.error('Failed to start job:', r.jobid)
        throw new Error('Failed to start operation')
    }

    if (jobStatus.error) {
        console.error('Failed to start job:', r.jobid, jobStatus.error)
        throw new Error(jobStatus.error)
    }

    return r.jobid
}

export async function startDelete({
    sources,
    options,
}: {
    sources: string[]
    options: {
        filter?: Record<string, FlagValue>
        config?: Record<string, FlagValue>
        remotes?: Record<string, Record<string, FlagValue>>
    }
}) {
    for (const source of sources) {
        const sourceExists = await hasStat(source)
        if (!sourceExists) {
            throw new Error(`Source does not exist, ${source} is missing`)
        }
    }

    if (
        sources.length > 1 &&
        options.filter &&
        ('include' in options.filter || 'include_from' in options.filter)
    ) {
        throw new Error('Include rules are not supported with multiple sources')
    }

    const mergedOptions = {
        ...(options.config || {}),
        ...(options.filter || {}),
    }

    const pendingJobs: Parameters<typeof startBatch>[0] = []
    const handledSourcePaths: Record<string, true> = {}
    const folderSources = sources.filter((path) => path.endsWith('/') || path.endsWith('\\'))

    for (const source of sources) {
        if (handledSourcePaths[source]) {
            console.log('[Delete] skipping because source is already handled', source)
            continue
        }

        handledSourcePaths[source] = true

        const {
            root: srcRoot,
            filePath: srcFilePath,
            type: srcType,
            remoteName: srcRemoteName,
        } = getFsInfo(source)

        const srcOptions =
            options.remotes && srcRemoteName && srcRemoteName in options.remotes
                ? (JSON.parse(options.remotes[srcRemoteName] as unknown as string) as any)
                : undefined

        if (srcType === 'folder') {
            const jobParams: Parameters<typeof startBatch>[0][number] = {
                _path: 'operations/delete',
                fs: serializeOptions(source, {
                    global: mergedOptions,
                    remote: srcOptions,
                }),
            }
            pendingJobs.push(jobParams)
            continue
        }

        if (folderSources.some((folder) => source.startsWith(folder))) {
            console.log(
                '[Delete] skipping because source or parent folder is already handled',
                source
            )
            continue
        }

        const jobParams: Parameters<typeof startBatch>[0][number] = {
            _path: 'operations/deletefile',
            fs: serializeOptions(srcRoot, {
                global: mergedOptions,
                remote: srcOptions,
            }),
            remote: srcFilePath,
        }
        pendingJobs.push(jobParams)
    }

    return startBatch(pendingJobs)
}

export async function startPurge({
    sources,
    options,
}: {
    sources: string[]
    options: {
        config?: Record<string, FlagValue>
        remotes?: Record<string, Record<string, FlagValue>>
    }
}) {
    for (const source of sources) {
        const sourceExists = await hasStat(source)
        if (!sourceExists) {
            throw new Error(`Source does not exist, ${source} is missing`)
        }
    }

    const pendingJobs: Parameters<typeof startBatch>[0] = []
    const handledSourcePaths: Record<string, true> = {}

    for (const source of sources) {
        if (handledSourcePaths[source]) {
            console.log('[Purge] skipping because source is already handled', source)
            continue
        }

        handledSourcePaths[source] = true

        const {
            root: srcRoot,
            dirPath: srcDirPath,
            type: srcType,
            remoteName: srcRemoteName,
        } = getFsInfo(source)

        if (srcType !== 'folder') {
            throw new Error('Only folders can be purged')
        }

        const srcOptions =
            options.remotes && srcRemoteName && srcRemoteName in options.remotes
                ? (JSON.parse(options.remotes[srcRemoteName] as unknown as string) as any)
                : undefined

        const jobParams: Parameters<typeof startBatch>[0][number] = {
            _path: 'operations/purge',
            fs: serializeOptions(srcRoot, {
                global: options.config,
                remote: srcOptions,
            }),
            remote: srcDirPath,
        }
        pendingJobs.push(jobParams)
    }

    return startBatch(pendingJobs)
}

export async function startServe({
    type,
    fs,
    addr,
    _filter,
    _config,
    ...props
}: {
    type: string
    fs: string
    addr: string
    _filter?: Record<string, FlagValue>
    _config?: Record<string, FlagValue>
} & Record<string, FlagValue>) {
    return rclone('/serve/start', {
        params: {
            query: {
                type,
                fs,
                addr,
                _filter:
                    _filter && Object.keys(_filter).length > 0
                        ? JSON.stringify(parseRcloneOptions(_filter))
                        : undefined,
                _config:
                    _config && Object.keys(_config).length > 0
                        ? JSON.stringify(parseRcloneOptions(_config))
                        : undefined,
                ...(props && Object.keys(props).length > 0
                    ? Object.fromEntries(
                          Object.entries(props).map(([key, value]) => [
                              key,
                              Array.isArray(value) ? value.join(',') : value,
                          ])
                      )
                    : {}),
            },
        },
    })
}

export async function startBatch(inputs: ({ _path: string } & Record<string, any>)[]) {
    console.log('[startBatch] starting batch operation', {
        inputCount: inputs.length,
        paths: inputs.map((i) => i._path),
    })
    console.log('[startBatch] inputs', JSON.stringify(inputs, null, 2))

    const r = await pRetry(
        async () =>
            await rclone('/job/batch', {
                body: {
                    inputs,
                    _async: true,
                },
            }),
        {
            retries: 3,
        }
    )

    console.log('[startBatch] job created', { jobid: r.jobid })

    await new Promise((resolve) => setTimeout(resolve, 1000))

    const jobStatus = await pRetry(
        async () =>
            await rclone('/job/status', {
                params: {
                    query: {
                        jobid: r.jobid,
                    },
                },
            }),
        {
            retries: 3,
        }
    ).catch(null)

    console.log('[startBatch] jobStatus', {
        jobid: r.jobid,
        finished: jobStatus?.finished,
        success: jobStatus?.success,
        error: jobStatus?.error,
    })
    console.log('[startBatch] jobStatus full', JSON.stringify(jobStatus, null, 2))

    if (!jobStatus) {
        console.error('[startBatch] ERROR: job status is null', { jobid: r.jobid })
        throw new Error('Failed to start operation')
    }

    const output = jobStatus.output as any
    if (
        output?.results &&
        Array.isArray(output.results) &&
        output.results.length === inputs.length
    ) {
        const results = output.results
        const allFailed = results.every((res: any) => res.error)

        if (allFailed) {
            const errorMessages = results
                .map((res: any) => {
                    const path = res.input?.srcRemote || res.input?.dstRemote || 'unknown'
                    return `${path}: ${res.error}`
                })
                .join('\n')

            console.error('[startBatch] ERROR: all batch operations failed', {
                jobid: r.jobid,
                errorMessages,
            })
            throw new Error(errorMessages)
        }
    }

    if (jobStatus.error) {
        console.error('[startBatch] ERROR: job failed', { jobid: r.jobid, error: jobStatus.error })
        throw new Error(jobStatus.error)
    }

    console.log('[startBatch] SUCCESS', { jobid: r.jobid })
    return r.jobid
}

/* PASSWORD */
export async function removeConfigPassword() {
    console.log('[removeConfigPassword]')

    const state = useHostStore.getState()
    const activeConfig = state.activeConfigFile

    if (!activeConfig || !activeConfig.id) {
        throw new Error('No active configuration selected.')
    }

    if (!activeConfig.isEncrypted) {
        throw new Error('Configuration is not encrypted.')
    }

    try {
        await runRcloneCli(['config', 'encryption', 'remove'])
        state.updateConfigFile(activeConfig.id, {
            isEncrypted: false,
            pass: undefined,
            passCommand: undefined,
        })
        console.log('[removeConfigPassword] restarting rclone')
        await restartActiveRclone()
    } catch (error) {
        Sentry.captureException(error)
        await message(error instanceof Error ? error.message : 'Failed to disable encryption.', {
            title: 'Config Encryption',
            kind: 'error',
            okLabel: 'OK',
        })
        throw error
    }
}

export async function setConfigPassword(options: {
    password: string
    persist?: boolean
}) {
    console.log('[setConfigPassword]')

    const state = useHostStore.getState()
    const activeConfig = state.activeConfigFile

    if (!activeConfig || !activeConfig.id) {
        throw new Error('No active configuration selected.')
    }

    // if (!activeConfig.isEncrypted) {
    //     throw new Error('Configuration is not encrypted.')
    // }

    const password = options.password

    if (!password) {
        throw new Error('Password is required to update encryption.')
    }

    try {
        await runRcloneCli(['config', 'encryption', 'set'], [password, password])
        state.updateConfigFile(activeConfig.id, {
            isEncrypted: true,
            pass: options.persist ? password : undefined,
            passCommand: undefined,
        })

        console.log('[setConfigPassword] restarting rclone')
        await restartActiveRclone()
    } catch (error) {
        Sentry.captureException(error)
        await message(
            error instanceof Error ? error.message : 'Failed to update encryption password.',
            {
                title: 'Config Encryption',
                kind: 'error',
                okLabel: 'OK',
            }
        )
        throw error
    }
}

/* OTHERS */
export async function fetchServeList() {
    try {
        const response = await rclone('/serve/list')
        return response.list
    } catch (error) {
        console.error('[fetchServeList] failed to fetch active serves', error)
        return []
    }
}

export async function fetchMountList() {
    try {
        const response = await rclone('/mount/listmounts')
        return response.mountPoints
    } catch (error) {
        console.error('[fetchMountList] failed to fetch active mounts', error)
        return []
    }
}
