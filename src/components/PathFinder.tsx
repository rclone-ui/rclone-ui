import { Autocomplete, Tooltip } from '@heroui/react'
import { AutocompleteItem, Button } from '@heroui/react'
import { sep } from '@tauri-apps/api/path'
import { readDir } from '@tauri-apps/plugin-fs'
import { ArrowDownUp, FolderOpen, XIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useDebounce } from 'use-debounce'
import { isRemotePath } from '../../lib/fs'
import { listPath } from '../../lib/rclone/api'
import { useStore } from '../../lib/store'
import PathSelector from './PathSelector'
import RemoteAvatar from './RemoteAvatar'

export function PathFinder({
    sourcePath = '',
    setSourcePath,
    destPath = '',
    setDestPath,
    switchable = true,
    sourceOptions = {
        label: 'Source',
        showPicker: true,
        placeholder: 'Enter a remote:/path or local path, or tap to select a folder',
        showSuggestions: true,
        clearable: true,
        showFiles: true,
        allowedKeys: ['LOCAL_FS', 'REMOTES', 'FAVORITES'],
    },
    destOptions = {
        label: 'Destination',
        showPicker: true,
        placeholder: 'Enter a remote:/path or local path',
        showSuggestions: true,
        clearable: true,
        showFiles: true,
        allowedKeys: ['LOCAL_FS', 'REMOTES', 'FAVORITES'],
    },
}: {
    sourcePath?: string
    setSourcePath: (path: string | undefined) => void
    destPath?: string
    setDestPath: (path: string | undefined) => void
    switchable?: boolean
    sourceOptions?: {
        label: string
        placeholder: string
        showPicker: boolean
        showSuggestions: boolean
        clearable: boolean
        allowedKeys?: ('LOCAL_FS' | 'FAVORITES' | 'REMOTES')[]
        showFiles?: boolean
    }
    destOptions?: {
        label: string
        placeholder: string
        showPicker: boolean
        showSuggestions: boolean
        clearable: boolean
        allowedKeys?: ('LOCAL_FS' | 'FAVORITES' | 'REMOTES')[]
        showFiles?: boolean
    }
}) {
    const handleSwap = () => {
        const temp = sourcePath
        setSourcePath(destPath)
        setDestPath(temp)
    }

    return (
        <div className="flex flex-col gap-8">
            <PathField
                path={sourcePath}
                setPath={setSourcePath}
                label={sourceOptions.label}
                placeholder={sourceOptions.placeholder}
                showSuggestions={sourceOptions.showSuggestions}
                clearable={sourceOptions.clearable}
                showPicker={sourceOptions.showPicker}
                allowedKeys={sourceOptions.allowedKeys}
                showFiles={sourceOptions.showFiles}
            />

            {switchable && (
                <div className="flex justify-center">
                    <Button
                        onPress={handleSwap}
                        type="button"
                        isIconOnly={true}
                        size="lg"
                        isDisabled={!sourcePath && !destPath}
                        data-focus-visible="false"
                    >
                        <ArrowDownUp className="w-6 h-6" />
                    </Button>
                </div>
            )}

            <PathField
                path={destPath}
                setPath={setDestPath}
                label={destOptions.label}
                placeholder={destOptions.placeholder}
                showSuggestions={destOptions.showSuggestions}
                clearable={destOptions.clearable}
                showPicker={destOptions.showPicker}
                allowedKeys={destOptions.allowedKeys}
                showFiles={destOptions.showFiles}
            />
        </div>
    )
}

