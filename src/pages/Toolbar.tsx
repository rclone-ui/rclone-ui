import { Divider, Kbd, ScrollShadow, cn } from '@heroui/react'
import { useQuery } from '@tanstack/react-query'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { platform } from '@tauri-apps/plugin-os'
import type { KeyboardEvent, MouseEvent as ReactMouseEvent } from 'react'
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useDebounce } from 'use-debounce'
import { fetchMountList, fetchServeList } from '../../lib/rclone/api'
import rclone from '../../lib/rclone/client'
import { openWindow } from '../../lib/window'
import { type ResolvedToolbarResult, runToolbarEngine } from '../../toolbar/engine'

const toolbarWindow = getCurrentWebviewWindow()
const isWindows = platform() === 'windows'

const ELEMENT_ID_REGEX = /[^a-zA-Z0-9_-]/g

type PositionPayload = { x: number; y: number }

const shortcutModifierKey = platform() === 'macos' ? 'command' : 'ctrl'
const letterShortcuts = 'BDEFGHIJKLMNOPQRSTUWYZ'.split('')

const getShortcutDisplay = (index: number): string | null => {
    if (index < 9) {
        return String(index + 1)
    }
    const letterIndex = index - 9
    if (letterIndex < 0 || letterIndex >= letterShortcuts.length) {
        return null
    }
    return letterShortcuts[letterIndex] ?? null
}

async function closeToolbar() {
    try {
        await toolbarWindow.hide()
    } catch (error) {
        console.warn('[Toolbar] Failed to hide toolbar', error)
    }
}

function Shortcut({ index, isActive }: { index: number; isActive: boolean }) {
    const shortcutDisplay = useMemo(() => getShortcutDisplay(index), [index])

    if (!shortcutDisplay) {
        return null
    }

    return (
        <Kbd
            keys={[shortcutModifierKey]}
            classNames={{
                base: cn('shadow-none bg-content3', isActive && 'bg-content2'),
                content: 'text-xs',
                abbr: 'text-xs',
            }}
        >
            {shortcutDisplay}
        </Kbd>
    )
}

