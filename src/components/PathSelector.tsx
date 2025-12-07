import {
    Button,
    Checkbox,
    Divider,
    Drawer,
    DrawerBody,
    DrawerContent,
    Dropdown,
    DropdownItem,
    DropdownMenu,
    DropdownTrigger,
    Input,
    Listbox,
    ListboxItem,
    ScrollShadow,
    Tooltip,
    cn,
} from '@heroui/react'
import { useQuery } from '@tanstack/react-query'
import { dirname, homeDir, join, sep } from '@tauri-apps/api/path'
import { readDir } from '@tauri-apps/plugin-fs'
import { platform } from '@tauri-apps/plugin-os'
import { AnimatePresence, motion } from 'framer-motion'
import {
    ArrowBigDownIcon,
    ArrowLeftIcon,
    LaptopIcon,
    LassoSelectIcon,
    StarIcon,
} from 'lucide-react'
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { formatBytes } from '../../lib/format.ts'
import rclone from '../../lib/rclone/client.ts'
import { useHostStore } from '../../store/host.ts'

const RE_BACKSLASH = /\\/g
const RE_TRAILING_SLASH = /\/+$/g
const RE_LEADING_SLASH = /^\/+/
const RE_PATH_SEPARATOR = /[/\\]/

function log(msg: string, ...args: any[]) {
    console.log(`[PathSelector] ${msg}`, ...args)
}

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
    const cleaned = path.replace(RE_BACKSLASH, '/').replace(RE_TRAILING_SLASH, '')
    return cleaned
}