export function MultiPathFinder({
    sourcePaths = [],
    setSourcePaths,
    destPath = '',
    setDestPath,
    switchable = true,
    sourceOptions = {
        label: 'Source',
        showPicker: true,
        placeholder: 'Enter a remote:/path or local path, or tap to select files',
        showSuggestions: true,
        clearable: true,
    },
    destOptions = {
        label: 'Destination',
        showPicker: true,
        placeholder: 'Enter a remote:/path or local path',
        showSuggestions: true,
        clearable: true,
    },
}: {
    sourcePaths?: string[]
    setSourcePaths: (paths: string[] | undefined) => void
    destPath?: string
    setDestPath: (path: string | undefined) => void
    switchable?: boolean
    sourceOptions?: {
        label: string
        placeholder: string
        showPicker: boolean
        showSuggestions: boolean
        clearable: boolean
    }
    destOptions?: {
        label: string
        placeholder: string
        showPicker: boolean
        showSuggestions: boolean
        clearable: boolean
    }
}) {
    const handleSwap = () => {
        if (sourcePaths.length !== 1) {
            return
        }
        const temp = sourcePaths[0]
        setSourcePaths([destPath])
        setDestPath(temp)
    }

    const isSwapDisabled = sourcePaths.length !== 1 || !destPath

    const swapDisabledReason = (() => {
        if (sourcePaths.length === 0) {
            return 'No source selected'
        }
        if (sourcePaths.length >= 2) {
            return 'Cannot swap when multiple sources are selected'
        }
        if (!destPath) {
            return 'No destination selected'
        }
        return 'Swap sources'
    })()

    return (
        <div className="flex flex-col gap-8">
            <MultiPathField
                paths={sourcePaths}
                setPaths={setSourcePaths}
                label={sourceOptions.label}
                placeholder={sourceOptions.placeholder}
                showSuggestions={sourceOptions.showSuggestions}
                clearable={sourceOptions.clearable}
            />

            {switchable && (
                <div className="flex justify-center">
                    <Tooltip content={swapDisabledReason} className="max-w-48">
                        <div>
                            <Button
                                onPress={handleSwap}
                                type="button"
                                isIconOnly={true}
                                size="lg"
                                isDisabled={isSwapDisabled}
                                data-focus-visible="false"
                            >
                                <ArrowDownUp className="w-6 h-6" />
                            </Button>
                        </div>
                    </Tooltip>
                </div>
            )}

            <PathField
                path={destPath}
                setPath={setDestPath}
                label={destOptions.label}
                placeholder={destOptions.placeholder}
                showSuggestions={destOptions.showSuggestions}
                clearable={destOptions.clearable}
                showFiles={false}
            />
        </div>
    )
}

