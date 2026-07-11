import { Button, Checkbox, Chip, Input, Progress, Spinner, Tooltip } from '@heroui/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { message, open } from '@tauri-apps/plugin-dialog'
import {
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
    type DownloadedVersion,
    activateRclonePath,
    deleteVersion,
    downloadVersion,
    fetchAvailableVersions,
    getPathIntegration,
    listDownloadedVersions,
    setPathIntegration,
} from '../../../lib/rclone/versions'
import { useHostStore } from '../../../store/host'
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

    const scheduledTasks = useHostStore((state) => state.scheduledTasks)

    const handleDeleteVersion = async (v: DownloadedVersion) => {
        // Schedules can pin a specific downloaded version by absolute path — deleting it would
        // make every later run fail with "binary not found". Being the active global binary is
        // not the only way a version can be in use. (Schedules are local-host-only, so the host
        // store is authoritative here.)
        const pinnedBy = scheduledTasks.filter((task) => task.binaryPath === v.path)
        if (pinnedBy.length > 0) {
            const names = pinnedBy.map((task) => task.name || task.operation).join(', ')
            await message(
                `This version is used by ${pinnedBy.length} scheduled task(s): ${names}. Change their rclone binary in the schedule settings first.`,
                { title: 'Version in use', kind: 'warning' }
            )
            return
        }
        deleteMutation.mutate(v.version)
    }

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
            {/* ---- Custom binary ---- */}
            <div className="flex flex-row justify-center w-full gap-8 px-8">
                <div className="flex flex-col items-end flex-1 gap-2">
                    <h3 className="font-medium">Custom binary</h3>
                    <p className="text-xs text-neutral-500 text-end">
                        Point to an rclone binary on your machine.
                    </p>
                </div>
                <div className="flex flex-col w-3/5 gap-3">
                    <CustomBinaryRow
                        active={active}
                        systemPath={systemQuery.data ?? null}
                        rclonePath={rclonePath}
                        onActivated={invalidateActive}
                    />
                </div>
            </div>

            {/* ---- PATH integration ---- */}
            <div className="flex flex-row justify-center w-full gap-8 px-8">
                <div className="flex flex-col items-end flex-1 gap-2">
                    <h3 className="font-medium">Path</h3>
                </div>
                <div className="flex flex-col w-3/5 gap-3">
                    <PathIntegrationRow
                        rclonePath={rclonePath}
                        isSystemActive={active?.kind === 'system'}
                    />
                </div>
            </div>

            {/* ---- Auto update ---- */}
            <div className="flex flex-row justify-center w-full gap-8 px-8">
                <div className="flex flex-col items-end flex-1 gap-2">
                    <h3 className="font-medium">Updates</h3>
                </div>
                <div className="flex flex-col w-3/5 gap-3">
                    <AutoUpdateRow />
                </div>
            </div>

            {/* ---- Versions ---- */}
            <div className="flex flex-row justify-center w-full gap-8 px-8 pb-10">
                <div className="flex flex-col items-end flex-1 gap-2">
                    <h3 className="font-medium">Versions</h3>
                </div>
                <div className="flex flex-col w-3/5 gap-3">
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
                            const isActive =
                                active?.kind === 'managed' && active.version === v.version
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
                                    onDelete={isActive ? undefined : () => handleDeleteVersion(v)}
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
                                downloadMutation.isPending &&
                                downloadMutation.variables === r.version
                            return (
                                <div key={r.version} className="flex items-center gap-3 px-4 py-3">
                                    <div className="flex flex-col flex-1 min-w-0">
                                        <span className="text-sm text-neutral-500">
                                            v{r.version}
                                        </span>
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
                        <div className="flex items-center gap-2">
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
                <Chip size="sm" color="success" variant="flat">
                    ACTIVE
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
            // Picking a binary implies using it — activate immediately, no separate button.
            useMutationState.mutate(selected)
        }
    }

    return (
        <div className="flex flex-col gap-2">
            <Input
                value={value}
                onValueChange={setValue}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' && value) {
                        useMutationState.mutate(value)
                    }
                }}
                size="lg"
                placeholder="/path/to/rclone"
                autoComplete="off"
                endContent={
                    useMutationState.isPending ? (
                        <Spinner size="sm" />
                    ) : (
                        <button
                            type="button"
                            onClick={browse}
                            className="transition-colors text-neutral-400 hover:text-neutral-200"
                        >
                            <FolderOpenIcon className="w-5 h-5" />
                        </button>
                    )
                }
            />
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
            <span className="text-xs text-neutral-500">
                Lets you call rclone from your terminal.
            </span>
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