async function listRemotePath(
    remote: string,
    dir: string,
    options: { noModTime?: boolean; noMimeType?: boolean }
) {
    const base = normalizeRemoteDir(dir)
    const slashed = base ? `${base}/` : ''
    log('listRemotePath', { remote, dir, base, slashed, options })

    const tasks: Promise<any>[] = []

    const p1 = {
        fs: `${remote}:`,
        remote: base,
        ...options,
    }
    log('listRemotePath: rclone call 1 params', p1)
    tasks.push(
        rclone('/operations/list', {
            params: {
                query: p1,
            },
        })
    )

    if (slashed) {
        const p2 = {
            fs: `${remote}:`,
            remote: slashed,
            ...options,
        }
        log('listRemotePath: rclone call 2 params', p2)
        tasks.push(
            rclone('/operations/list', {
                params: {
                    query: p2,
                },
            })
        )
    }
    const settled = await Promise.allSettled(tasks)
    log('listRemotePath: settled', settled)

    const merged: any[] = []
    let anyFulfilled = false
    for (let i = 0; i < settled.length; i++) {
        const r = settled[i]
        if (r.status === 'fulfilled') {
            // rclone operations/list returns { list: [...] }
            // but some other calls might return array directly? Support both just in case.
            const list = Array.isArray(r.value) ? r.value : r.value?.list

            if (Array.isArray(list)) {
                anyFulfilled = true
                for (let j = 0; j < list.length; j++) {
                    merged.push(list[j])
                }
            }
        }
    }
    if (!anyFulfilled) {
        log('listRemotePath: no successful tasks')
        // intentionally throw here so callers can uniformly handle unreachable/forbidden
        // note: throwing here avoids "throw inside try" in callers if they avoid inline throws
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
    log('listRemotePath: result count', deduped.length)
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

type PaddingItem = {
    key: string
    padding: true
}

type VirtualizedEntry = Entry & { isSelected: boolean }

const VIRTUAL_PADDING_COUNT = 2

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
    const favoritePaths = useHostStore((state) => state.favoritePaths)

    const remotesQuery = useQuery({
        queryKey: ['remotes', 'list', 'all'],
        queryFn: async () => await rclone('/config/listremotes').then((r) => r?.remotes),
        staleTime: 1000 * 60, // 1 minute
    })

    const remotes = useMemo(() => remotesQuery.data ?? [], [remotesQuery.data])

    const [selectedRemote, setSelectedRemote] = useState<RemoteString>(null)

    const [cwd, setCwd] = useState<string>('')
    const [pathInput, setPathInput] = useState<string>('')
    const [searchTerm, setSearchTerm] = useState<string>('')
    const [items, setItems] = useState<Entry[]>([])

    const [isLoading, setIsLoading] = useState<boolean>(false)
    const [error, setError] = useState<string | null>(null)

    const isRemote = useMemo(
        () => selectedRemote !== 'UI_LOCAL_FS' && selectedRemote !== 'UI_FAVORITES',
        [selectedRemote]
    )
    const canShowFavorites = useMemo(() => allowedKeys.includes('FAVORITES'), [allowedKeys])
    const canShowLocal = useMemo(() => allowedKeys.includes('LOCAL_FS'), [allowedKeys])
    const canShowRemotes = useMemo(() => allowedKeys.includes('REMOTES'), [allowedKeys])

    const cacheRef = useRef<Map<string, Entry[]>>(new Map())
    const entryByKeyRef = useRef<Map<string, Entry>>(new Map())
    const abortControllerRef = useRef<AbortController | null>(null)
    const loadingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const isNavigatingRef = useRef(false)

    const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set())
    const selectedTypesRef = useRef<Map<string, 'file' | 'folder'>>(new Map())

    const visibleItems = useMemo(() => {
        const base = allowFiles ? items : items.filter((it) => it.isDir)
        if (!searchTerm) return base
        const lower = searchTerm.toLowerCase()
        return base.filter((item) => item.name.toLowerCase().includes(lower))
    }, [allowFiles, items, searchTerm])

    const virtualizedItems: (VirtualizedEntry | PaddingItem)[] = useMemo(() => {
        const base: (VirtualizedEntry | PaddingItem)[] = visibleItems.map((item) => ({
            ...item,
            // Include selection state so virtualized list re-renders when selection changes
            isSelected: selectedPaths.has(item.key),
        }))
        for (let i = 0; i < VIRTUAL_PADDING_COUNT; i++) {
            base.push({ key: `__padding-${i}`, padding: true })
        }
        return base
    }, [visibleItems, selectedPaths])

    const selectedCount = useMemo(() => selectedPaths.size, [selectedPaths])
    const [isUpDisabled, setIsUpDisabled] = useState(false)

    const listRef = useRef<HTMLDivElement>(null)
    const [listHeight, setListHeight] = useState(400)

    useEffect(() => {
        // Re-run when drawer opens to measure the container correctly
        if (!isOpen || !listRef.current) return
        // Measure initial height immediately (with a small delay to allow drawer animation)
        const measureInitial = () => {
            if (listRef.current) {
                const height = listRef.current.getBoundingClientRect().height
                if (height > 0) {
                    startTransition(() => {
                        setListHeight(height)
                    })
                }
            }
        }
        measureInitial()
        // Also measure after a short delay to catch post-animation dimensions
        const timeoutId = setTimeout(measureInitial, 100)
        const obs = new ResizeObserver((entries) => {
            for (const entry of entries) {
                startTransition(() => {
                    setListHeight(entry.contentRect.height)
                })
            }
        })
        obs.observe(listRef.current)
        return () => {
            clearTimeout(timeoutId)
            obs.disconnect()
        }
    }, [isOpen])

    const favoritedKeys = useMemo(() => {
        const map: Record<string, (typeof favoritePaths)[number]> = {}
        for (const it of favoritePaths) {
            const remote = (it as any).remote as string | undefined
            const rawPath = (it as any).path as string
            let fullKey = rawPath
            if (rawPath?.includes(':/')) {
                fullKey = rawPath
            } else if (remote && remote !== 'UI_LOCAL_FS') {
                const rel = (rawPath || '').replace(RE_LEADING_SLASH, '')
                fullKey = serializeRemotePath(remote, rel)
            } else {
                fullKey = rawPath
            }
            if (fullKey) map[fullKey] = it
        }
        return map
    }, [favoritePaths])

    // Clean up selection when switching remotes
    const cleanupSelectionForRemote = useCallback(
        (newRemote: RemoteString) => {
            log('cleanupSelectionForRemote', { newRemote, selectedRemote })
            if (newRemote !== selectedRemote) {
                startTransition(() => {
                    setSelectedPaths(new Set())
                })
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
        },
        [selectedRemote]
    )

    const updatePathInput = useCallback((nextRemote: RemoteString, nextCwd: string) => {
        if (!nextRemote) {
            startTransition(() => {
                setPathInput('')
            })
            return
        }
        if (nextRemote === 'UI_FAVORITES') {
            startTransition(() => {
                setPathInput('')
            })
            return
        }
        if (nextRemote === 'UI_LOCAL_FS') {
            startTransition(() => {
                setPathInput(nextCwd || '')
            })
        } else {
            startTransition(() => {
                setPathInput(`${nextRemote}:/${nextCwd || ''}`)
            })
        }
    }, [])

    const handleNavigate = useCallback(
        async (entry: Entry) => {
            log('handleNavigate', { entry, isNavigating: isNavigatingRef.current, selectedRemote })
            if (isNavigatingRef.current) return
            if (!entry.isDir) return
            if (!selectedRemote) return
            if (selectedRemote === 'UI_FAVORITES') {
                // Jump into the actual directory represented by this favorite
                const full = entry.fullPath
                if (full.includes(':/')) {
                    const [remoteName, ...rest] = full.split(':/')
                    const rel = rest.join('/')
                    cleanupSelectionForRemote(remoteName as any)
                    startTransition(() => {
                        setSelectedRemote(remoteName as any)
                        setCwd(rel)
                    })
                } else {
                    cleanupSelectionForRemote('UI_LOCAL_FS')
                    startTransition(() => {
                        setSelectedRemote('UI_LOCAL_FS')
                        setCwd(full)
                    })
                }
                return
            }
            isNavigatingRef.current = true
            if (isRemote) {
                const base = cwd ? `${cwd}/` : ''
                startTransition(() => {
                    setCwd(`${base}${entry.name}`)
                })
            } else {
                const newPath = await joinLocal(cwd, entry.name)
                startTransition(() => {
                    setCwd(newPath)
                })
            }
        },
        [selectedRemote, isRemote, cwd, cleanupSelectionForRemote]
    )

    const navigateUp = useCallback(async () => {
        log('navigateUp', { cwd, selectedRemote })
        if (!selectedRemote) return
        if (isRemote) {
            const parent = getRemoteParent(cwd)
            startTransition(() => {
                setCwd(parent)
            })
        }
        if (selectedRemote === 'UI_LOCAL_FS') {
            const parent = await getLocalParent(cwd)
            startTransition(() => {
                setCwd(parent)
            })
            return
        }
        // UI_FAVORITES -> no-op
    }, [cwd, selectedRemote, isRemote])

    const handleToggleSelect = useCallback(
        (entry: Entry) => {
            const next = new Set(selectedPaths)
            if (next.has(entry.key)) {
                next.delete(entry.key)
                selectedTypesRef.current.delete(entry.key)
            } else {
                if (!allowMultiple && next.size > 0) {
                    // In single select mode, if one is already selected, do not allow selecting another
                    // (unless the user deselected the first one, handled by the 'delete' branch)
                    return
                }
                next.add(entry.key)
                selectedTypesRef.current.set(entry.key, entry.isDir ? 'folder' : 'file')
            }
            startTransition(() => {
                setSelectedPaths(next)
            })
        },
        [selectedPaths, allowMultiple]
    )

    const handleConfirm = useCallback(() => {
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
    }, [selectedPaths, onSelect])

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
            setSelectedPaths(new Set())
            setItems([])
            setSelectedRemote(null)
            setCwd('')
            setPathInput('')
            setSearchTerm('')
            setError(null)
            setIsLoading(false)
            isNavigatingRef.current = false
        }
    }, [isOpen, canShowLocal, canShowFavorites])

    // Initialize from initialPaths
    // biome-ignore lint/correctness/useExhaustiveDependencies: <compiler>
    useEffect(() => {
        async function initializePaths() {
            if (!initialPaths || initialPaths.length === 0) {
                return
            }
            log('initializePaths', initialPaths)

            // seed selection set
            startTransition(() => {
                setSelectedPaths(new Set(initialPaths))
            })

            const first = initialPaths[0]
            if (first.includes(':/')) {
                const [remote, ...rest] = first.split(':/')
                const rel = rest.join('/')
                const parent = getRemoteParent(rel)
                startTransition(() => {
                    setSelectedRemote(remote)
                    setCwd(parent)
                    updatePathInput(remote, parent)
                })
            } else {
                const parent = await getLocalParent(first)
                startTransition(() => {
                    setSelectedRemote('UI_LOCAL_FS')
                    setCwd(parent)
                    updatePathInput('UI_LOCAL_FS', parent)
                })
            }
        }
        initializePaths()
    }, [initialPaths])

    // Load directory content when remote/cwd changes
    useEffect(() => {
        async function loadDir() {
            log('loadDir: start', { selectedRemote, cwd, isRemote })
            if (!selectedRemote) {
                startTransition(() => {
                    setItems([])
                    setError(null)
                    setIsLoading(false)
                })
                isNavigatingRef.current = false
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
                    startTransition(() => {
                        setIsLoading(true)
                    })
                }
            }, 200)

            const cKey = cacheKey(selectedRemote, cwd)
            if (cacheRef.current.has(cKey)) {
                log('loadDir: cache hit', cKey)
                const cached = cacheRef.current.get(cKey)!
                startTransition(() => {
                    setItems(cached)
                })
                isNavigatingRef.current = false
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
                            const rel = (rawPath || '').replace(RE_LEADING_SLASH, '')
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
                    const normalized = (relForName || '')
                        .replace(RE_BACKSLASH, '/')
                        .replace(RE_TRAILING_SLASH, '')
                    const baseName = normalized.split(RE_PATH_SEPARATOR).pop() || ''
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
                    startTransition(() => {
                        setItems(nextItems)
                        setIsLoading(false)
                    })
                    isNavigatingRef.current = false
                }
                return
            }
            if (isRemote) {
                log('loadDir: fetching remote')
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
                        startTransition(() => {
                            setIsLoading(false)
                            setItems([])
                            setError('No access or folder does not exist')
                        })
                        isNavigatingRef.current = false
                    }
                    return
                }

                // Check if request was aborted
                if (controller.signal.aborted) {
                    log('loadDir: aborted after fetch')
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
                        isNavigatingRef.current = false
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
                isNavigatingRef.current = false
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

    //! prev compiler
    useEffect(() => {
        updatePathInput(selectedRemote, cwd)
        setSearchTerm('')
    }, [selectedRemote, cwd, updatePathInput])

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
                        <div className={'flex flex-col items-center w-20 h-full bg-red-500/0'}>
                            <ScrollShadow
                                className={cn(
                                    'flex flex-col items-center w-full h-full gap-5 py-4 overflow-y-auto bg-blue-500/0',
                                    platform() === 'macos' && 'pt-8'
                                )}
                                size={69}
                            >
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
                                                setTimeout(() => {
                                                    cleanupSelectionForRemote('UI_FAVORITES')
                                                    startTransition(() => {
                                                        setSelectedRemote('UI_FAVORITES')
                                                        setCwd('')
                                                    })
                                                }, 100)
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
                                                setTimeout(() => {
                                                    cleanupSelectionForRemote('UI_LOCAL_FS')
                                                    startTransition(() => {
                                                        setSelectedRemote('UI_LOCAL_FS')
                                                        setCwd('/')
                                                    })
                                                }, 100)
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
                                                setTimeout(() => {
                                                    cleanupSelectionForRemote(remote)
                                                    startTransition(() => {
                                                        setSelectedRemote(remote)
                                                        setCwd('')
                                                    })
                                                }, 100)
                                            }}
                                            isSelected={selectedRemote === remote}
                                        />
                                    ))}
                            </ScrollShadow>
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
                                    autoCapitalize="off"
                                    autoComplete="off"
                                    autoCorrect="off"
                                    spellCheck="false"
                                    classNames={{
                                        'inputWrapper': platform() === 'macos' ? 'pt-4 h-16' : '',
                                    }}
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
                                            startTransition(() => {
                                                setSelectedRemote(remote)
                                                setCwd(rel)
                                            })
                                        } else {
                                            startTransition(() => {
                                                setSelectedRemote('UI_LOCAL_FS')
                                                setCwd(value)
                                            })
                                        }
                                    }}
                                    isReadOnly={selectedRemote === 'UI_FAVORITES'}
                                />
                            </Tooltip>
                            <Divider />

                            <div className="relative flex flex-col w-full h-full overflow-hidden">
                                <div className="sticky top-0 z-10 grid grid-cols-[2.5rem_1fr_6rem_9rem_2.5rem] items-center py-2 bg-default-100">
                                    <div />
                                    <div className="pl-2 font-semibold text-small">Name</div>
                                    <div className="font-semibold text-small">Size</div>
                                    <div className="font-semibold text-small">Last Modified</div>
                                    <div />
                                </div>

                                <div
                                    ref={listRef}
                                    className="relative flex-1 w-full overflow-hidden"
                                >
                                    {isLoading && (
                                        <div className="flex items-center justify-center flex-1 w-full h-full">
                                            <div className="animate-blink">Loading...</div>
                                        </div>
                                    )}

                                    {!isLoading && error && (
                                        <div className="flex items-center justify-center w-full h-full text-danger">
                                            {error}
                                        </div>
                                    )}

                                    {!isLoading && !error && visibleItems.length === 0 && (
                                        <div className="flex items-center justify-center w-full h-full text-default-500">
                                            No items
                                        </div>
                                    )}

                                    {!isLoading && !error && visibleItems.length > 0 && (
                                        <Listbox
                                            items={virtualizedItems}
                                            isVirtualized={true}
                                            virtualization={{
                                                maxListboxHeight: listHeight,
                                                itemHeight: 50,
                                            }}
                                            classNames={{
                                                base: 'w-full p-0 m-0',
                                                list: 'w-full p-0 m-0 gap-0 !scrollbar-default',
                                            }}
                                            selectionMode="none"
                                            hideSelectedIcon={true}
                                            selectedKeys={[]}
                                            shouldHighlightOnFocus={false}
                                            autoFocus={false}
                                            disallowEmptySelection={false}
                                        >
                                            {(item) => {
                                                if ('padding' in item && item.padding) {
                                                    return (
                                                        <ListboxItem
                                                            key={item.key}
                                                            isDisabled={true}
                                                            className="p-0 m-0 pointer-events-none"
                                                        >
                                                            <div
                                                                className="h-[50px]"
                                                                aria-hidden="true"
                                                            />
                                                        </ListboxItem>
                                                    )
                                                }
                                                const entry = item as VirtualizedEntry
                                                const isSelected = entry.isSelected
                                                const isDisabled =
                                                    !allowMultiple &&
                                                    selectedPaths.size > 0 &&
                                                    !isSelected

                                                return (
                                                    <ListboxItem
                                                        key={entry.key}
                                                        textValue={entry.name}
                                                        classNames={{
                                                            base: 'p-0 m-0 rounded-none !outline-none data-[focus-visible=true]:!outline-none focus:!outline-none',
                                                            title: 'h-full justify-center flex',
                                                        }}
                                                    >
                                                        <div
                                                            className={cn(
                                                                'grid grid-cols-[2.5rem_1fr_6rem_9rem_2.5rem] items-center hover:bg-content2 py-2 border-b border-divider group transition-colors w-full h-full',
                                                                isSelected
                                                                    ? 'bg-primary-50 hover:bg-primary-100'
                                                                    : ''
                                                            )}
                                                        >
                                                            <div
                                                                className="flex items-center justify-end"
                                                                onClick={(e) => e.stopPropagation()}
                                                            >
                                                                <Checkbox
                                                                    isSelected={isSelected}
                                                                    isDisabled={isDisabled}
                                                                    onValueChange={() =>
                                                                        handleToggleSelect(entry)
                                                                    }
                                                                    aria-label="Select item"
                                                                />
                                                            </div>
                                                            <div
                                                                className="flex items-center h-full pl-2 overflow-hidden cursor-pointer"
                                                                onClick={() =>
                                                                    handleNavigate(entry)
                                                                }
                                                            >
                                                                <span className="mr-2 text-xl shrink-0">
                                                                    {entry.isDir ? '📂' : '📄'}
                                                                </span>
                                                                <span className="truncate !cursor-pointer">
                                                                    {entry.name}
                                                                </span>
                                                            </div>
                                                            <div className="truncate text-small text-default-500">
                                                                {!entry.isDir &&
                                                                typeof entry.size === 'number'
                                                                    ? formatBytes(entry.size)
                                                                    : '—'}
                                                            </div>
                                                            <div className="truncate text-small text-default-500">
                                                                {entry.modTime
                                                                    ? entry.modTime
                                                                    : '—'}
                                                            </div>
                                                            <div className="flex items-center justify-center w-10 shrink-0">
                                                                {entry.isDir &&
                                                                    !favoritedKeys[entry.key] && (
                                                                        <Button
                                                                            isIconOnly={true}
                                                                            size="sm"
                                                                            variant="light"
                                                                            color="warning"
                                                                            className="transition-opacity duration-300 opacity-0 group-hover:opacity-100"
                                                                            onPress={() => {
                                                                                const storedPath =
                                                                                    entry.fullPath.includes(
                                                                                        ':/'
                                                                                    )
                                                                                        ? entry.fullPath
                                                                                              .split(
                                                                                                  ':/'
                                                                                              )
                                                                                              .slice(
                                                                                                  1
                                                                                              )
                                                                                              .join(
                                                                                                  '/'
                                                                                              )
                                                                                        : entry.fullPath
                                                                                useHostStore.setState(
                                                                                    {
                                                                                        favoritePaths:
                                                                                            [
                                                                                                ...(favoritePaths ||
                                                                                                    []),
                                                                                                {
                                                                                                    remote: entry.remote!,
                                                                                                    path: storedPath,
                                                                                                    added: Date.now(),
                                                                                                },
                                                                                            ],
                                                                                    }
                                                                                )
                                                                            }}
                                                                        >
                                                                            <StarIcon className="size-5" />
                                                                        </Button>
                                                                    )}
                                                                {entry.isDir &&
                                                                    favoritedKeys[entry.key] && (
                                                                        <Button
                                                                            isIconOnly={true}
                                                                            size="sm"
                                                                            variant="light"
                                                                            color="warning"
                                                                            className="transition-opacity duration-300 opacity-0 group-hover:opacity-100"
                                                                            onPress={() => {
                                                                                useHostStore.setState(
                                                                                    {
                                                                                        favoritePaths:
                                                                                            [
                                                                                                ...(
                                                                                                    favoritePaths ||
                                                                                                    []
                                                                                                ).filter(
                                                                                                    (
                                                                                                        it
                                                                                                    ) => {
                                                                                                        const remote =
                                                                                                            (
                                                                                                                it as any
                                                                                                            )
                                                                                                                .remote as
                                                                                                                | string
                                                                                                                | undefined
                                                                                                        const rawPath =
                                                                                                            (
                                                                                                                it as any
                                                                                                            )
                                                                                                                .path as string
                                                                                                        let fullKey =
                                                                                                            rawPath
                                                                                                        if (
                                                                                                            rawPath?.includes(
                                                                                                                ':/'
                                                                                                            )
                                                                                                        ) {
                                                                                                            fullKey =
                                                                                                                rawPath
                                                                                                        } else if (
                                                                                                            remote &&
                                                                                                            remote !==
                                                                                                                'UI_LOCAL_FS'
                                                                                                        ) {
                                                                                                            const rel =
                                                                                                                (
                                                                                                                    rawPath ||
                                                                                                                    ''
                                                                                                                ).replace(
                                                                                                                    RE_LEADING_SLASH,
                                                                                                                    ''
                                                                                                                )
                                                                                                            fullKey =
                                                                                                                serializeRemotePath(
                                                                                                                    remote,
                                                                                                                    rel
                                                                                                                )
                                                                                                        } else {
                                                                                                            fullKey =
                                                                                                                rawPath
                                                                                                        }
                                                                                                        return (
                                                                                                            fullKey !==
                                                                                                            entry.fullPath
                                                                                                        )
                                                                                                    }
                                                                                                ),
                                                                                            ],
                                                                                    }
                                                                                )
                                                                            }}
                                                                        >
                                                                            <StarIcon className="size-5 fill-warning" />
                                                                        </Button>
                                                                    )}
                                                            </div>
                                                        </div>
                                                    </ListboxItem>
                                                )
                                            }}
                                        </Listbox>
                                    )}
                                </div>
                            </div>

                            <div className="absolute left-0 right-0 flex justify-center w-full gap-4 pr-20 ml-20 bottom-5">
                                <AnimatePresence>
                                    {selectedRemote !== 'UI_FAVORITES' && (
                                        <motion.div
                                            initial={{ y: 100, opacity: 0 }}
                                            animate={{ y: 0, opacity: 1 }}
                                            exit={{ y: 100, opacity: 0 }}
                                            transition={{
                                                enter: {
                                                    type: 'spring',
                                                    stiffness: 300,
                                                    damping: 20,
                                                    delay: 0.69,
                                                },
                                                exit: {
                                                    duration: 0.2,
                                                    delay: 0,
                                                },
                                            }}
                                            className="flex flex-row items-center gap-2.5 px-2 py-1.5 rounded-full bg-content2"
                                        >
                                            <Tooltip
                                                content="Go to parent directory"
                                                size="lg"
                                                color="foreground"
                                            >
                                                <Button
                                                    color="primary"
                                                    size="sm"
                                                    onPress={navigateUp}
                                                    isDisabled={isUpDisabled || isLoading}
                                                    radius="full"
                                                    startContent={
                                                        <ArrowLeftIcon className="size-5" />
                                                    }
                                                    className="gap-1 min-w-fit"
                                                >
                                                    BACK
                                                </Button>
                                            </Tooltip>

                                            <Dropdown
                                                shadow={
                                                    platform() === 'windows' ? 'none' : undefined
                                                }
                                            >
                                                <DropdownTrigger>
                                                    <Button
                                                        color="primary"
                                                        size="sm"
                                                        radius="full"
                                                        startContent={
                                                            <LassoSelectIcon className="size-5" />
                                                        }
                                                        className="gap-1.5 min-w-fit"
                                                    >
                                                        SELECT
                                                    </Button>
                                                </DropdownTrigger>
                                                <DropdownMenu color="primary">
                                                    <DropdownItem
                                                        key="select-current"
                                                        onPress={() => {
                                                            let path = cwd
                                                            if (isRemote && selectedRemote) {
                                                                path = serializeRemotePath(
                                                                    selectedRemote,
                                                                    cwd
                                                                )
                                                            }
                                                            onSelect?.([{ path, type: 'folder' }])
                                                        }}
                                                    >
                                                        Current Folder (
                                                        {cwd.split(RE_PATH_SEPARATOR).pop() ||
                                                            selectedRemote}
                                                        )
                                                    </DropdownItem>
                                                    <DropdownItem
                                                        key="select-files"
                                                        onPress={() => {
                                                            const next = new Set(selectedPaths)
                                                            for (const item of visibleItems) {
                                                                if (!item.isDir) {
                                                                    next.add(item.key)
                                                                    selectedTypesRef.current.set(
                                                                        item.key,
                                                                        'file'
                                                                    )
                                                                }
                                                            }
                                                            startTransition(() => {
                                                                setSelectedPaths(next)
                                                            })
                                                        }}
                                                    >
                                                        All Files
                                                    </DropdownItem>
                                                    <DropdownItem
                                                        key="select-folders"
                                                        onPress={() => {
                                                            const next = new Set(selectedPaths)
                                                            for (const item of visibleItems) {
                                                                if (item.isDir) {
                                                                    next.add(item.key)
                                                                    selectedTypesRef.current.set(
                                                                        item.key,
                                                                        'folder'
                                                                    )
                                                                }
                                                            }
                                                            startTransition(() => {
                                                                setSelectedPaths(next)
                                                            })
                                                        }}
                                                    >
                                                        All Folders
                                                    </DropdownItem>
                                                    <DropdownItem
                                                        key="select-files-folders"
                                                        onPress={() => {
                                                            const next = new Set(selectedPaths)
                                                            for (const item of visibleItems) {
                                                                next.add(item.key)
                                                                selectedTypesRef.current.set(
                                                                    item.key,
                                                                    item.isDir ? 'folder' : 'file'
                                                                )
                                                            }
                                                            startTransition(() => {
                                                                setSelectedPaths(next)
                                                            })
                                                        }}
                                                    >
                                                        All Files & Folders
                                                    </DropdownItem>
                                                    <DropdownItem
                                                        key="deselect-all"
                                                        onPress={() => {
                                                            selectedTypesRef.current.clear()
                                                            startTransition(() => {
                                                                setSelectedPaths(new Set())
                                                            })
                                                        }}
                                                        color="danger"
                                                    >
                                                        Deselect All
                                                    </DropdownItem>
                                                </DropdownMenu>
                                            </Dropdown>

                                            <Input
                                                size="sm"
                                                radius="full"
                                                placeholder="Type here to search"
                                                onValueChange={setSearchTerm}
                                                isClearable={true}
                                                onClear={() => setSearchTerm('')}
                                                autoCapitalize="off"
                                                autoComplete="off"
                                                autoCorrect="off"
                                                spellCheck="false"
                                            />

                                            <Tooltip
                                                content={'Close this window'}
                                                placement="top"
                                                size="lg"
                                                color="foreground"
                                            >
                                                <Button
                                                    color="danger"
                                                    size="sm"
                                                    radius="full"
                                                    variant="flat"
                                                    onPress={close}
                                                    startContent={
                                                        <ArrowBigDownIcon className="size-4" />
                                                    }
                                                    className="gap-1 min-w-fit"
                                                >
                                                    DISMISS
                                                </Button>
                                            </Tooltip>
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                                <AnimatePresence>
                                    {selectedRemote !== 'UI_FAVORITES' && (
                                        <motion.div
                                            initial={{ y: 100, opacity: 0 }}
                                            animate={{ y: 0, opacity: 1 }}
                                            exit={{ y: 100, opacity: 0 }}
                                            transition={{
                                                enter: {
                                                    type: 'spring',
                                                    stiffness: 300,
                                                    damping: 20,
                                                    delay: 0.69,
                                                },
                                                exit: {
                                                    duration: 0.2,
                                                    delay: 0,
                                                },
                                            }}
                                            className="flex flex-row items-center gap-4 px-2 py-1.5 rounded-full bg-content2"
                                        >
                                            <Tooltip
                                                content={
                                                    selectedCount === 0
                                                        ? 'Tap on the checkbox to select items'
                                                        : ''
                                                }
                                                placement="top"
                                                size="lg"
                                                color="foreground"
                                                isDisabled={selectedCount > 0}
                                            >
                                                <div>
                                                    <Button
                                                        size="sm"
                                                        color="primary"
                                                        radius="full"
                                                        onPress={handleConfirm}
                                                        isDisabled={selectedCount === 0}
                                                    >
                                                        {selectedCount === 0
                                                            ? '0 SELECTED'
                                                            : allowMultiple
                                                              ? `PICK (${selectedCount})`
                                                              : 'PICK'}
                                                    </Button>
                                                </div>
                                            </Tooltip>
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>
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
    const remoteConfigQuery = useQuery({
        queryKey: ['remote', remote, 'config'],
        queryFn: async () => {
            return await rclone('/config/get', {
                params: {
                    query: {
                        name: remote,
                    },
                },
            })
        },
    })

    const info = remoteConfigQuery.data ?? null

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