export function PathField({
    path,
    setPath,
    label,
    placeholder = 'Enter a remote:/path or local path, or tap to select files',
    description,
    showSuggestions = true,
    clearable = true,
    showPicker = true,
    allowedKeys,
    showFiles = true,
}: {
    path: string
    setPath: (path: string) => void
    label: string
    placeholder?: string
    description?: string
    showSuggestions?: boolean
    clearable?: boolean
    showPicker?: boolean
    allowedKeys?: ('LOCAL_FS' | 'FAVORITES' | 'REMOTES')[]
    showFiles?: boolean
}) {
    const remotes = useStore((state) => state.remotes)

    const [debouncedPath] = useDebounce(path, 800)

    const fieldRef = useRef<HTMLInputElement>(null)

    const [suggestions, setSuggestions] = useState<
        {
            IsDir: boolean
            Name: string
            Path: string
            _showAvatar: boolean
        }[]
    >([])
    const [isLoading, setIsLoading] = useState<boolean>(false)
    const [error, setError] = useState<string | null>(null)
    const [isOpen, setIsOpen] = useState<boolean>(false)

    const visibleSuggestions = showSuggestions ? suggestions : []

    async function fetchSuggestions(searchPath: string) {
        setIsLoading(true)
        setError(null)

        // console.log('fetching suggestions for', path, field)

        let cleanedPath = searchPath
        const extraSlash = cleanedPath.endsWith(sep()) ? '' : sep()

        try {
            // If path is empty, show list of remotes
            if (!searchPath) {
                const remoteItems = remotes.map((remote) => ({
                    IsDir: true,
                    Name: remote + ':/',
                    Path: remote + ':/',
                    _showAvatar: true,
                }))
                setSuggestions(remoteItems)
                setIsLoading(false)
                return
            }

            // Fetch suggestions for local paths
            if (!isRemotePath(searchPath)) {
                let localEntries: Awaited<ReturnType<typeof readDir>> = []

                try {
                    localEntries = await readDir(cleanedPath)
                } catch (err) {
                    // most likely due to the path being a file
                    console.error('Failed to fetch local suggestions:', err)
                    try {
                        // we also retry in case the last part of the path is wrong
                        cleanedPath = searchPath.split(sep()).slice(0, -1).join(sep())
                        localEntries = await readDir(cleanedPath)
                    } catch (err) {
                        console.error('Failed to fetch local suggestions (again):', err)
                    }
                }

                const localSuggestions = localEntries
                    .filter((entry) => !entry.isSymlink)
                    .map((entry) => ({
                        IsDir: entry.isDirectory,
                        Name: entry.name,
                        Path: `${cleanedPath}${extraSlash}${entry.name}`,
                        _showAvatar: false,
                    }))

                setSuggestions(localSuggestions)
                setIsLoading(false)
                return
            }

            // Split the path into remote and path parts
            const [remote, ...pathParts] = searchPath.split(':/')
            if (!remote) {
                // throw new Error('Invalid remote path format')
                setIsLoading(false)
                return
            }

            let remotePath = pathParts.join('/')
            if (remotePath.endsWith('/')) {
                remotePath = remotePath.slice(0, -1)
            }

            const items = await listPath(remote, remotePath, {
                noModTime: true,
                noMimeType: true,
            })

            const suggestionsWithRemote = items.map((item) => ({
                IsDir: item.IsDir,
                Name: item.Path,
                Path: `${remote}:/${item.Path}`,
                _showAvatar: false,
            }))

            setSuggestions(suggestionsWithRemote)
        } catch (err) {
            console.error('Failed to fetch suggestions:', err)
            const errorMessage = err instanceof Error ? err.message : 'Failed to fetch suggestions'
            setError(errorMessage)
            setSuggestions([])
        }
        setIsLoading(false)
    }

    useEffect(() => {
        let cancelTimeout: ReturnType<typeof setTimeout> | null = null
        if (!showSuggestions) {
            return
        }
        if (debouncedPath) {
            fetchSuggestions(debouncedPath).then(() => {
                if (fieldRef.current) {
                    fieldRef.current.blur()
                    cancelTimeout = setTimeout(() => {
                        fieldRef.current?.focus()
                    }, 100)
                }
            })
        }
        return () => {
            if (cancelTimeout) {
                clearTimeout(cancelTimeout)
                cancelTimeout = null
            }
        }
        // biome-ignore lint/correctness/useExhaustiveDependencies: <compiler>
    }, [debouncedPath, fetchSuggestions, showSuggestions])

    return (
        <div className="flex gap-2">
            <div className="flex-1">
                <Autocomplete
                    size="lg"
                    ref={fieldRef}
                    label={label}
                    allowsCustomValue={true}
                    inputValue={path || ''}
                    onInputChange={(e) => {
                        setPath(e)
                    }}
                    onFocus={() => {
                        if (!path) {
                            fetchSuggestions('')
                        }
                    }}
                    shouldCloseOnBlur={false}
                    placeholder={placeholder}
                    isInvalid={!!error}
                    errorMessage={error}
                    isLoading={isLoading}
                    selectorIcon={showSuggestions ? undefined : null}
                    isClearable={clearable}
                    description={description}
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck="false"
                    onClear={() => {
                        setPath('')
                        setSuggestions([])
                        setError(null)
                    }}
                >
                    {visibleSuggestions.map((item, index) => (
                        <AutocompleteItem
                            startContent={
                                item._showAvatar ? (
                                    <RemoteAvatar remote={item.Path.replace(':/', '')} />
                                ) : item.IsDir ? (
                                    '📁'
                                ) : (
                                    '📄'
                                )
                            }
                            key={index}
                            textValue={item.Path}
                            title={item.Name}
                        />
                    ))}
                </Autocomplete>
            </div>
            {showPicker && (
                <Button
                    onPress={() => {
                        setIsOpen(true)
                    }}
                    type="button"
                    isIconOnly={true}
                    size="lg"
                    className="w-20 h-16"
                    data-focus-visible="false"
                >
                    <FolderOpen className="w-6 h-6" />
                </Button>
            )}

            <PathSelector
                onClose={() => {
                    setIsOpen(false)
                }}
                onSelect={(items) => {
                    console.log('[Copy] items', items)
                    setIsOpen(false)
                    const item = items[0]
                    if (!item) {
                        return
                    }
                    item.type === 'folder' && !item.path.endsWith('/') ? `${item.path}/` : item.path
                    setPath(item.path)
                }}
                isOpen={isOpen}
                allowedKeys={allowedKeys}
                allowFiles={showFiles}
                allowMultiple={false}
            />
        </div>
    )
}

