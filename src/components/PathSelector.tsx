import {
    Button,
    Divider,
    Drawer,
    DrawerBody,
    DrawerContent,
    Input,
    Table,
    TableBody,
    TableCell,
    TableColumn,
    TableHeader,
    TableRow,
    Tooltip,
} from '@heroui/react'
import { dirname, homeDir, join, sep } from '@tauri-apps/api/path'
import { readDir } from '@tauri-apps/plugin-fs'
import { ArrowLeftIcon, ArrowUpIcon, LaptopIcon, StarIcon, XIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { Key } from 'react'
import { formatBytes } from '../../lib/format.ts'
import { getRemote, listPath } from '../../lib/rclone/api.ts'
import { usePersistedStore, useStore } from '../../lib/store.ts'

async function joinLocal(base: string, name: string) {
    if (!base) return join(sep(), name)
    return join(base, name)
}

async function getLocalParent(path: string) {
    if (!path) return ''
    return dirname(path)
}

function getRemoteParent(path: string) {
    if (!path) return ''
    const parts = path.split('/').filter(Boolean)
    if (parts.length === 0) return ''
    return parts.slice(0, -1).join('/')
}

function serializeRemotePath(remote: string, relPath: string) {
    return `${remote}:/${relPath}`
}

function cacheKey(remote: string | 'UI_LOCAL_FS' | null, dir: string) {
    return `${remote ?? 'NONE'}::${dir || '/'}`
}

function normalizeRemoteDir(path: string) {
    if (!path) return ''
    const cleaned = path.replace(/\\/g, '/').replace(/\/+$/g, '')
    return cleaned
}

async function listRemotePath(
    remote: string,
    dir: string,
    options: { noModTime?: boolean; noMimeType?: boolean }
) {
    const base = normalizeRemoteDir(dir)
    const slashed = base ? `${base}/` : ''
    const tasks: Promise<any>[] = []
    tasks.push(listPath(remote, base, options))
    if (slashed) {
        tasks.push(listPath(remote, slashed, options))
    }
    const settled = await Promise.allSettled(tasks)
    const merged: any[] = []
    let anyFulfilled = false
    for (let i = 0; i < settled.length; i++) {
        const r = settled[i]
        if (r.status === 'fulfilled' && Array.isArray(r.value)) {
            anyFulfilled = true
            for (let j = 0; j < r.value.length; j++) {
                merged.push(r.value[j])
            }
        }
    }
    if (!anyFulfilled) {
        // Intentionally throw here so callers can uniformly handle unreachable/forbidden
        // Note: throwing here avoids "throw inside try" in callers if they avoid inline throws
        throw new Error('No access or folder does not exist')
    }
    // de-duplicate by Path or Name
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
    return { list: deduped, baseDir: base }
}

type SelectItem = { path: string; type: 'file' | 'folder' }

type RemoteString = string | 'UI_LOCAL_FS' | 'UI_FAVORITES' | null
type Entry = {
    key: string
    name: string
    isDir: boolean
    size?: number
    modTime?: string
    remote?: string | 'UI_LOCAL_FS'
    fullPath: string // serialized returned path (remote:/path or local absolute)
}

export default function PathSelector({
    onClose,
    onSelect,
    initialPaths = [],
    isOpen = true,
    allowedKeys = ['REMOTES', 'LOCAL_FS', 'FAVORITES'],
    allowFiles = true,
    allowMultiple = true,
}: {
    onClose: () => void
    onSelect?: (items: SelectItem[]) => void
    initialPaths?: string[]
    isOpen?: boolean
    allowedKeys?: ('REMOTES' | 'LOCAL_FS' | 'FAVORITES')[]
    allowFiles?: boolean
    allowMultiple?: boolean
}) {
    const favoritePaths = usePersistedStore((state) => state.favoritePaths)
    const remotes = useStore((state) => state.remotes)
    const [selectedRemote, setSelectedRemote] = useState<RemoteString>(null)

    const [cwd, setCwd] = useState<string>('')
    const [pathInput, setPathInput] = useState<string>('')
    const [items, setItems] = useState<Entry[]>([])

    const [isSelecting, setIsSelecting] = useState(false)
    const selectionMode = allowMultiple ? 'multiple' : 'single'

    const [isLoading, setIsLoading] = useState<boolean>(false)
    const [error, setError] = useState<string | null>(null)

    const isRemote = selectedRemote !== 'UI_LOCAL_FS' && selectedRemote !== 'UI_FAVORITES'
    const canShowFavorites = allowedKeys.includes('FAVORITES')
    const canShowLocal = allowedKeys.includes('LOCAL_FS')
    const canShowRemotes = allowedKeys.includes('REMOTES')

    const cacheRef = useRef<Map<string, Entry[]>>(new Map())
    const entryByKeyRef = useRef<Map<string, Entry>>(new Map())
    const abortControllerRef = useRef<AbortController | null>(null)
    const loadingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set())
    const selectedTypesRef = useRef<Map<string, 'file' | 'folder'>>(new Map())

    // Filter items shown in the table based on allowedTypes.
    // - When only folders are allowed: show only folders
    // - When only files are allowed: show folders (to allow navigation) and files
    // - When both are allowed: show all
    const visibleItems = (() => {
        if (!allowFiles) return items.filter((it) => it.isDir)
        // only files allowed -> keep folders visible for navigation
        return items
    })()

    const visibleSelectedKeys = (() => {
        const visible = new Set<string>()
        for (const v of visibleItems) {
            if (selectedPaths.has(v.key)) visible.add(v.key)
        }
        return visible
    })()

    const selectedCount = selectedPaths.size
    const [isUpDisabled, setIsUpDisabled] = useState(false)

    const favoritedKeys = (() => {
        const map: Record<string, (typeof favoritePaths)[number]> = {}
        for (const it of favoritePaths) {
            const remote = (it as any).remote as string | undefined
            const rawPath = (it as any).path as string
            let fullKey = rawPath
            if (rawPath?.includes(':/')) {
                fullKey = rawPath
            } else if (remote && remote !== 'UI_LOCAL_FS') {
                const rel = (rawPath || '').replace(/^\/+/, '')
                fullKey = serializeRemotePath(remote, rel)
            } else {
                fullKey = rawPath
            }
            if (fullKey) map[fullKey] = it
        }
        return map
    })()

    // Clean up selection when switching remotes
    function cleanupSelectionForRemote(newRemote: RemoteString) {
        if (newRemote !== selectedRemote) {
            setSelectedPaths(new Set())
            selectedTypesRef.current.clear()
            // Also clean up stale entries from entryByKeyRef
            const currentPrefix = selectedRemote === 'UI_LOCAL_FS' ? '' : `${selectedRemote}:`
            const keysToRemove: string[] = []
            for (const key of entryByKeyRef.current.keys()) {
                if (selectedRemote === 'UI_LOCAL_FS' && !key.includes(':/')) {
                    keysToRemove.push(key)
                } else if (selectedRemote !== 'UI_LOCAL_FS' && key.startsWith(currentPrefix)) {
                    keysToRemove.push(key)
                }
            }
            for (const key of keysToRemove) {
                entryByKeyRef.current.delete(key)
            }
        }
    }

    function updatePathInput(nextRemote: RemoteString, nextCwd: string) {
        if (!nextRemote) {
            setPathInput('')
            return
        }
        if (nextRemote === 'UI_FAVORITES') {
            setPathInput('')
            return
        }
        if (nextRemote === 'UI_LOCAL_FS') {
            setPathInput(nextCwd || '')
        } else {
            setPathInput(`${nextRemote}:/${nextCwd || ''}`)
        }
    }

    async function handleRowClick(entry: Entry) {
        if (isSelecting) return
        if (!entry.isDir) return
        if (!selectedRemote) return
        if (selectedRemote === 'UI_FAVORITES') {
            // Jump into the actual directory represented by this favorite
            const full = entry.fullPath
            if (full.includes(':/')) {
                const [remoteName, ...rest] = full.split(':/')
                const rel = rest.join('/')
                cleanupSelectionForRemote(remoteName as any)
                setSelectedRemote(remoteName as any)
                setCwd(rel)
            } else {
                cleanupSelectionForRemote('UI_LOCAL_FS')
                setSelectedRemote('UI_LOCAL_FS')
                setCwd(full)
            }
            return
        }
        if (isRemote) {
            const base = cwd ? `${cwd}/` : ''
            setCwd(`${base}${entry.name}`)
        } else {
            const newPath = await joinLocal(cwd, entry.name)
            setCwd(newPath)
        }
    }

    async function navigateUp() {
        if (!selectedRemote) return
        if (isRemote) {
            const parent = getRemoteParent(cwd)
            setCwd(parent)
        }
        if (selectedRemote === 'UI_LOCAL_FS') {
            const parent = await getLocalParent(cwd)
            setCwd(parent)
            return
        }
        // UI_FAVORITES -> no-op
    }

    function handleSelectionChange(keys: Set<Key> | 'all') {
        if (!isSelecting) return
        if (keys === 'all') return
        const prev = selectedPaths
        const next = new Set(selectedPaths)
        const visible = new Set(items.map((i) => i.key))
        // remove visible deselected
        for (const k of Array.from(prev)) {
            if (visible.has(k) && !keys.has(k)) {
                next.delete(k)
                selectedTypesRef.current.delete(k)
            }
        }
        // add newly selected visible
        for (const k of Array.from(keys)) {
            if (typeof k === 'string' && !prev.has(k)) {
                next.add(k)
                const e = entryByKeyRef.current.get(k)
                if (e) selectedTypesRef.current.set(k, e.isDir ? 'folder' : 'file')
            }
        }
        setSelectedPaths(next)
    }

    function handleConfirm() {
        const paths = Array.from(selectedPaths)
        const results: SelectItem[] = paths.map((path) => {
            const known = selectedTypesRef.current.get(path)
            if (known) return { path, type: known }
            const entry = entryByKeyRef.current.get(path)
            if (entry) return { path, type: entry.isDir ? 'folder' : 'file' }
            // Fallback for edge cases
            if (path.includes(':/')) {
                const rel = path.split(':/').slice(1).join('/')
                return { path, type: rel.endsWith('/') ? 'folder' : 'file' }
            }
            return { path, type: 'file' }
        })
        onSelect?.(results)
    }

    // Clear caches when open state changes and cleanup entries
    useEffect(() => {
        cacheRef.current.clear()
        entryByKeyRef.current.clear()
        selectedTypesRef.current.clear()

        if (isOpen) {
            if (canShowLocal) {
                setIsLoading(true)
                setTimeout(async () => {
                    setSelectedRemote('UI_LOCAL_FS')
                    const home = await homeDir()
                    setCwd(home)
                    setPathInput(home)
                    setIsLoading(false)
                }, 100)
            } else if (canShowFavorites) {
                setIsLoading(true)
                setTimeout(() => {
                    setSelectedRemote('UI_FAVORITES')
                    setIsLoading(false)
                }, 100)
            }
        } else {
            abortControllerRef.current?.abort()
            setIsSelecting(false)
            setSelectedPaths(new Set())
            setItems([])
            setSelectedRemote(null)
            setCwd('')
            setPathInput('')
            setError(null)
            setIsLoading(false)
        }
    }, [isOpen, canShowLocal, canShowFavorites])

    // Initialize from initialPaths
    // biome-ignore lint/correctness/useExhaustiveDependencies: <compiler>
    useEffect(() => {
        async function initializePaths() {
            if (!initialPaths || initialPaths.length === 0) {
                return
            }

            // seed selection set
            setSelectedPaths(new Set(initialPaths))

            const first = initialPaths[0]
            if (first.includes(':/')) {
                const [remote, ...rest] = first.split(':/')
                const rel = rest.join('/')
                const parent = getRemoteParent(rel)
                setSelectedRemote(remote)
                setCwd(parent)
                updatePathInput(remote, parent)
            } else {
                const parent = await getLocalParent(first)
                setSelectedRemote('UI_LOCAL_FS')
                setCwd(parent)
                updatePathInput('UI_LOCAL_FS', parent)
            }
        }
        initializePaths()
    }, [initialPaths])

    // Load directory content when remote/cwd changes
    useEffect(() => {
        async function loadDir() {
            if (!selectedRemote) {
                setItems([])
                setError(null)
                setIsLoading(false)
                return
            }

            // Cancel previous request
            if (abortControllerRef.current) {
                abortControllerRef.current.abort()
            }
            if (loadingTimerRef.current) {
                clearTimeout(loadingTimerRef.current)
                loadingTimerRef.current = null
            }

            const controller = new AbortController()
            abortControllerRef.current = controller

            let finished = false
            setError(null)
            loadingTimerRef.current = setTimeout(() => {
                if (!controller.signal.aborted && !finished) {
                    setIsLoading(true)
                }
            }, 200)

            const cKey = cacheKey(selectedRemote, cwd)
            if (cacheRef.current.has(cKey)) {
                const cached = cacheRef.current.get(cKey)!
                setItems(cached)
            }

            let nextItems: Entry[] = []
            if (selectedRemote === 'UI_FAVORITES') {
                // Build favorites list
                nextItems = (favoritePaths || []).map((fav) => {
                    const remote = (fav as any).remote as string | undefined
                    const isLocal = !remote || remote === 'UI_LOCAL_FS'
                    const rawPath = (fav as any).path as string
                    let fullPath = rawPath
                    if (!isLocal) {
                        if (rawPath.includes(':/')) {
                            fullPath = rawPath
                        } else {
                            const rel = (rawPath || '').replace(/^\/+/, '')
                            fullPath = serializeRemotePath(remote!, rel)
                        }
                    }
                    // Derive basename from relative or absolute path
                    const relForName = (() => {
                        if (!isLocal) {
                            if (rawPath.includes(':/')) {
                                return rawPath.split(':/').slice(1).join('/')
                            }
                            return rawPath
                        }
                        return rawPath
                    })()
                    const normalized = (relForName || '').replace(/\\/g, '/').replace(/\/+$/g, '')
                    const baseName = normalized.split('/').pop() || ''
                    const prefix = isLocal ? '(LOCAL)' : `(${remote})`
                    const addedLabel = `Added on ${new Date((fav as any).added).toLocaleString()}`
                    return {
                        key: fullPath,
                        name: `${prefix} ${baseName}`,
                        isDir: true,
                        size: undefined,
                        modTime: addedLabel,
                        remote: isLocal ? 'UI_LOCAL_FS' : remote,
                        fullPath,
                    } as Entry
                })
                // sort by name asc (all dirs)
                nextItems.sort((a, b) => a.name.localeCompare(b.name))
                // Update cache and maps only if not aborted
                if (!controller.signal.aborted) {
                    finished = true
                    if (loadingTimerRef.current) {
                        clearTimeout(loadingTimerRef.current)
                        loadingTimerRef.current = null
                    }
                    cacheRef.current.set(cKey, nextItems)
                    const map = entryByKeyRef.current
                    for (let i = 0; i < nextItems.length; i++) {
                        const e = nextItems[i]
                        map.set(e.key, e)
                    }
                    setItems(nextItems)
                    setIsLoading(false)
                }
                return
            }
            if (isRemote) {
                const remote = selectedRemote as string
                let targetCwd = cwd
                if (!targetCwd) {
                    targetCwd = ''
                }
                let listedItems: { list: any[] } | null = null
                try {
                    listedItems = await listRemotePath(remote, targetCwd, {
                        noModTime: false,
                        noMimeType: true,
                    })
                } catch (_err: unknown) {
                    if (!controller.signal.aborted) {
                        finished = true
                        if (loadingTimerRef.current) {
                            clearTimeout(loadingTimerRef.current)
                            loadingTimerRef.current = null
                        }
                        setIsLoading(false)
                        setItems([])
                        setError('No access or folder does not exist')
                    }
                    return
                }

                // Check if request was aborted
                if (controller.signal.aborted) {
                    return
                }

                nextItems = (listedItems?.list || [])
                    .map((it) => {
                        const rel = (it.Path || it.Name || '') as string
                        const baseName = rel.split('/').pop() || ''
                        const isDir = !!(it.IsDir || (it as any).IsBucket)
                        const full = serializeRemotePath(remote, rel)
                        return {
                            key: full,
                            name: baseName,
                            isDir,
                            size: it.Size,
                            modTime: it.ModTime,
                            remote,
                            fullPath: full,
                        } as Entry
                    })
                    .filter((e) => !e.name.startsWith('.'))
            } else if (cwd) {
                // Local filesystem
                let entries: Awaited<ReturnType<typeof readDir>> | null = null
                try {
                    entries = await readDir(cwd)
                } catch {
                    if (!controller.signal.aborted) {
                        finished = true
                        if (loadingTimerRef.current) {
                            clearTimeout(loadingTimerRef.current)
                            loadingTimerRef.current = null
                        }
                        setIsLoading(false)
                        setItems([])
                        setError('No access or folder does not exist')
                    }
                    return
                }

                // Check if request was aborted
                if (controller.signal.aborted) {
                    return
                }

                const processedEntries: Entry[] = []
                for (const e of entries || []) {
                    // Skip symlinks to avoid circular references
                    if (e.isSymlink) continue
                    const full = await joinLocal(cwd, e.name)
                    processedEntries.push({
                        key: full,
                        name: e.name,
                        isDir: e.isDirectory,
                        fullPath: full,
                    } as Entry)
                }
                nextItems = processedEntries.filter((e) => !e.name.startsWith('.'))
            } else {
                nextItems = []
            }

            // Check if request was aborted
            if (controller.signal.aborted) {
                return
            }

            // sort: dirs first, name asc
            nextItems.sort((a, b) => {
                if (a.isDir && !b.isDir) return -1
                if (!a.isDir && b.isDir) return 1
                return a.name.localeCompare(b.name)
            })

            // Update cache and maps only if not aborted
            if (!controller.signal.aborted) {
                finished = true
                if (loadingTimerRef.current) {
                    clearTimeout(loadingTimerRef.current)
                    loadingTimerRef.current = null
                }
                cacheRef.current.set(cKey, nextItems)
                const map = entryByKeyRef.current
                for (let i = 0; i < nextItems.length; i++) {
                    const e = nextItems[i]
                    map.set(e.key, e)
                }
                setItems(nextItems)
                setIsLoading(false)
            }
        }

        loadDir()

        // Cleanup function
        return () => {
            if (abortControllerRef.current) {
                abortControllerRef.current.abort()
            }
            if (loadingTimerRef.current) {
                clearTimeout(loadingTimerRef.current)
                loadingTimerRef.current = null
            }
        }
    }, [selectedRemote, cwd, isRemote, favoritePaths])

    // biome-ignore lint/correctness/useExhaustiveDependencies: <compiler>
    useEffect(() => {
        updatePathInput(selectedRemote, cwd)
    }, [selectedRemote, cwd])

    // Update up button disabled state
    useEffect(() => {
        let cancelled = false
        async function updateUpState() {
            if (!selectedRemote) {
                if (!cancelled) setIsUpDisabled(true)
                return
            }
            if (isRemote) {
                if (!cancelled) setIsUpDisabled(cwd === '')
                return
            }
            const current = cwd
            if (!current) {
                if (!cancelled) setIsUpDisabled(true)
                return
            }
            let parent = ''
            try {
                parent = await getLocalParent(current)
            } catch {
                parent = current
            }
            if (cancelled) return
            setIsUpDisabled(parent === current) // At root when dirname equals self
        }
        updateUpState()
        return () => {
            cancelled = true
        }
    }, [selectedRemote, cwd, isRemote])

    return (
        <Drawer
            isOpen={isOpen}
            placement={'bottom'}
            size="full"
            onClose={onClose}
            hideCloseButton={true}
        >
            <DrawerContent>
                {(close) => (
                    <DrawerBody className="flex flex-row w-full gap-0 p-0">
                        <div className="flex flex-col items-center w-20 h-full bg-red-500/0">
                            <Tooltip
                                content={'Dismiss'}
                                placement="right"
                                size="lg"
                                color="foreground"
                            >
                                <Button
                                    isIconOnly={true}
                                    size="md"
                                    className="flex-shrink-0 w-full h-12 p-0 border-0 rounded-none"
                                    onPress={close}
                                    variant="faded"
                                    color="danger"
                                >
                                    <ArrowLeftIcon className="size-5" />
                                </Button>
                            </Tooltip>
                            <Divider />

                            <div className="flex flex-col items-center w-full h-full gap-5 py-4 overflow-y-auto bg-blue-500/0">
                                {canShowFavorites && (
                                    <Tooltip
                                        content={'Favorites'}
                                        placement="right"
                                        size="lg"
                                        color="foreground"
                                    >
                                        <Button
                                            isIconOnly={true}
                                            className="shrink-0"
                                            size="lg"
                                            variant="light"
                                            onPress={() => {
                                                cleanupSelectionForRemote('UI_FAVORITES')
                                                setIsSelecting(false)
                                                setSelectedRemote('UI_FAVORITES')
                                                setCwd('')
                                            }}
                                        >
                                            <StarIcon
                                                className={'size-6 stroke-warning fill-warning'}
                                            />
                                        </Button>
                                    </Tooltip>
                                )}
                                {canShowLocal && (
                                    <Tooltip
                                        content={'Local Filesystem'}
                                        placement="right"
                                        color="foreground"
                                        size="lg"
                                    >
                                        <Button
                                            isIconOnly={true}
                                            className="shrink-0"
                                            size="lg"
                                            onPress={() => {
                                                cleanupSelectionForRemote('UI_LOCAL_FS')
                                                setIsSelecting(false)
                                                setSelectedRemote('UI_LOCAL_FS')
                                                setCwd('/')
                                            }}
                                            variant={
                                                selectedRemote === 'UI_LOCAL_FS' ? 'faded' : 'light'
                                            }
                                        >
                                            <LaptopIcon className="size-6" />
                                        </Button>
                                    </Tooltip>
                                )}
                                {canShowRemotes &&
                                    remotes.map((remote) => (
                                        <RemoteButton
                                            remote={remote}
                                            key={remote}
                                            onSelect={() => {
                                                cleanupSelectionForRemote(remote)
                                                setIsSelecting(false)
                                                setSelectedRemote(remote)
                                                setCwd('')
                                            }}
                                            isSelected={selectedRemote === remote}
                                        />
                                    ))}
                            </div>
                        </div>

                        <Divider orientation="vertical" />

                        <div className="flex flex-col w-full h-full overflow-y-hidden">
                            <Tooltip
                                content="Press Enter to navigate"
                                placement="bottom"
                                size="lg"
                                color="foreground"
                                offset={20}
                            >
                                <Input
                                    placeholder="Enter path"
                                    fullWidth={true}
                                    radius="none"
                                    variant="flat"
                                    size="lg"
                                    value={
                                        selectedRemote === 'UI_FAVORITES' ? 'FAVORITES' : pathInput
                                    }
                                    onChange={(e) => setPathInput(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key !== 'Enter') return
                                        const value = pathInput.trim()
                                        if (!value) return
                                        if (value.includes(':/')) {
                                            const [remote, ...rest] = value.split(':/')
                                            const rel = rest.join('/')
                                            setSelectedRemote(remote)
                                            setCwd(rel)
                                        } else {
                                            setSelectedRemote('UI_LOCAL_FS')
                                            setCwd(value)
                                        }
                                    }}
                                    isReadOnly={selectedRemote === 'UI_FAVORITES'}
                                />
                            </Tooltip>
                            <Divider />

                            <div className="flex flex-col w-full h-full overflow-y-auto overscroll-y-none">
                                <Table
                                    radius="none"
                                    isHeaderSticky={true}
                                    isStriped={true}
                                    shadow="none"
                                    isVirtualized={true}
                                    selectionMode={isSelecting ? selectionMode : 'none'}
                                    selectedKeys={isSelecting ? visibleSelectedKeys : new Set([])}
                                    onSelectionChange={handleSelectionChange}
                                    showSelectionCheckboxes={isSelecting && allowMultiple}
                                    maxTableHeight={650}
                                    classNames={{
                                        'wrapper': 'p-0 overscroll-y-none pb-20',
                                        'th': '!rounded-none',
                                        'td': 'before:!rounded-none',
                                    }}
                                >
                                    <TableHeader>
                                        <TableColumn className="w-6/12">Name</TableColumn>
                                        <TableColumn className="w-2/12">Size</TableColumn>
                                        <TableColumn className="w-3/12">Last Modified</TableColumn>
                                        <TableColumn className="w-1/12">{''}</TableColumn>
                                    </TableHeader>
                                    <TableBody
                                        items={visibleItems}
                                        isLoading={isLoading}
                                        loadingContent={
                                            <div className="absolute top-0 bottom-0 left-0 right-0 flex items-center justify-center w-full h-full bg-black/10 animate-blink" />
                                        }
                                        emptyContent={error || 'No items'}
                                    >
                                        {(entry: Entry) => (
                                            <TableRow
                                                key={entry.key}
                                                onDoubleClick={() => handleRowClick(entry)}
                                                className="group"
                                            >
                                                <TableCell>
                                                    {entry.isDir ? '📂' : '📄'} {entry.name}
                                                </TableCell>
                                                <TableCell>
                                                    {!entry.isDir && typeof entry.size === 'number'
                                                        ? formatBytes(entry.size)
                                                        : '—'}
                                                </TableCell>
                                                <TableCell>
                                                    {entry.modTime ? entry.modTime : '—'}
                                                </TableCell>
                                                <TableCell>
                                                    {entry.isDir && !favoritedKeys[entry.key] && (
                                                        <Button
                                                            isIconOnly={true}
                                                            size="sm"
                                                            variant="light"
                                                            color="warning"
                                                            className="transition-opacity duration-300 opacity-0 group-hover:opacity-100"
                                                            onPress={() => {
                                                                const storedPath =
                                                                    entry.fullPath.includes(':/')
                                                                        ? entry.fullPath
                                                                              .split(':/')
                                                                              .slice(1)
                                                                              .join('/')
                                                                        : entry.fullPath
                                                                usePersistedStore.setState({
                                                                    favoritePaths: [
                                                                        ...(favoritePaths || []),
                                                                        {
                                                                            remote: entry.remote!,
                                                                            path: storedPath,
                                                                            added: Date.now(),
                                                                        },
                                                                    ],
                                                                })
                                                            }}
                                                        >
                                                            <StarIcon className="size-5" />
                                                        </Button>
                                                    )}
                                                    {entry.isDir && favoritedKeys[entry.key] && (
                                                        <Button
                                                            isIconOnly={true}
                                                            size="sm"
                                                            variant="light"
                                                            color="warning"
                                                            className="transition-opacity duration-300 opacity-0 group-hover:opacity-100"
                                                            onPress={() => {
                                                                usePersistedStore.setState({
                                                                    favoritePaths: [
                                                                        ...(
                                                                            favoritePaths || []
                                                                        ).filter((it) => {
                                                                            const remote = (
                                                                                it as any
                                                                            ).remote as
                                                                                | string
                                                                                | undefined
                                                                            const rawPath = (
                                                                                it as any
                                                                            ).path as string
                                                                            let fullKey = rawPath
                                                                            if (
                                                                                rawPath?.includes(
                                                                                    ':/'
                                                                                )
                                                                            ) {
                                                                                fullKey = rawPath
                                                                            } else if (
                                                                                remote &&
                                                                                remote !==
                                                                                    'UI_LOCAL_FS'
                                                                            ) {
                                                                                const rel = (
                                                                                    rawPath || ''
                                                                                ).replace(
                                                                                    /^\/+/,
                                                                                    ''
                                                                                )
                                                                                fullKey =
                                                                                    serializeRemotePath(
                                                                                        remote,
                                                                                        rel
                                                                                    )
                                                                            } else {
                                                                                fullKey = rawPath
                                                                            }
                                                                            return (
                                                                                fullKey !==
                                                                                entry.fullPath
                                                                            )
                                                                        }),
                                                                    ],
                                                                })
                                                            }}
                                                        >
                                                            <StarIcon className="size-5 fill-warning" />
                                                        </Button>
                                                    )}
                                                </TableCell>
                                            </TableRow>
                                        )}
                                    </TableBody>
                                </Table>
                            </div>

                            {selectedRemote !== 'UI_FAVORITES' && (
                                <div className="absolute left-0 right-0 flex justify-center gap-2 bottom-5">
                                    {!isSelecting && (
                                        <Tooltip
                                            content="Go to parent directory"
                                            size="lg"
                                            color="foreground"
                                        >
                                            <Button
                                                isIconOnly={true}
                                                variant="faded"
                                                size="lg"
                                                onPress={navigateUp}
                                                isDisabled={isUpDisabled}
                                            >
                                                <ArrowUpIcon className="size-4" />
                                            </Button>
                                        </Tooltip>
                                    )}
                                    {!isSelecting && (
                                        <Button
                                            color="primary"
                                            size="lg"
                                            variant={'faded'}
                                            onPress={() => setIsSelecting(true)}
                                        >
                                            Enable selection mode
                                        </Button>
                                    )}
                                    {isSelecting && (
                                        <Button
                                            color="primary"
                                            size="lg"
                                            variant={'solid'}
                                            onPress={handleConfirm}
                                            isDisabled={selectedCount === 0}
                                        >
                                            {selectedCount === 0
                                                ? 'No items selected'
                                                : selectionMode === 'single'
                                                  ? 'Pick'
                                                  : `Pick ${selectedCount} item${selectedCount > 1 ? 's' : ''}`}
                                        </Button>
                                    )}
                                    {isSelecting && (
                                        <Tooltip
                                            content="Exit selection mode"
                                            size="lg"
                                            color="foreground"
                                        >
                                            <Button
                                                isIconOnly={true}
                                                color="danger"
                                                variant="faded"
                                                size="lg"
                                                onPress={() => {
                                                    setIsSelecting(false)
                                                    setSelectedPaths(new Set())
                                                }}
                                            >
                                                <XIcon className="size-4" />
                                            </Button>
                                        </Tooltip>
                                    )}
                                </div>
                            )}
                        </div>
                    </DrawerBody>
                )}
            </DrawerContent>
        </Drawer>
    )
}

