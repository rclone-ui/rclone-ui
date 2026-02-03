import { useQuery } from '@tanstack/react-query'
import { homeDir } from '@tauri-apps/api/path'
import { readDir } from '@tauri-apps/plugin-fs'
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import rclone from '../../../lib/rclone/client.ts'
import { useHostStore } from '../../../store/host.ts'
import type {
    AllowedKey,
    Entry,
    PaddingItem,
    RemoteString,
    SelectItem,
    VirtualizedEntry,
} from './types'
import {
    RE_BACKSLASH,
    RE_LEADING_SLASH,
    RE_PATH_SEPARATOR,
    RE_TRAILING_SLASH,
    VIRTUAL_PADDING_COUNT,
    cacheKey,
    getLocalParent,
    getRemoteParent,
    joinLocal,
    listRemotePath,
    log,
    serializeRemotePath,
} from './utils'

export default function useFileNavigation({
    initialRemote,
    initialPath,
    allowedKeys = ['REMOTES', 'LOCAL_FS', 'FAVORITES'],
    allowFiles = true,
    allowMultiple = true,
    isActive = true,
}: {
    initialRemote?: string | 'UI_LOCAL_FS'
    initialPath?: string
    allowedKeys?: AllowedKey[]
    allowFiles?: boolean
    allowMultiple?: boolean
    isActive?: boolean
}) {
    const favoritePaths = useHostStore((state) => state.favoritePaths)

    const remotesQuery = useQuery({
        queryKey: ['remotes', 'list', 'all'],
        queryFn: async () => await rclone('/config/listremotes').then((r) => r?.remotes),
        staleTime: 1000 * 60,
    })

    const remotes = useMemo(() => remotesQuery.data ?? [], [remotesQuery.data])

    const [selectedRemote, setSelectedRemote] = useState<RemoteString>(initialRemote ?? null)
    const [cwd, setCwd] = useState<string>(initialPath ?? '')
    const [pathInput, setPathInput] = useState<string>('')
    const [searchTerm, setSearchTerm] = useState<string>('')
    const [items, setItems] = useState<Entry[]>([])
    const [isLoading, setIsLoading] = useState<boolean>(false)
    const [error, setError] = useState<string | null>(null)
    const [isUpDisabled, setIsUpDisabled] = useState(false)
    const [refreshKey, setRefreshKey] = useState(0)

    const isRemote = useMemo(
        () =>
            selectedRemote !== 'UI_LOCAL_FS' &&
            selectedRemote !== 'UI_FAVORITES' &&
            selectedRemote !== null,
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
            isSelected: selectedPaths.has(item.key),
        }))
        for (let i = 0; i < VIRTUAL_PADDING_COUNT; i++) {
            base.push({ key: `__padding-${i}`, padding: true })
        }
        return base
    }, [visibleItems, selectedPaths])

    const selectedCount = useMemo(() => selectedPaths.size, [selectedPaths])

    const favoritedKeys = useMemo(() => {
        const map: Record<string, boolean> = {}
        for (const it of favoritePaths || []) {
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
            if (fullKey) map[fullKey] = true
        }
        return map
    }, [favoritePaths])

    const cleanupSelectionForRemote = useCallback(
        (newRemote: RemoteString) => {
            log('cleanupSelectionForRemote', { newRemote, selectedRemote })
            if (newRemote !== selectedRemote) {
                startTransition(() => {
                    setSelectedPaths(new Set())
                })
                selectedTypesRef.current.clear()
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
            startTransition(() => setPathInput(''))
            return
        }
        if (nextRemote === 'UI_FAVORITES') {
            startTransition(() => setPathInput(''))
            return
        }
        if (nextRemote === 'UI_LOCAL_FS') {
            startTransition(() => setPathInput(nextCwd || ''))
        } else {
            startTransition(() => setPathInput(`${nextRemote}:/${nextCwd || ''}`))
        }
    }, [])

    const handleNavigate = useCallback(
        async (entry: Entry) => {
            log('handleNavigate', { entry, isNavigating: isNavigatingRef.current, selectedRemote })
            if (isNavigatingRef.current) return
            if (!entry.isDir) return
            if (!selectedRemote) return
            if (selectedRemote === 'UI_FAVORITES') {
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
                startTransition(() => setCwd(`${base}${entry.name}`))
            } else {
                const newPath = await joinLocal(cwd, entry.name)
                startTransition(() => setCwd(newPath))
            }
        },
        [selectedRemote, isRemote, cwd, cleanupSelectionForRemote]
    )

    const navigateUp = useCallback(async () => {
        log('navigateUp', { cwd, selectedRemote })
        if (!selectedRemote) return
        if (isRemote) {
            const parent = getRemoteParent(cwd)
            startTransition(() => setCwd(parent))
        }
        if (selectedRemote === 'UI_LOCAL_FS') {
            const parent = await getLocalParent(cwd)
            startTransition(() => setCwd(parent))
            return
        }
    }, [cwd, selectedRemote, isRemote])

    const navigateTo = useCallback(
        (path: string) => {
            const value = path.trim()
            if (!value) return
            if (value.includes(':/')) {
                const [remote, ...rest] = value.split(':/')
                const rel = rest.join('/')
                cleanupSelectionForRemote(remote)
                startTransition(() => {
                    setSelectedRemote(remote)
                    setCwd(rel)
                })
            } else {
                cleanupSelectionForRemote('UI_LOCAL_FS')
                startTransition(() => {
                    setSelectedRemote('UI_LOCAL_FS')
                    setCwd(value)
                })
            }
        },
        [cleanupSelectionForRemote]
    )

    const selectRemote = useCallback(
        async (remote: string | 'UI_LOCAL_FS' | 'UI_FAVORITES') => {
            cleanupSelectionForRemote(remote)
            if (remote === 'UI_LOCAL_FS') {
                const home = await homeDir()
                startTransition(() => {
                    setSelectedRemote(remote)
                    setCwd(home)
                })
            } else {
                startTransition(() => {
                    setSelectedRemote(remote)
                    setCwd('')
                })
            }
        },
        [cleanupSelectionForRemote]
    )

    const handleToggleSelect = useCallback(
        (entry: Entry) => {
            const next = new Set(selectedPaths)
            if (next.has(entry.key)) {
                next.delete(entry.key)
                selectedTypesRef.current.delete(entry.key)
            } else {
                if (!allowMultiple && next.size > 0) return
                next.add(entry.key)
                selectedTypesRef.current.set(entry.key, entry.isDir ? 'folder' : 'file')
            }
            startTransition(() => setSelectedPaths(next))
        },
        [selectedPaths, allowMultiple]
    )

    const getSelection = useCallback((): SelectItem[] => {
        const paths = Array.from(selectedPaths)
        return paths.map((path) => {
            const known = selectedTypesRef.current.get(path)
            if (known) return { path, type: known }
            const entry = entryByKeyRef.current.get(path)
            if (entry) return { path, type: entry.isDir ? 'folder' : 'file' }
            if (path.includes(':/')) {
                const rel = path.split(':/').slice(1).join('/')
                return { path, type: rel.endsWith('/') ? 'folder' : 'file' }
            }
            return { path, type: 'file' }
        })
    }, [selectedPaths])

    const clearSelection = useCallback(() => {
        selectedTypesRef.current.clear()
        startTransition(() => setSelectedPaths(new Set()))
    }, [])

    const selectAll = useCallback(
        (type: 'files' | 'folders' | 'all') => {
            const next = new Set(selectedPaths)
            for (const item of visibleItems) {
                if (type === 'files' && !item.isDir) {
                    next.add(item.key)
                    selectedTypesRef.current.set(item.key, 'file')
                } else if (type === 'folders' && item.isDir) {
                    next.add(item.key)
                    selectedTypesRef.current.set(item.key, 'folder')
                } else if (type === 'all') {
                    next.add(item.key)
                    selectedTypesRef.current.set(item.key, item.isDir ? 'folder' : 'file')
                }
            }
            startTransition(() => setSelectedPaths(next))
        },
        [selectedPaths, visibleItems]
    )

    const refresh = useCallback(() => {
        const cKey = cacheKey(selectedRemote, cwd)
        cacheRef.current.delete(cKey)
        startTransition(() => setItems([]))
        setIsLoading(true)
        setRefreshKey((k) => k + 1)
    }, [selectedRemote, cwd])

    // Initialize on first mount if no initial values provided
    useEffect(() => {
        if (!isActive) return

        const hasInitial = initialRemote !== undefined
        const needsLocalPath = initialRemote === 'UI_LOCAL_FS' && !initialPath

        if (needsLocalPath || (!hasInitial && canShowLocal)) {
            setIsLoading(true)
            homeDir().then((home) => {
                startTransition(() => {
                    setSelectedRemote('UI_LOCAL_FS')
                    setCwd(home)
                    setPathInput(home)
                })
                setIsLoading(false)
            })
        } else if (!hasInitial && canShowFavorites) {
            startTransition(() => setSelectedRemote('UI_FAVORITES'))
        } else if (!hasInitial && canShowRemotes && remotes.length > 0) {
            startTransition(() => {
                setSelectedRemote(remotes[0])
                setCwd('')
            })
        }
    }, [
        isActive,
        canShowLocal,
        canShowFavorites,
        canShowRemotes,
        remotes,
        initialRemote,
        initialPath,
    ])

    // Load directory content when remote/cwd changes
    useEffect(() => {
        if (!isActive) return

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

            if (abortControllerRef.current) abortControllerRef.current.abort()
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
                    startTransition(() => setIsLoading(true))
                }
            }, 200)

            const cKey = cacheKey(selectedRemote, cwd)
            if (cacheRef.current.has(cKey)) {
                log('loadDir: cache hit', cKey)
                const cached = cacheRef.current.get(cKey)!
                startTransition(() => setItems(cached))
                isNavigatingRef.current = false
            }

            let nextItems: Entry[] = []
            if (selectedRemote === 'UI_FAVORITES') {
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
                    const relForName = (() => {
                        if (!isLocal) {
                            if (rawPath.includes(':/'))
                                return rawPath.split(':/').slice(1).join('/')
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
                nextItems.sort((a, b) => a.name.localeCompare(b.name))
                if (!controller.signal.aborted) {
                    finished = true
                    if (loadingTimerRef.current) {
                        clearTimeout(loadingTimerRef.current)
                        loadingTimerRef.current = null
                    }
                    cacheRef.current.set(cKey, nextItems)
                    const map = entryByKeyRef.current
                    for (const e of nextItems) map.set(e.key, e)
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
                const targetCwd = cwd || ''
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
                            mimeType: it.MimeType,
                            remote,
                            fullPath: full,
                        } as Entry
                    })
                    .filter((e) => !e.name.startsWith('.'))
            } else if (cwd) {
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

                if (controller.signal.aborted) return

                const processedEntries: Entry[] = []
                for (const e of entries || []) {
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

            if (controller.signal.aborted) return

            nextItems.sort((a, b) => {
                if (a.isDir && !b.isDir) return -1
                if (!a.isDir && b.isDir) return 1
                return a.name.localeCompare(b.name)
            })

            if (!controller.signal.aborted) {
                finished = true
                if (loadingTimerRef.current) {
                    clearTimeout(loadingTimerRef.current)
                    loadingTimerRef.current = null
                }
                cacheRef.current.set(cKey, nextItems)
                const map = entryByKeyRef.current
                for (const e of nextItems) map.set(e.key, e)
                setItems(nextItems)
                setIsLoading(false)
                isNavigatingRef.current = false
            }
        }

        loadDir()

        return () => {
            if (abortControllerRef.current) abortControllerRef.current.abort()
            if (loadingTimerRef.current) {
                clearTimeout(loadingTimerRef.current)
                loadingTimerRef.current = null
            }
        }
    }, [selectedRemote, cwd, isRemote, favoritePaths, isActive, refreshKey])

    useEffect(() => {
        updatePathInput(selectedRemote, cwd)
        setSearchTerm('')
    }, [selectedRemote, cwd, updatePathInput])

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
            setIsUpDisabled(parent === current)
        }
        updateUpState()
        return () => {
            cancelled = true
        }
    }, [selectedRemote, cwd, isRemote])

    return {
        // State
        selectedRemote,
        cwd,
        pathInput,
        items,
        visibleItems,
        virtualizedItems,
        isLoading,
        error,
        isUpDisabled,
        searchTerm,
        selectedPaths,
        selectedCount,
        isRemote,
        favoritedKeys,
        remotes,
        canShowFavorites,
        canShowLocal,
        canShowRemotes,

        // Actions
        setPathInput,
        setSearchTerm,
        handleNavigate,
        navigateUp,
        navigateTo,
        selectRemote,
        handleToggleSelect,
        getSelection,
        clearSelection,
        selectAll,
        refresh,
        entryByKeyRef,

        // For external control
        setSelectedRemote,
        setCwd,
        setSelectedPaths,
    }
}