export function MultiPathField({
    paths,
    setPaths,
    label,
    placeholder = 'Enter a remote:/path or local path, or tap to select files',
    showSuggestions = true,
    showPicker = true,
    clearable = true,
}: {
    paths: string[]
    setPaths: (paths: string[] | undefined) => void
    label: string
    placeholder?: string
    showSuggestions?: boolean
    showPicker?: boolean
    clearable?: boolean
}) {
    const remotes = useStore((state) => state.remotes)

    const [debouncedPath] = useDebounce(paths?.[0], 800)

    const fieldRef = useRef<HTMLInputElement>(null)

    const isMultiple = paths.length > 1

    const [suggestions, setSuggestions] = useState<
        {
            IsDir: boolean
            Name: string
            Path: string
            _showAvatar: boolean
        }[]
    >([])
    const [isLoading, setIsLoading] = useState<boolean>(false)
    const [error, setError] = useState<string | null>(null)
    const [isOpen, setIsOpen] = useState<boolean>(false)

    async function fetchSuggestions(path: string) {
        setIsLoading(true)
        setError(null)

        // console.log('fetching suggestions for', path, field)

        let cleanedPath = path
        const extraSlash = cleanedPath.endsWith(sep()) ? '' : sep()

        try {
            // If path is empty, show list of remotes
            if (!path) {
                const remoteItems = remotes.map((remote) => ({
                    IsDir: true,
                    Name: remote + ':/',
                    Path: remote + ':/',
                    _showAvatar: true,
                }))
                setSuggestions(remoteItems)
                setIsLoading(false)
                return
            }

            // Fetch suggestions for local paths
            if (!isRemotePath(path)) {
                let localEntries: Awaited<ReturnType<typeof readDir>> = []

                try {
                    localEntries = await readDir(cleanedPath)
                } catch (err) {
                    // most likely due to the path being a file
                    console.error('Failed to fetch local suggestions:', err)
                    try {
                        // we also retry in case the last part of the path is wrong
                        cleanedPath = path.split(sep()).slice(0, -1).join(sep())
                        localEntries = await readDir(cleanedPath)
                    } catch (err) {
                        console.error('Failed to fetch local suggestions (again):', err)
                    }
                }

                const localSuggestions = localEntries
                    .filter((entry) => !entry.isSymlink)
                    .map((entry) => ({
                        IsDir: entry.isDirectory,
                        Name: entry.name,
                        Path: `${cleanedPath}${extraSlash}${entry.name}`,
                        _showAvatar: false,
                    }))

                setSuggestions(localSuggestions)
                setIsLoading(false)
                return
            }

            // Split the path into remote and path parts
            const [remote, ...pathParts] = path.split(':/')
            if (!remote) {
                // throw new Error('Invalid remote path format')
                setIsLoading(false)
                return
            }

            let remotePath = pathParts.join('/')
            if (remotePath.endsWith('/')) {
                remotePath = remotePath.slice(0, -1)
            }

            const items = await listPath(remote, remotePath, {
                noModTime: true,
                noMimeType: true,
            })

            const suggestionsWithRemote = items.map((item) => ({
                IsDir: item.IsDir,
                Name: item.Path,
                Path: `${remote}:/${item.Path}`,
                _showAvatar: false,
            }))

            setSuggestions(suggestionsWithRemote)
        } catch (err) {
            console.error('Failed to fetch suggestions:', err)
            const errorMessage = err instanceof Error ? err.message : 'Failed to fetch suggestions'
            setError(errorMessage)
            setSuggestions([])
        }
        setIsLoading(false)
    }

    const visibleSuggestions = showSuggestions ? suggestions : []

    useEffect(() => {
        if (!showSuggestions) {
            return
        }
        if (isMultiple) {
            return
        }
        if (paths?.[0]) {
            fetchSuggestions(paths?.[0])
        }
        // biome-ignore lint/correctness/useExhaustiveDependencies: <compiler>
    }, [paths, fetchSuggestions, showSuggestions, isMultiple])

    useEffect(() => {
        let cancelTimeout: ReturnType<typeof setTimeout> | null = null
        if (!showSuggestions) {
            return
        }
        if (isMultiple) {
            return
        }
        if (debouncedPath) {
            fetchSuggestions(debouncedPath).then(() => {
                if (fieldRef.current) {
                    fieldRef.current.blur()
                    cancelTimeout = setTimeout(() => {
                        fieldRef.current?.focus()
                    }, 100)
                }
            })
        }
        return () => {
            if (cancelTimeout) {
                clearTimeout(cancelTimeout)
                cancelTimeout = null
            }
        }
        // biome-ignore lint/correctness/useExhaustiveDependencies: <compiler>
    }, [debouncedPath, fetchSuggestions, showSuggestions, isMultiple])

    return (
        <div className="flex gap-2">
            <div className="flex-1">
                {isMultiple ? (
                    <div className="flex flex-col h-16 gap-0.5 p-2.5 overflow-y-auto bg-default-100 rounded-medium">
                        {paths.map((path, index) => (
                            <p key={index} className="text-xs text-foreground-600">
                                {index + 1}. {path}
                            </p>
                        ))}
                    </div>
                ) : (
                    <Autocomplete
                        size="lg"
                        ref={fieldRef}
                        label={label}
                        allowsCustomValue={true}
                        inputValue={paths?.[0] || ''}
                        onInputChange={(e) => setPaths([e])}
                        onFocus={() => {
                            if (!paths?.[0]) {
                                fetchSuggestions('')
                            }
                        }}
                        shouldCloseOnBlur={false}
                        placeholder={placeholder}
                        isInvalid={!!error}
                        errorMessage={error}
                        isLoading={isLoading}
                        selectorIcon={showSuggestions ? undefined : null}
                        isClearable={clearable}
                        onClear={() => {
                            setPaths([])
                            setSuggestions([])
                            setError(null)
                        }}
                    >
                        {visibleSuggestions.map((item, index) => (
                            <AutocompleteItem
                                startContent={
                                    item._showAvatar ? (
                                        <RemoteAvatar remote={item.Path.replace(':/', '')} />
                                    ) : item.IsDir ? (
                                        '📁'
                                    ) : (
                                        '📄'
                                    )
                                }
                                key={index}
                                textValue={item.Path}
                                title={item.Name}
                            />
                        ))}
                    </Autocomplete>
                )}
            </div>
            {showPicker && (
                <Button
                    onPress={() => {
                        if (isMultiple) {
                            setPaths([])
                            return
                        }
                        setIsOpen(true)
                    }}
                    isIconOnly={true}
                    size="lg"
                    className="w-20 h-18"
                    data-focus-visible="false"
                >
                    {isMultiple ? (
                        <XIcon className="w-6 h-6" />
                    ) : (
                        <FolderOpen className="w-6 h-6" />
                    )}
                </Button>
            )}

            <PathSelector
                onClose={() => {
                    setIsOpen(false)
                }}
                onSelect={(items) => {
                    console.log('[Copy] items', items)
                    setIsOpen(false)
                    setPaths(
                        items.map((item) =>
                            item.type === 'folder' && !item.path.endsWith('/')
                                ? `${item.path}/`
                                : item.path
                        )
                    )
                }}
                isOpen={isOpen}
            />
        </div>
    )
}