function RemoteButton({
    remote,
    onSelect,
    isSelected,
}: { remote: string; onSelect: (remote: string) => void; isSelected: boolean }) {
    const [info, setInfo] = useState<{ type: string; provier?: string } | null>(null)

    useEffect(() => {
        getRemote(remote).then((data) => setInfo(data))
    }, [remote])

    return (
        <Tooltip content={remote} placement="right" size="lg" color="foreground">
            <Button
                isIconOnly={true}
                size="lg"
                variant={isSelected ? 'faded' : 'light'}
                onPress={() => onSelect(remote)}
                className="shrink-0"
            >
                {/* <HardDriveIcon className="size-4" /> */}
                <img
                    src={`/icons/backends/${info?.type}.png`}
                    className="object-contain size-6"
                    alt={info?.type}
                />
            </Button>
        </Tooltip>
    )
}

/*

async function resolveItemType(path: string): Promise<'file' | 'folder'> {
        // try fast path: use known entry
        const known = entryByKeyRef.current.get(path)
        if (known) return known.isDir ? 'folder' : 'file'

        if (path.includes(':/')) {
            const [remote, ...rest] = path.split(':/')
            const rel = rest.join('/')
            const parent = getRemoteParent(rel)
            let name = rel.split('/').pop()
            if (!name) {
                name = ''
            }
            let targetParent = parent
            if (!targetParent) {
                targetParent = ''
            }
            let both: { list: any[] } | null = null
            try {
                both = await listRemotePath(remote, targetParent, {
                    noModTime: true,
                    noMimeType: true,
                })
            } catch {
                // ignore, will fall back below
            }
            if (both) {
                const found = both.list.find((it) => {
                    const k = (it.Path || it.Name) as string
                    const tail = (k || '').split('/').pop() || ''
                    return tail === name
                })
                if (found) {
                    if (found.IsDir) {
                        return 'folder'
                    }
                    return 'file'
                }
            }
            // fallback guess: if ends with '/' treat folder else file
            return rel.endsWith('/') ? 'folder' : 'file'
        }

        // local
        const targetParent = await getLocalParent(path)
        const sepChar = await sep()
        let name = path.split(sepChar).pop()
        if (!name) {
            name = ''
        }
        let list: Awaited<ReturnType<typeof readDir>> | null = null
        try {
            list = await readDir(targetParent)
        } catch {}
        if (list) {
            const found = list.find((e) => e.name === name)
            if (found) {
                if (found.isDirectory) {
                    return 'folder'
                }
                return 'file'
            }
        }
        return 'file'
    }
*/
