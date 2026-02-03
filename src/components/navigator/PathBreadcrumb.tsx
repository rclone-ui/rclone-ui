import { Button, Input, Tooltip, cn } from '@heroui/react'
import { useQuery } from '@tanstack/react-query'
import { platform } from '@tauri-apps/plugin-os'
import { CheckIcon, ChevronRightIcon, LaptopIcon, PencilIcon, StarIcon } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import rclone from '../../../lib/rclone/client.ts'
import type { RemoteString } from './types'
import { getPathSegments } from './utils'

export default function PathBreadcrumb({
    remote,
    path,
    pathInput,
    onNavigate,
    onPathInputChange,
    isReadOnly = false,
}: {
    remote: RemoteString
    path: string
    pathInput: string
    onNavigate: (path: string) => void
    onPathInputChange: (value: string) => void
    isReadOnly?: boolean
}) {
    const [isInputMode, setIsInputMode] = useState(false)
    const inputRef = useRef<HTMLInputElement>(null)

    const remoteConfigQuery = useQuery({
        queryKey: ['remote', remote, 'config'],
        queryFn: async () => {
            if (!remote || remote === 'UI_LOCAL_FS' || remote === 'UI_FAVORITES') return null
            return await rclone('/config/get', {
                params: { query: { name: remote } },
            })
        },
        enabled: !!remote && remote !== 'UI_LOCAL_FS' && remote !== 'UI_FAVORITES',
    })

    const remoteType = remoteConfigQuery.data?.type

    const segments = getPathSegments(path)

    const handleSegmentClick = useCallback(
        (index: number) => {
            if (index < 0) {
                onNavigate(remote === 'UI_LOCAL_FS' ? '/' : `${remote}:/`)
            } else {
                const newPath = segments.slice(0, index + 1).join('/')
                if (remote === 'UI_LOCAL_FS') {
                    onNavigate('/' + newPath)
                } else {
                    onNavigate(`${remote}:/${newPath}`)
                }
            }
        },
        [segments, onNavigate, remote]
    )

    const handleInputKeyDown = useCallback(
        (e: React.KeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Enter') {
                const value = pathInput.trim()
                if (value) {
                    onNavigate(value)
                }
                setIsInputMode(false)
            } else if (e.key === 'Escape') {
                setIsInputMode(false)
            }
        },
        [pathInput, onNavigate]
    )

    const toggleInputMode = useCallback(() => {
        if (isReadOnly) return
        setIsInputMode((prev) => !prev)
    }, [isReadOnly])

    const handleConfirmInput = useCallback(() => {
        const value = pathInput.trim()
        if (value) {
            onNavigate(value)
        }
        setIsInputMode(false)
    }, [pathInput, onNavigate])

    useEffect(() => {
        if (isInputMode && inputRef.current) {
            inputRef.current.focus()
            inputRef.current.select()
        }
    }, [isInputMode])

    const renderRemoteIcon = () => {
        if (remote === 'UI_LOCAL_FS') {
            return <LaptopIcon className="size-4" />
        }
        if (remote === 'UI_FAVORITES') {
            return <StarIcon className="stroke-warning fill-warning size-4" />
        }
        if (remoteType) {
            return (
                <img
                    src={`/icons/backends/${remoteType}.png`}
                    className="object-contain size-4"
                    alt={remoteType}
                />
            )
        }
        return null
    }

    const remoteLabel =
        remote === 'UI_LOCAL_FS' ? 'Local' : remote === 'UI_FAVORITES' ? 'Favorites' : remote

    return (
        <div
            className={cn(
                'group flex items-center w-full h-12 px-3 gap-1 bg-default-100 border-b border-divider',
                platform() === 'macos' && 'pt-5 h-16'
            )}
        >
            {isInputMode ? (
                <Input
                    ref={inputRef}
                    value={pathInput}
                    onChange={(e) => onPathInputChange(e.target.value)}
                    onKeyDown={handleInputKeyDown}
                    onBlur={() => setIsInputMode(false)}
                    placeholder="Enter path"
                    size="sm"
                    variant="flat"
                    radius="sm"
                    classNames={{
                        base: 'flex-1',
                        input: 'text-sm',
                        inputWrapper: 'h-8',
                    }}
                    autoCapitalize="off"
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck="false"
                />
            ) : (
                <div className="flex items-center flex-1 gap-1 overflow-x-auto">
                    <Button
                        size="sm"
                        variant="light"
                        className="gap-1.5 min-w-fit px-2 shrink-0"
                        onPress={() => handleSegmentClick(-1)}
                        isDisabled={isReadOnly}
                    >
                        {renderRemoteIcon()}
                        <span className="text-sm font-medium">{remoteLabel}</span>
                    </Button>

                    {segments.map((segment, index) => (
                        <div
                            key={`${segment}-${index}`}
                            className="flex items-center gap-1 shrink-0"
                        >
                            <ChevronRightIcon className="text-default-400 size-4 shrink-0" />
                            <Button
                                size="sm"
                                variant="light"
                                className="px-2 min-w-fit"
                                onPress={() => handleSegmentClick(index)}
                                isDisabled={isReadOnly}
                            >
                                <span className="text-sm">{segment}</span>
                            </Button>
                        </div>
                    ))}
                </div>
            )}

            {!isReadOnly && (
                <Tooltip
                    content={isInputMode ? 'Confirm' : 'Edit path'}
                    size="sm"
                    color="foreground"
                >
                    <Button
                        isIconOnly={true}
                        size="sm"
                        variant="light"
                        onPress={isInputMode ? handleConfirmInput : toggleInputMode}
                        onMouseDown={isInputMode ? (e) => e.preventDefault() : undefined}
                        className="shrink-0"
                    >
                        {isInputMode ? (
                            <CheckIcon className="text-success size-4" />
                        ) : (
                            <PencilIcon className="transition-opacity duration-300 opacity-0 size-4 group-hover:opacity-100" />
                        )}
                    </Button>
                </Tooltip>
            )}
        </div>
    )
}
