import type { FlagValue } from '../../types/rclone'
import { getFsInfo } from '../format'

// Pure serialization of operation args into ready-to-POST rclone RC requests. This is the
// single source for BOTH the live start* path (lib/rclone/api.ts) and the scheduler's job
// specs — they can never diverge. No HTTP, no store access: paths are machine-local strings and
// save/run always happen on the same machine.

const RE_WINDOWS_DRIVE_ROOT = /^:local:[a-zA-Z]:\/$/

export interface CopyArgs {
    sources: string[]
    destination: string
    options: {
        copy?: Record<string, FlagValue>
        config?: Record<string, FlagValue>
        filter?: Record<string, FlagValue>
        remotes?: Record<string, Record<string, FlagValue>>
    }
}

export interface MoveArgs {
    sources: string[]
    destination: string
    options: {
        move?: Record<string, FlagValue>
        config?: Record<string, FlagValue>
        filter?: Record<string, FlagValue>
        remotes?: Record<string, Record<string, FlagValue>>
    }
}

export interface SyncArgs {
    source: string
    destination: string
    options: {
        config?: Record<string, FlagValue>
        sync?: Record<string, FlagValue>
        filter?: Record<string, FlagValue>
        remotes?: Record<string, Record<string, FlagValue>>
    }
}

export interface BisyncArgs {
    source: string
    destination: string
    options: {
        config?: Record<string, FlagValue>
        bisync?: Record<string, FlagValue>
        filter?: Record<string, FlagValue>
        remotes?: Record<string, Record<string, FlagValue>>
        outer?: Record<string, FlagValue>
    }
}

export interface DeleteArgs {
    sources: string[]
    options: {
        filter?: Record<string, FlagValue>
        config?: Record<string, FlagValue>
        remotes?: Record<string, Record<string, FlagValue>>
    }
}

export interface PurgeArgs {
    sources: string[]
    options: {
        config?: Record<string, FlagValue>
        remotes?: Record<string, Record<string, FlagValue>>
    }
}

export type BatchInput = { _path: string } & Record<string, any>

export interface RcRequest {
    endpoint: '/job/batch' | '/sync/sync' | '/sync/bisync'
    // Always body-form with `_async: true`: the headless runner POSTs these verbatim (rclone's
    // RC treats body and query parameters identically). The live path converts back to the
    // query form its client uses.
    body: Record<string, any>
}