export default function Toolbar() {
    const [engineResults, setEngineResults] = useState<ResolvedToolbarResult[]>([])

    const remotesQuery = useQuery({
        queryKey: ['remotes', 'list', 'all'],
        queryFn: async () => await rclone('/config/listremotes').then((r) => r?.remotes),
        refetchInterval: 60_000,
    })

    const remoteTypesQuery = useQuery({
        queryKey: ['remotes', 'types'],
        queryFn: async () => {
            const dump = await rclone('/config/dump')
            const types: Record<string, string> = {}
            if (dump && typeof dump === 'object') {
                for (const [name, config] of Object.entries(dump)) {
                    if (config && typeof config === 'object' && 'type' in config) {
                        types[name] = (config as { type: string }).type
                    }
                }
            }
            return types
        },
        refetchInterval: 60_000,
    })

    const { data: serveList } = useQuery({
        queryKey: ['serve', 'list'],
        queryFn: fetchServeList,
        refetchInterval: 5_000,
    })

    const { data: mountList } = useQuery({
        queryKey: ['mount', 'list'],
        queryFn: fetchMountList,
        refetchInterval: 5_000,
    })

    const remotes = useMemo(() => remotesQuery.data ?? [], [remotesQuery.data])
    const remoteTypes = useMemo(() => remoteTypesQuery.data ?? {}, [remoteTypesQuery.data])

    const [searchString, setSearchString] = useState('')
    const [searchStringDebounced] = useDebounce(searchString, 40)

    const [highlightedIndex, setHighlightedIndex] = useState(0)

    const isKeyboardNavigatingRef = useRef(false)
    const lastMousePositionRef = useRef<{ x: number; y: number } | null>(null)

    const activeAreaRef = useRef<HTMLDivElement>(null)
    const inputRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        console.log(`${mountList?.length} mounts`)
        console.log(`${serveList?.length} serves`)

        const { results } = runToolbarEngine(searchStringDebounced, remotes, remoteTypes)
        startTransition(() => {
            setEngineResults(results)
        })
    }, [mountList, serveList, searchStringDebounced, remotes, remoteTypes])

    useEffect(() => {
        let unlisten: (() => void) | undefined
        let blurTimeoutId: ReturnType<typeof setTimeout> | undefined

        const setupBlurListener = async () => {
            try {
                unlisten = await toolbarWindow.listen('tauri://blur', async () => {
                    if (isWindows) {
                        blurTimeoutId = setTimeout(async () => {
                            try {
                                const isFocused = await toolbarWindow.isFocused()
                                if (!isFocused) {
                                    await closeToolbar()
                                }
                            } catch {
                                await closeToolbar()
                            }
                        }, 100)
                    } else {
                        await closeToolbar()
                    }
                })
            } catch (error) {
                console.warn('[Toolbar] Failed to listen for blur events', error)
            }
        }

        setupBlurListener().catch((error) =>
            console.warn('[Toolbar] Blur listener setup failed', error)
        )

        return () => {
            if (unlisten) {
                unlisten()
            }
            if (blurTimeoutId) {
                clearTimeout(blurTimeoutId)
            }
        }
    }, [])

    useEffect(() => {
        let unlisten: (() => void) | undefined

        const setupFocusListener = async () => {
            try {
                unlisten = await toolbarWindow.listen('tauri://focus', () => {
                    setTimeout(() => {
                        inputRef.current?.focus()
                    }, 50)
                })
            } catch (error) {
                console.warn('[Toolbar] Failed to listen for focus events', error)
            }
        }

        setupFocusListener().catch((error) =>
            console.warn('[Toolbar] Focus listener setup failed', error)
        )

        return () => {
            if (unlisten) {
                unlisten()
            }
        }
    }, [])

    const handleExecute = useCallback(async (result: ResolvedToolbarResult) => {
        await closeToolbar()
        setSearchString('')
        try {
            const action = result.resolve()
            await action.onPress(result.args, {
                openWindow,
            })
        } catch (error) {
            console.error('[Toolbar] Failed to execute action', error)
        }
    }, [])

    const executeShortcutAtIndex = useCallback(
        async (targetIndex: number) => {
            const selected = engineResults[targetIndex]
            if (!selected) {
                return false
            }
            startTransition(() => {
                setHighlightedIndex(targetIndex)
            })
            await handleExecute(selected)
            return true
        },
        [engineResults, handleExecute]
    )

    const tryHandleIndexShortcut = useCallback(
        async (event: KeyboardEvent<HTMLInputElement>) => {
            const modifierPressed = platform() === 'macos' ? event.metaKey : event.ctrlKey
            if (!modifierPressed || event.altKey || event.shiftKey) {
                return false
            }
            const shortcutNumber = Number.parseInt(event.key, 10)
            if (!Number.isNaN(shortcutNumber) && shortcutNumber > 0 && shortcutNumber <= 9) {
                const targetIndex = shortcutNumber - 1
                event.preventDefault()
                return executeShortcutAtIndex(targetIndex)
            }

            if (event.key.length === 1) {
                const key = event.key.toUpperCase()
                if (letterShortcuts.includes(key)) {
                    const letterIndex = letterShortcuts.indexOf(key)
                    const targetIndex = 9 + letterIndex
                    event.preventDefault()
                    return executeShortcutAtIndex(targetIndex)
                }
            }

            return false
        },
        [executeShortcutAtIndex]
    )

    const moveHighlightDown = useCallback(() => {
        if (engineResults.length === 0) {
            return
        }
        isKeyboardNavigatingRef.current = true
        setHighlightedIndex((index) => {
            const nextIndex = index + 1
            if (nextIndex >= engineResults.length) {
                return 0
            }
            return nextIndex
        })
    }, [engineResults.length])

    const moveHighlightUp = useCallback(() => {
        if (engineResults.length === 0) {
            return
        }
        isKeyboardNavigatingRef.current = true
        setHighlightedIndex((index) => {
            if (index <= 0) {
                return engineResults.length - 1
            }
            return index - 1
        })
    }, [engineResults.length])

    const handleMouseMove = useCallback((event: ReactMouseEvent) => {
        const lastPos = lastMousePositionRef.current
        if (lastPos && (lastPos.x !== event.clientX || lastPos.y !== event.clientY)) {
            isKeyboardNavigatingRef.current = false
        }
        lastMousePositionRef.current = { x: event.clientX, y: event.clientY }
    }, [])

    const handleItemMouseEnter = useCallback((index: number) => {
        if (isKeyboardNavigatingRef.current) {
            return
        }
        setHighlightedIndex(index)
    }, [])

    const selectHighlightedResult = useCallback(async () => {
        if (highlightedIndex < 0) {
            return
        }
        const selected = engineResults[highlightedIndex]
        if (!selected) {
            return
        }
        await handleExecute(selected)
    }, [highlightedIndex, engineResults, handleExecute])

    const handleKeyDown = useCallback(
        async (event: KeyboardEvent<HTMLInputElement>) => {
            if (event.key === 'ArrowDown') {
                event.preventDefault()
                moveHighlightDown()
                return
            }
            if (event.key === 'ArrowUp') {
                event.preventDefault()
                moveHighlightUp()
                return
            }
            if (event.key === 'Enter') {
                event.preventDefault()
                await selectHighlightedResult()
                return
            }
            if (event.key === 'Escape') {
                event.preventDefault()
                await closeToolbar()
                return
            }

            await tryHandleIndexShortcut(event)
        },
        [moveHighlightDown, moveHighlightUp, selectHighlightedResult, tryHandleIndexShortcut]
    )

    useEffect(() => {
        if (engineResults.length === 0) {
            startTransition(() => {
                setHighlightedIndex(-1)
            })
            return
        }
        startTransition(() => {
            setHighlightedIndex((previous) => {
                if (previous < 0) return 0
                if (previous >= engineResults.length) return engineResults.length - 1
                return previous
            })
        })
    }, [engineResults])

    useEffect(() => {
        if (isWindows) {
            return
        }

        let ignoreState: boolean | null = null
        let windowPosition: PositionPayload = { x: 0, y: 0 }
        let unlistenDeviceMove: (() => void) | undefined
        let unlistenWindowMove: (() => void) | undefined

        const updateCursorIgnore = (value: boolean) => {
            toolbarWindow
                .setIgnoreCursorEvents(value)
                .catch((error) => console.warn('failed to update cursor events', error))
        }

        const computeHitbox = () => {
            const element = activeAreaRef.current
            if (!element) {
                return null
            }
            const rect = element.getBoundingClientRect()
            const dpr = window.devicePixelRatio || 1

            return {
                left: windowPosition.x + rect.left * dpr,
                right: windowPosition.x + rect.right * dpr,
                top: windowPosition.y + rect.top * dpr,
                bottom: windowPosition.y + rect.bottom * dpr,
            }
        }

        const setup = async () => {
            await toolbarWindow.setIgnoreCursorEvents(false)
            try {
                const position = await toolbarWindow.outerPosition()
                windowPosition = { x: position.x, y: position.y }
            } catch (error) {
                console.warn('failed to read window position', error)
            }

            unlistenWindowMove = await toolbarWindow.listen<PositionPayload>(
                'tauri://move',
                ({ payload }) => {
                    windowPosition = payload
                }
            )

            const handlePointerMove = (event: PointerEvent) => {
                const hitbox = computeHitbox()
                if (!hitbox) {
                    return
                }

                const dpr = window.devicePixelRatio || 1
                const pointerX = windowPosition.x + event.clientX * dpr
                const pointerY = windowPosition.y + event.clientY * dpr

                const inside =
                    pointerX >= hitbox.left &&
                    pointerX <= hitbox.right &&
                    pointerY >= hitbox.top &&
                    pointerY <= hitbox.bottom

                const shouldIgnore = !inside
                if (shouldIgnore !== ignoreState) {
                    updateCursorIgnore(shouldIgnore)
                    ignoreState = shouldIgnore
                }
            }

            window.addEventListener('pointermove', handlePointerMove)
            unlistenDeviceMove = () => {
                window.removeEventListener('pointermove', handlePointerMove)
            }
        }

        setup().catch((error) => console.warn('failed to initialise cursor ignore handling', error))

        return () => {
            if (unlistenDeviceMove) {
                unlistenDeviceMove()
            }
            if (unlistenWindowMove) {
                unlistenWindowMove()
            }
            updateCursorIgnore(false)
        }
    }, [])

    useEffect(() => {
        if (highlightedIndex < 0) return
        const result = engineResults[highlightedIndex]
        if (!result) return
        const element = document.getElementById(
            `tb-result-${result.id.replace(ELEMENT_ID_REGEX, '-')}`
        )
        element?.scrollIntoView({ block: 'nearest' })
    }, [highlightedIndex, engineResults])

    return (
        <div className="flex flex-col items-center justify-center w-full h-full">
            <div
                ref={activeAreaRef}
                className="flex border-divider border flex-col items-center justify-center bg-content2/[0.97] w-[700px] rounded-large"
            >
                <div
                    data-tauri-drag-region={true}
                    className="flex flex-row items-center w-full overflow-hidden h-14"
                >
                    <img
                        data-tauri-drag-region={true}
                        src="/icon.png"
                        alt="Icon"
                        className="object-contain ml-3 mr-2 size-6 invert dark:invert-0"
                    />
                    <input
                        ref={inputRef}
                        data-tauri-drag-region={true}
                        autoCapitalize="off"
                        autoComplete="off"
                        autoCorrect="off"
                        spellCheck="false"
                        className="w-full h-full pb-0.5 text-2xl bg-transparent text-foreground focus:outline-none"
                        placeholder="Search commands, remotes, or paste a URL"
                        value={searchString}
                        onChange={(e) => setSearchString(e.target.value)}
                        onKeyDown={handleKeyDown}
                    />
                </div>

                <Divider />

                <ScrollShadow className="h-[400px] w-full p-2" onMouseMove={handleMouseMove}>
                    {engineResults.map((result, index) => {
                        const isActive = index === highlightedIndex
                        const elementId = `tb-result-${result.id.replace(ELEMENT_ID_REGEX, '-')}`
                        return (
                            <div key={result.id} className="flex flex-col">
                                <button
                                    id={elementId}
                                    type="button"
                                    onMouseEnter={() => handleItemMouseEnter(index)}
                                    onMouseDown={(event) => event.preventDefault()}
                                    onClick={() => handleExecute(result)}
                                    className={cn(
                                        'flex w-full flex-col gap-1 rounded-small px-2.5 py-2 text-left transition-colors ',
                                        isActive
                                            ? 'bg-primary/75 dark:bg-primary/50'
                                            : 'hover:bg-content2/60'
                                    )}
                                >
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="font-medium text-medium">
                                            {result.label}
                                        </span>
                                        <Shortcut index={index} isActive={isActive} />
                                    </div>
                                    {result.description ? (
                                        <span
                                            className={cn(
                                                'text-small text-foreground-500',
                                                isActive && 'text-primary-800'
                                            )}
                                        >
                                            {result.description}
                                        </span>
                                    ) : null}
                                </button>
                                {index !== engineResults.length - 1 && (
                                    <div
                                        className={cn(
                                            'ml-2 border-b border-divider h-0.5 rounded-small transition-opacity',
                                            (isActive || highlightedIndex === index + 1) &&
                                                'opacity-0 duration-100'
                                        )}
                                    />
                                )}
                            </div>
                        )
                    })}
                </ScrollShadow>
            </div>
        </div>
    )
}
