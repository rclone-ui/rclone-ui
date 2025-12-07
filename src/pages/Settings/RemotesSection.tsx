import {
    Button,
    Card,
    CardBody,
    Dropdown,
    DropdownItem,
    DropdownMenu,
    DropdownTrigger,
    Spinner,
} from '@heroui/react'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { ask, message } from '@tauri-apps/plugin-dialog'
import { platform } from '@tauri-apps/plugin-os'
import {
    CableIcon,
    PencilIcon,
    PlusIcon,
    RefreshCcwIcon,
    SettingsIcon,
    Trash2Icon,
} from 'lucide-react'
import { type ReactNode, startTransition, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { formatBytes } from '../../../lib/format'
import rclone from '../../../lib/rclone/client'
import { SUPPORTS_ABOUT } from '../../../lib/rclone/constants'
import { usePersistedStore } from '../../../store/persisted'
import RemoteAutoMountDrawer from '../../components/RemoteAutoMountDrawer'
import RemoteCreateDrawer from '../../components/RemoteCreateDrawer'
import RemoteEditDrawer from '../../components/RemoteEditDrawer'
import BaseSection from './BaseSection'

export default function RemotesSection() {
    const queryClient = useQueryClient()
    const [searchParams] = useSearchParams()
    const licenseValid = usePersistedStore((state) => state.licenseValid)

    const remotesQuery = useQuery({
        queryKey: ['remotes', 'list', 'all'],
        queryFn: async () => {
            const [remotes] = await Promise.all([
                rclone('/config/listremotes').then((r) => r?.remotes),
                new Promise((resolve) => setTimeout(resolve, 1400)),
            ])
            return remotes
        },
        staleTime: 1000 * 60, // 1 minute
    })

    const remotes = useMemo(() => remotesQuery.data ?? [], [remotesQuery.data])

    const remoteConfigQueries = useQueries({
        queries: remotes.map((remote) => ({
            queryKey: ['remotes', remote, 'config', 'sortable'],
            queryFn: async () => {
                const config = await rclone('/config/get', {
                    params: { query: { name: remote } },
                })
                return { remote, type: config?.type ?? null }
            },
            staleTime: 1000 * 60,
        })),
    })

    const sortedRemotes = useMemo(
        () =>
            [...remotes].sort((a, b) => {
                const configA = remoteConfigQueries.find((q) => q.data?.remote === a)?.data
                const configB = remoteConfigQueries.find((q) => q.data?.remote === b)?.data

                const aSupportsAbout = configA?.type ? SUPPORTS_ABOUT.includes(configA.type) : false
                const bSupportsAbout = configB?.type ? SUPPORTS_ABOUT.includes(configB.type) : false

                if (aSupportsAbout && !bSupportsAbout) return -1
                if (!aSupportsAbout && bSupportsAbout) return 1

                return a.localeCompare(b)
            }),
        [remotes, remoteConfigQueries]
    )

    const [pickedRemote, setPickedRemote] = useState<string | null>(null)

    const [editingDrawerOpen, setEditingDrawerOpen] = useState(false)
    const [creatingDrawerOpen, setCreatingDrawerOpen] = useState(false)
    const [autoMountDrawerOpen, setAutoMountDrawerOpen] = useState(false)

    const deleteRemoteMutation = useMutation({
        mutationFn: async (remote: string) => {
            await rclone('/config/delete', {
                params: {
                    query: {
                        name: remote,
                    },
                },
            })

            return remote
        },
        onSuccess: async (remote) => {
            queryClient.setQueryData(['remotes', 'list', 'all'], (old: string[] | undefined) => [
                ...(old ?? []).filter((r) => r !== remote),
            ])
        },
        onError: async (error) => {
            console.error('Failed to delete remote:', error)
            await message(error instanceof Error ? error.message : 'Unknown error occurred', {
                title: 'Could not delete remote',
                kind: 'error',
            })
        },
    })

    const Placeholder = useMemo(() => {
        const withRoot = (element: ReactNode) => {
            return (
                <div className="flex flex-col px-4 justify-center items-center h-[calc(100dvh-14rem)]">
                    {element}
                </div>
            )
        }

        if (remotesQuery.isLoading || remotesQuery.isRefetching) {
            return withRoot(<Spinner size="lg" color="primary" className="scale-150" />)
        }

        if (remotes.length === 0 && !creatingDrawerOpen) {
            return withRoot(
                <div className="flex flex-col items-center justify-center gap-8">
                    <h1 className="text-2xl font-bold">No remotes found</h1>
                    <Button
                        onPress={() => setCreatingDrawerOpen(true)}
                        color="primary"
                        data-focus-visible="false"
                        variant="shadow"
                        size="lg"
                    >
                        Create Remote
                    </Button>
                </div>
            )
        }

        return null
    }, [remotesQuery.isLoading, remotesQuery.isRefetching, remotes.length, creatingDrawerOpen])

    useEffect(() => {
        const tab = searchParams.get('tab')
        const action = searchParams.get('action')
        const remote = searchParams.get('remote')

        if (tab === 'remotes' && action === 'create') {
            startTransition(() => {
                setCreatingDrawerOpen(true)
            })
        } else if (tab === 'remotes' && action === 'edit' && remote) {
            startTransition(() => {
                setPickedRemote(remote)
                setEditingDrawerOpen(true)
            })
        } else if (tab === 'remotes' && action === 'auto-mount' && remote) {
            startTransition(() => {
                setPickedRemote(remote)
                setAutoMountDrawerOpen(true)
            })
        }
    }, [searchParams])

    return (
        <BaseSection
            header={{
                title: 'Remotes',
                endContent: (
                    <div className="flex flex-row items-center gap-2">
                        <Button
                            onPress={() => {
                                setTimeout(async () => {
                                    await remotesQuery.refetch()
                                }, 100)
                            }}
                            isIconOnly={true}
                            variant="faded"
                            color="primary"
                            data-focus-visible="false"
                            size="sm"
                            isDisabled={remotesQuery.isRefetching}
                        >
                            <RefreshCcwIcon className="w-4 h-4" />
                        </Button>
                        <Button
                            onPress={() => {
                                setTimeout(async () => {
                                    if (!licenseValid && remotes.length >= 4) {
                                        await message(
                                            'Community version does not support adding more than 4 remotes.',
                                            {
                                                title: 'Missing license',
                                                kind: 'error',
                                            }
                                        )
                                        return
                                    }

                                    setCreatingDrawerOpen(true)
                                }, 100)
                            }}
                            isIconOnly={true}
                            variant="faded"
                            color="primary"
                            data-focus-visible="false"
                            size="sm"
                        >
                            <PlusIcon className="w-4 h-4" />
                        </Button>
                    </div>
                ),
            }}
        >
            {Placeholder}

            {!Placeholder && (
                <div className="flex flex-col gap-2.5 px-4 pb-10">
                    {sortedRemotes.map((remote) => (
                        <RemoteCard
                            key={remote}
                            remote={remote}
                            onAutoMountPress={() => {
                                startTransition(() => {
                                    setPickedRemote(remote)
                                    setAutoMountDrawerOpen(true)
                                })
                            }}
                            onConfigPress={() => {
                                startTransition(() => {
                                    setPickedRemote(remote)
                                    setEditingDrawerOpen(true)
                                })
                            }}
                            onDeletePress={async () => {
                                const confirmation = await ask(
                                    `Are you sure you want to remove ${remote}? This action cannot be reverted.`,
                                    { title: `Removing ${remote}`, kind: 'warning' }
                                )

                                if (!confirmation) {
                                    return
                                }

                                deleteRemoteMutation.mutate(remote)
                            }}
                        />
                    ))}
                </div>
            )}

            {pickedRemote && (
                <RemoteEditDrawer
                    isOpen={editingDrawerOpen}
                    onClose={() => {
                        setEditingDrawerOpen(false)
                        setTimeout(() => {
                            // allow for drawer effect to happen
                            setPickedRemote(null)
                        }, 100)
                    }}
                    remoteName={pickedRemote}
                />
            )}

            <RemoteCreateDrawer
                isOpen={creatingDrawerOpen}
                onClose={() => {
                    startTransition(() => {
                        setCreatingDrawerOpen(false)
                    })
                }}
            />

            {pickedRemote && (
                <RemoteAutoMountDrawer
                    isOpen={autoMountDrawerOpen}
                    onClose={() => {
                        startTransition(() => {
                            setAutoMountDrawerOpen(false)
                            setTimeout(() => {
                                // allow for drawer effect to happen
                                setPickedRemote(null)
                            }, 100)
                        })
                    }}
                    remoteName={pickedRemote}
                />
            )}
        </BaseSection>
    )
}

function RemoteCard({
    remote,
    onAutoMountPress,
    onConfigPress,
    onDeletePress,
}: {
    remote: string
    onAutoMountPress: () => void
    onConfigPress: () => void
    onDeletePress: () => void
}) {
    const { data: remoteConfigData } = useQuery({
        queryKey: ['remotes', remote, 'config'],
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

    const type = useMemo(() => remoteConfigData?.type ?? null, [remoteConfigData?.type])
    const provider = useMemo(() => remoteConfigData?.provider ?? null, [remoteConfigData?.provider])
    const supportsAbout = useMemo(() => !!type && SUPPORTS_ABOUT.includes(type), [type])

    const { data: remoteAboutData } = useQuery({
        queryKey: ['remotes', remote, 'about'],
        queryFn: async () => {
            return await rclone('/operations/about', {
                params: {
                    query: {
                        fs: `${remote}:`,
                    },
                },
            })
        },
        enabled: supportsAbout,
    })

    console.log('about', remote, type, JSON.stringify(remoteAboutData, null, 2))

    const imageUrl = useMemo(
        () =>
            provider && !type ? `/icons/providers/${provider}.png` : `/icons/backends/${type}.png`,
        [provider, type]
    )

    const aboutData = useMemo(() => remoteAboutData, [remoteAboutData])

    return (
        <Card
            key={remote}
            shadow="sm"
            isBlurred={true}
            className="h-20 border-[0.5px] dark:border-none border-divider bg-content3/50 dark:bg-content2/90"
            isPressable={true}
            onPress={onConfigPress}
        >
            <CardBody>
                <div className="flex items-center justify-between h-full">
                    <div className="flex items-center gap-4">
                        <img src={imageUrl} className="object-contain ml-2 size-10" alt={remote} />
                        <p className="font-light text-large">{remote}</p>
                    </div>
                    <div className="flex items-center justify-end gap-4">
                        {/* Storage info boxes */}
                        {!!aboutData && (
                            <div className="flex items-center gap-2.5">
                                {aboutData.free !== undefined && (
                                    <StorageInfoBox
                                        label="Free"
                                        value={aboutData.free}
                                        color="success"
                                    />
                                )}
                                {aboutData.used !== undefined && (
                                    <StorageInfoBox
                                        label="Used"
                                        value={aboutData.used}
                                        color="warning"
                                    />
                                )}
                                {aboutData.total !== undefined && (
                                    <StorageInfoBox
                                        label="Total"
                                        value={aboutData.total}
                                        color="secondary"
                                    />
                                )}
                            </div>
                        )}

                        <Dropdown shadow={platform() === 'windows' ? 'none' : undefined}>
                            <DropdownTrigger>
                                <Button
                                    type="button"
                                    color="default"
                                    isIconOnly={true}
                                    radius="full"
                                    variant="light"
                                >
                                    <SettingsIcon className="opacity-50 size-8 hover:opacity-100" />
                                </Button>
                            </DropdownTrigger>
                            <DropdownMenu
                                onAction={async (key) => {
                                    console.log(key)
                                    const keyAsString = key as string

                                    if (keyAsString === 'config') {
                                        onConfigPress()
                                    } else if (keyAsString === 'automount') {
                                        onAutoMountPress()
                                    } else if (keyAsString === 'delete') {
                                        onDeletePress()
                                    }
                                }}
                            >
                                <DropdownItem
                                    startContent={<PencilIcon className="w-4 h-4" />}
                                    key="config"
                                >
                                    Edit Config
                                </DropdownItem>
                                <DropdownItem
                                    startContent={<CableIcon className="w-4 h-4" />}
                                    key="automount"
                                >
                                    Auto Mount
                                </DropdownItem>
                                <DropdownItem
                                    startContent={<Trash2Icon className="w-4 h-4" />}
                                    key="delete"
                                    color="danger"
                                >
                                    Delete
                                </DropdownItem>
                            </DropdownMenu>
                        </Dropdown>
                    </div>
                </div>
            </CardBody>
        </Card>
    )
}

const STORAGE_BOX_STYLES = {
    success: {
        bg: 'bg-success/10',
        text: 'text-success',
    },
    warning: {
        bg: 'bg-warning/10',
        text: 'text-warning',
    },
    secondary: {
        bg: 'bg-secondary/20',
        text: 'text-secondary-600',
    },
} as const

function StorageInfoBox({
    label,
    value,
    color,
}: {
    label: string
    value: number
    color: 'success' | 'warning' | 'secondary'
}) {
    const styles = STORAGE_BOX_STYLES[color]
    return (
        <div
            className={`flex flex-col w-16 items-center justify-center py-1 rounded-md ${styles.bg}`}
        >
            <span className={`text-[10px] uppercase font-medium ${styles.text}`}>{label}</span>
            <span className={`text-xs font-semibold ${styles.text}`}>{formatBytes(value)}</span>
        </div>
    )
}
