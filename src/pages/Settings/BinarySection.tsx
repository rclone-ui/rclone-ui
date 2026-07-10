import { Button, Checkbox, Chip, Input, Progress, Spinner, Tooltip } from '@heroui/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { message, open } from '@tauri-apps/plugin-dialog'
import {
    CheckIcon,
    DownloadIcon,
    FolderOpenIcon,
    HardDriveIcon,
    RefreshCwIcon,
    Trash2Icon,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { formatErrorMessage, reportError } from '../../../lib/errors'
import { formatBytes } from '../../../lib/format'
import {
    classifyRclonePath,
    compareVersions,
    findSystemRclone,
    probeRcloneBinaryOrThrow,
    validateRcloneBinary,
} from '../../../lib/rclone/common'
import { MIN_RCLONE_VERSION } from '../../../lib/rclone/constants'
import {
    type DownloadProgress,
    activateRclonePath,
    deleteVersion,
    downloadVersion,
    fetchAvailableVersions,
    getPathIntegration,
    listDownloadedVersions,
    setPathIntegration,
} from '../../../lib/rclone/versions'
import { usePersistedStore } from '../../../store/persisted'
import BaseSection from './BaseSection'

/** Warning for binaries below the version floor the app's Serve feature needs. */
function subFloorWarning(version: string | null | undefined): string | null {
    if (!version) return null
    return compareVersions(version, MIN_RCLONE_VERSION) < 0
        ? `Serve requires rclone ≥ ${MIN_RCLONE_VERSION.split('.').slice(0, 2).join('.')}`
        : null
}

export default function BinarySection() {
    const queryClient = useQueryClient()
    const rclonePath = usePersistedStore((state) => state.rclonePath)
    const [progress, setProgress] = useState<Record<string, DownloadProgress>>({})

    const downloadedQuery = useQuery({
        queryKey: ['rclone', 'downloaded'],
        queryFn: listDownloadedVersions,
    })
    const releasesQuery = useQuery({
        queryKey: ['rclone', 'releases'],
        queryFn: fetchAvailableVersions,
        staleTime: 60 * 60 * 1000,
        retry: 1,
    })
    const systemQuery = useQuery({
        queryKey: ['rclone', 'system'],
        queryFn: findSystemRclone,
    })
    const systemVersionQuery = useQuery({
        queryKey: ['rclone', 'system-version', systemQuery.data],
        queryFn: () => validateRcloneBinary(systemQuery.data!),
        enabled: !!systemQuery.data,
    })
    const classificationQuery = useQuery({
        queryKey: ['rclone', 'classify', rclonePath],
        queryFn: () => (rclonePath ? classifyRclonePath(rclonePath) : null),
        enabled: !!rclonePath,
    })

    const active = classificationQuery.data

    const invalidateActive = () => {
        queryClient.invalidateQueries({ queryKey: ['rclone'] })
    }

    const downloadMutation = useMutation({
        mutationFn: async (version: string) => {
            return await downloadVersion(version, (p) =>
                setProgress((prev) => ({ ...prev, [version]: p }))
            )
        },
        onSettled: (_data, _err, version) => {
            setProgress((prev) => {
                const next = { ...prev }
                delete next[version]
                return next
            })
            queryClient.invalidateQueries({ queryKey: ['rclone', 'downloaded'] })
        },
        onError: async (e) => {
            await message(`Download failed: ${formatErrorMessage(e, String(e))}`, {
                title: 'Error',
                kind: 'error',
            })
        },
    })

    const activateMutation = useMutation({
        mutationFn: async (opts: { path: string; isSystem?: boolean }) => {
            return await activateRclonePath(opts.path, { offerSystemConfig: opts.isSystem })
        },
        onSuccess: () => invalidateActive(),
    })

    const deleteMutation = useMutation({
        mutationFn: deleteVersion,
        onSettled: () => queryClient.invalidateQueries({ queryKey: ['rclone', 'downloaded'] }),
        onError: async (e) => {
            await message(`Could not delete: ${formatErrorMessage(e, String(e))}`, {
                title: 'Error',
                kind: 'error',
            })
        },
    })

    const downloadedVersions = downloadedQuery.data ?? []
    const downloadedSet = useMemo(
        () => new Set(downloadedVersions.map((v) => v.version)),
        [downloadedVersions]
    )
    const availableToDownload = (releasesQuery.data ?? []).filter(
        (r) => !downloadedSet.has(r.version)
    )

    const latestVersion = releasesQuery.data?.[0]?.version
    const updateAvailable =
        active?.kind === 'managed' &&
        active.version &&
        latestVersion &&
        !downloadedSet.has(latestVersion) &&
        active.version !== latestVersion

    return (
        <BaseSection header={{ title: 'Binary' }}>
            <div className="flex flex-col w-full gap-6 px-8 pb-10">
                {/* ---- Custom binary ---- */}
                <CustomBinaryRow
                    active={active}
                    systemPath={systemQuery.data ?? null}
                    rclonePath={rclonePath}
                    onActivated={invalidateActive}
                />

                {/* ---- PATH integration ---- */}
                <PathIntegrationRow
                    rclonePath={rclonePath}
                    isSystemActive={active?.kind === 'system'}
                />

                {/* ---- Auto update ---- */}
                <AutoUpdateRow />

                {/* ---- Versions ---- */}
                <div className="flex flex-col overflow-hidden border divide-y rounded-large border-divider divide-divider">
                    {/* System */}
                    {systemQuery.data && (
                        <VersionRow
                            label={
                                systemVersionQuery.data
                                    ? `System — v${systemVersionQuery.data}`
                                    : 'System'
                            }
                            sublabel={systemQuery.data}
                            warning={subFloorWarning(systemVersionQuery.data)}
                            isActive={active?.kind === 'system'}
                            actionLabel="Use"
                            isActivating={activateMutation.isPending}
                            onActivate={() =>
                                activateMutation.mutate({
                                    path: systemQuery.data!,
                                    isSystem: true,
                                })
                            }
                        />
                    )}

                    {/* Downloaded (managed) */}
                    {downloadedVersions.map((v) => {
                        const isActive = active?.kind === 'managed' && active.version === v.version
                        return (
                            <VersionRow
                                key={v.path}
                                label={`v${v.version}`}
                                sublabel={formatBytes(v.sizeBytes)}
                                warning={subFloorWarning(v.version)}
                                isActive={isActive}
                                actionLabel="Use"
                                isActivating={activateMutation.isPending}
                                onActivate={() => activateMutation.mutate({ path: v.path })}
                                onDelete={
                                    isActive ? undefined : () => deleteMutation.mutate(v.version)
                                }
                                isDeleting={
                                    deleteMutation.isPending &&
                                    deleteMutation.variables === v.version
                                }
                            />
                        )
                    })}

                    {/* Available to download */}
                    {availableToDownload.map((r) => {
                        const prog = progress[r.version]
                        const percent = prog?.total
                            ? Math.min(100, Math.round((prog.downloaded / prog.total) * 100))
                            : undefined
                        const isDownloading =
                            downloadMutation.isPending && downloadMutation.variables === r.version
                        return (
                            <div key={r.version} className="flex items-center gap-3 px-4 py-3">
                                <div className="flex flex-col flex-1 min-w-0">
                                    <span className="text-sm text-neutral-500">v{r.version}</span>
                                    {isDownloading && (
                                        <Progress
                                            aria-label="download progress"
                                            size="sm"
                                            value={percent ?? 0}
                                            isIndeterminate={percent === undefined}
                                            className="mt-1 max-w-52"
                                        />
                                    )}
                                </div>
                                <Button
                                    size="sm"
                                    variant="light"
                                    isIconOnly={true}
                                    isLoading={isDownloading}
                                    onPress={() => downloadMutation.mutate(r.version)}
                                    data-focus-visible="false"
                                >
                                    <DownloadIcon className="w-4 h-4" />
                                </Button>
                            </div>
                        )
                    })}

                    {(downloadedVersions.length > 0 || systemQuery.data) &&
                        availableToDownload.length === 0 &&
                        releasesQuery.isError && (
                            <div className="flex items-center justify-between gap-2 px-4 py-3">
                                <span className="text-xs text-warning">
                                    Couldn't load available versions (offline or rate-limited).
                                </span>
                                <Button
                                    size="sm"
                                    variant="light"
                                    onPress={() => releasesQuery.refetch()}
                                    startContent={<RefreshCwIcon className="w-3.5 h-3.5" />}
                                    data-focus-visible="false"
                                >
                                    Retry
                                </Button>
                            </div>
                        )}

                    {releasesQuery.isLoading && downloadedVersions.length === 0 && (
                        <div className="flex items-center justify-center py-6">
                            <Spinner size="sm" />
                        </div>
                    )}
                </div>

                {updateAvailable && (
                    <div className="flex items-center gap-2 -mt-3">
                        <Chip size="sm" color="primary" variant="flat">
                            Update available: v{latestVersion}
                        </Chip>
                        <Button
                            size="sm"
                            color="primary"
                            variant="flat"
                            isLoading={
                                downloadMutation.isPending &&
                                downloadMutation.variables === latestVersion
                            }
                            onPress={async () => {
                                const path = await downloadMutation.mutateAsync(latestVersion!)
                                activateMutation.mutate({ path })
                            }}
                            data-focus-visible="false"
                        >
                            Update &amp; use
                        </Button>
                    </div>
                )}
            </div>
        </BaseSection>
    )
}

function VersionRow({
    label,
    sublabel,
    warning,
    isActive,
    actionLabel,
    onActivate,
    isActivating,
    onDelete,
    isDeleting,
}: {
    label: string
    sublabel: string
    warning?: string | null
    isActive: boolean
    actionLabel: string
    onActivate: () => void
    isActivating?: boolean
    onDelete?: () => void
    isDeleting?: boolean
}) {
    return (
        <div className="flex items-center gap-3 px-4 py-3">
            <HardDriveIcon className="w-4 h-4 text-neutral-500 shrink-0" />
            <div className="flex flex-col flex-1 min-w-0">
                <span className="text-sm font-medium">{label}</span>
                <span className="text-xs truncate text-neutral-500">{sublabel}</span>
                {warning && <span className="text-xs text-warning">{warning}</span>}
            </div>
            {isActive ? (
                <Chip
                    size="sm"
                    color="success"
                    variant="flat"
                    startContent={<CheckIcon className="w-3 h-3" />}
                >
                    Active
                </Chip>
            ) : (
                <Button
                    size="sm"
                    variant="flat"
                    isLoading={isActivating}
                    onPress={onActivate}
                    data-focus-visible="false"
                >
                    {actionLabel}
                </Button>
            )}
            {onDelete ? (
                <Button
                    size="sm"
                    variant="light"
                    isIconOnly={true}
                    color="danger"
                    isLoading={isDeleting}
                    onPress={onDelete}
                    data-focus-visible="false"
                >
                    <Trash2Icon className="w-4 h-4" />
                </Button>
            ) : (
                <Tooltip content="Can't delete the active version" isDisabled={!isActive}>
                    <span className="inline-flex">
                        <Button size="sm" variant="light" isIconOnly={true} isDisabled={true}>
                            <Trash2Icon className="w-4 h-4" />
                        </Button>
                    </span>
                </Tooltip>
            )}
        </div>
    )
}

function CustomBinaryRow({
    active,
    systemPath,
    rclonePath,
    onActivated,
}: {
    active: { kind: string; version: string | null } | null | undefined
    systemPath: string | null
    rclonePath: string | undefined
    onActivated: () => void
}) {
    const isCustomActive = active?.kind === 'custom'
    const [value, setValue] = useState('')

    // Seed with the current custom path, else the detected system rclone.
    useEffect(() => {
        setValue(isCustomActive && rclonePath ? rclonePath : (systemPath ?? ''))
    }, [isCustomActive, rclonePath, systemPath])

    const customVersionQuery = useQuery({
        queryKey: ['rclone', 'custom-version', rclonePath],
        queryFn: () => validateRcloneBinary(rclonePath!),
        enabled: isCustomActive && !!rclonePath,
    })
    const customWarning = isCustomActive ? subFloorWarning(customVersionQuery.data) : null

    const useMutationState = useMutation({
        mutationFn: async (path: string) => {
            const version = await probeRcloneBinaryOrThrow(path)
            const ok = await activateRclonePath(path)
            return { version, ok }
        },
        onSuccess: () => onActivated(),
        onError: async (e) => {
            await reportError(e, { title: 'Invalid binary', fallback: String(e), capture: false })
        },
    })

    const browse = async () => {
        const selected = await open({
            multiple: false,
            directory: false,
            title: 'Select rclone binary',
        })
        if (typeof selected === 'string') {
            setValue(selected)
        }
    }

    return (
        <div className="flex flex-col gap-2">
            <div className="flex gap-2">
                <Input
                    value={value}
                    onValueChange={setValue}
                    size="sm"
                    placeholder="/path/to/rclone"
                    autoComplete="off"
                    endContent={
                        <button
                            type="button"
                            onClick={browse}
                            className="transition-colors text-neutral-400 hover:text-neutral-200"
                        >
                            <FolderOpenIcon className="w-4 h-4" />
                        </button>
                    }
                />
                <Button
                    size="sm"
                    variant="flat"
                    isDisabled={!value}
                    isLoading={useMutationState.isPending}
                    onPress={() => useMutationState.mutate(value)}
                    data-focus-visible="false"
                >
                    Use
                </Button>
            </div>
            {isCustomActive && (
                <span className="text-xs text-success">
                    Currently using a custom binary
                    {customVersionQuery.data ? ` (v${customVersionQuery.data})` : ''}.
                </span>
            )}
            {customWarning && <span className="text-xs text-warning">{customWarning}</span>}
        </div>
    )
}

function AutoUpdateRow() {
    const autoUpdate = usePersistedStore((state) => state.autoUpdateRclone)

    return (
        <div className="flex flex-col gap-2">
            <Checkbox
                isSelected={autoUpdate}
                onValueChange={(checked) =>
                    usePersistedStore.getState().setAutoUpdateRclone(checked)
                }
            >
                Automatically update rclone
            </Checkbox>
            <span className="text-xs text-neutral-500">
                Applies to versions installed by the app. When off, you'll be notified when a new
                version is available.
            </span>
        </div>
    )
}

function PathIntegrationRow({
    rclonePath,
    isSystemActive,
}: {
    rclonePath: string | undefined
    isSystemActive: boolean
}) {
    const queryClient = useQueryClient()
    const statusQuery = useQuery({
        queryKey: ['rclone', 'path-integration'],
        queryFn: getPathIntegration,
    })

    const toggleMutation = useMutation({
        mutationFn: async (enable: boolean) => {
            if (!rclonePath) throw new Error('No active rclone to link.')
            return await setPathIntegration(enable, rclonePath)
        },
        onSuccess: () =>
            queryClient.invalidateQueries({ queryKey: ['rclone', 'path-integration'] }),
        onError: async (e) => {
            await reportError(e, { title: 'PATH integration', fallback: String(e), capture: false })
            queryClient.invalidateQueries({ queryKey: ['rclone', 'path-integration'] })
        },
    })

    const status = statusQuery.data

    return (
        <div className="flex flex-col gap-2">
            <Checkbox
                isSelected={status?.enabled ?? false}
                isDisabled={
                    toggleMutation.isPending ||
                    statusQuery.isLoading ||
                    isSystemActive ||
                    !rclonePath
                }
                onValueChange={(checked) => toggleMutation.mutate(checked)}
            >
                Add rclone to PATH
            </Checkbox>
            {isSystemActive && (
                <span className="text-xs text-neutral-500">
                    The system rclone is already on your PATH.
                </span>
            )}
            {status?.warning && !isSystemActive && (
                <span className="text-xs text-warning">{status.warning}</span>
            )}
        </div>
    )
}