// Encodes a path as an rclone connection string with inlined per-remote and global options:
// "<remoteName>,<k>=\"v\",global.<gk>=\"gv\":<path>".
export function serializeOptions(
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

function assertIncludeRules(sources: string[], filter?: Record<string, FlagValue>) {
    if (sources.length > 1 && filter && ('include' in filter || 'include_from' in filter)) {
        throw new Error('Include rules are not supported with multiple sources')
    }
}

function remoteOptionsFor(
    remotes: Record<string, Record<string, FlagValue>> | undefined,
    remoteName: string | undefined
) {
    return remotes && remoteName && remoteName in remotes ? remotes[remoteName] : undefined
}

// Shared fan-out for copy/move: one batch input per source, de-duping repeats and children of
// folder sources, with the folder/file split deciding the RC method.
function buildTransferInputs(
    args: CopyArgs | MoveArgs,
    paths: { folder: string; file: string },
    mergedOptions: Record<string, FlagValue>
): BatchInput[] {
    const { sources, destination, options } = args

    const inputs: BatchInput[] = []
    const handledSourcePaths: Record<string, true> = {}
    const folderSources = sources.filter((path) => path.endsWith('/') || path.endsWith('\\'))

    const {
        root: dstRoot,
        dirPath: dstDirPath,
        fullDirPath: dstFullDirPath,
        remoteName: dstRemoteName,
    } = getFsInfo(destination)

    const dstOptions = remoteOptionsFor(options.remotes, dstRemoteName)

    for (const source of sources) {
        if (handledSourcePaths[source]) {
            console.log('[buildTransferInputs] skipping already handled source', source)
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

        const srcOptions = remoteOptionsFor(options.remotes, srcRemoteName)

        if (srcType === 'folder') {
            inputs.push({
                _path: paths.folder,
                srcFs: serializeOptions(srcFullDirPath, {
                    remote: srcOptions,
                    global: mergedOptions,
                }),
                dstFs: serializeOptions(`${dstFullDirPath}${srcName}`, {
                    remote: dstOptions,
                }),
                createEmptySrcDirs: true,
            })
            continue
        }

        if (folderSources.some((folder) => source.startsWith(folder))) {
            console.log('[buildTransferInputs] skipping child of handled folder', source)
            continue
        }

        inputs.push({
            _path: paths.file,
            srcFs: serializeOptions(srcRoot, {
                remote: srcOptions,
                global: mergedOptions,
            }),
            srcRemote: srcFilePath,
            dstFs: serializeOptions(dstRoot, {
                remote: dstOptions,
            }),
            dstRemote: `${dstDirPath === '/' ? '' : dstDirPath}${srcName}`,
        })
    }

    return inputs
}

export function buildCopyRequests(args: CopyArgs): RcRequest[] {
    assertIncludeRules(args.sources, args.options.filter)
    const mergedOptions = {
        ...(args.options.config || {}),
        ...(args.options.copy || {}),
        ...(args.options.filter || {}),
    }
    const inputs = buildTransferInputs(
        args,
        { folder: 'sync/copy', file: 'operations/copyfile' },
        mergedOptions
    )
    return [{ endpoint: '/job/batch', body: { inputs, _async: true } }]
}

export function buildMoveRequests(args: MoveArgs): RcRequest[] {
    assertIncludeRules(args.sources, args.options.filter)
    const mergedOptions = {
        ...(args.options.config || {}),
        ...(args.options.move || {}),
        ...(args.options.filter || {}),
    }
    const inputs = buildTransferInputs(
        args,
        { folder: 'sync/move', file: 'operations/movefile' },
        mergedOptions
    )
    return [{ endpoint: '/job/batch', body: { inputs, _async: true } }]
}

export function buildSyncRequests(args: SyncArgs): RcRequest[] {
    const { source, destination, options } = args

    const mergedOptions = {
        ...(options.config || {}),
        ...(options.sync || {}),
        ...(options.filter || {}),
    }

    const { fullDirPath: srcFullDirPath, remoteName: srcRemoteName } = getFsInfo(source)
    const { fullDirPath: dstFullDirPath, remoteName: dstRemoteName } = getFsInfo(destination)

    return [
        {
            endpoint: '/sync/sync',
            body: {
                srcFs: serializeOptions(srcFullDirPath, {
                    global: mergedOptions,
                    remote: remoteOptionsFor(options.remotes, srcRemoteName),
                }),
                dstFs: serializeOptions(dstFullDirPath, {
                    remote: remoteOptionsFor(options.remotes, dstRemoteName),
                }),
                createEmptySrcDirs: true,
                _async: true,
            },
        },
    ]
}

export function buildBisyncRequests(args: BisyncArgs): RcRequest[] {
    const { source, destination, options } = args

    const mergedOptions = {
        ...(options.config || {}),
        ...(options.bisync || {}),
        ...(options.filter || {}),
    }

    const { fullDirPath: srcFullDirPath, remoteName: srcRemoteName } = getFsInfo(source)
    const { fullDirPath: dstFullDirPath, remoteName: dstRemoteName } = getFsInfo(destination)

    return [
        {
            endpoint: '/sync/bisync',
            body: {
                path1: serializeOptions(srcFullDirPath, {
                    global: mergedOptions,
                    remote: remoteOptionsFor(options.remotes, srcRemoteName),
                }),
                path2: serializeOptions(dstFullDirPath, {
                    remote: remoteOptionsFor(options.remotes, dstRemoteName),
                }),
                ...(options.outer && Object.keys(options.outer).length > 0
                    ? Object.fromEntries(
                          Object.entries(options.outer).map(([key, value]) => [
                              key,
                              Array.isArray(value) ? value.join(',') : value,
                          ])
                      )
                    : {}),
                _async: true,
            },
        },
    ]
}

export function buildDeleteRequests(args: DeleteArgs): RcRequest[] {
    const { sources, options } = args

    assertIncludeRules(sources, options.filter)

    const mergedOptions = {
        ...(options.config || {}),
        ...(options.filter || {}),
    }

    const inputs: BatchInput[] = []
    const handledSourcePaths: Record<string, true> = {}
    const folderSources = sources.filter((path) => path.endsWith('/') || path.endsWith('\\'))

    for (const source of sources) {
        if (handledSourcePaths[source]) {
            console.log('[buildDeleteRequests] skipping already handled source', source)
            continue
        }

        handledSourcePaths[source] = true

        const {
            root: srcRoot,
            filePath: srcFilePath,
            type: srcType,
            remoteName: srcRemoteName,
        } = getFsInfo(source)

        const srcOptions = remoteOptionsFor(options.remotes, srcRemoteName)

        if (srcType === 'folder') {
            inputs.push({
                _path: 'operations/delete',
                fs: serializeOptions(source, {
                    global: mergedOptions,
                    remote: srcOptions,
                }),
            })
            continue
        }

        if (folderSources.some((folder) => source.startsWith(folder))) {
            console.log('[buildDeleteRequests] skipping child of handled folder', source)
            continue
        }

        inputs.push({
            _path: 'operations/deletefile',
            fs: serializeOptions(srcRoot, {
                global: mergedOptions,
                remote: srcOptions,
            }),
            remote: srcFilePath,
        })
    }

    return [{ endpoint: '/job/batch', body: { inputs, _async: true } }]
}

export function buildPurgeRequests(args: PurgeArgs): RcRequest[] {
    const { sources, options } = args

    const inputs: BatchInput[] = []
    const handledSourcePaths: Record<string, true> = {}

    for (const source of sources) {
        if (handledSourcePaths[source]) {
            console.log('[buildPurgeRequests] skipping already handled source', source)
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

        inputs.push({
            _path: 'operations/purge',
            fs: serializeOptions(srcRoot, {
                global: options.config,
                remote: remoteOptionsFor(options.remotes, srcRemoteName),
            }),
            remote: srcDirPath,
        })
    }

    return [{ endpoint: '/job/batch', body: { inputs, _async: true } }]
}

/** Discriminated operation/args pair — ScheduledTask satisfies this. */
export type TaskRequestInput =
    | { operation: 'copy'; args: CopyArgs }
    | { operation: 'move'; args: MoveArgs }
    | { operation: 'sync'; args: SyncArgs }
    | { operation: 'bisync'; args: BisyncArgs }
    | { operation: 'delete'; args: DeleteArgs }
    | { operation: 'purge'; args: PurgeArgs }

/** Builds the RC requests for a scheduled task — throws when the args can't serialize. */
export function buildTaskRequests(task: TaskRequestInput): RcRequest[] {
    switch (task.operation) {
        case 'copy':
            return buildCopyRequests(task.args)
        case 'move':
            return buildMoveRequests(task.args)
        case 'sync':
            return buildSyncRequests(task.args)
        case 'bisync':
            return buildBisyncRequests(task.args)
        case 'delete':
            return buildDeleteRequests(task.args)
        case 'purge':
            return buildPurgeRequests(task.args)
        default:
            throw new Error(`Unknown operation: ${(task as { operation: string }).operation}`)
    }
}
