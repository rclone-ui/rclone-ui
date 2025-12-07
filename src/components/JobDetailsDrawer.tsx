import {
    Alert,
    Button,
    Chip,
    Drawer,
    DrawerBody,
    DrawerContent,
    DrawerHeader,
    Progress,
    Spinner,
    Tooltip,
    cn,
} from '@heroui/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { message } from '@tauri-apps/plugin-dialog'
import { platform } from '@tauri-apps/plugin-os'
import { SquareIcon } from 'lucide-react'
import { useMemo } from 'react'
import { formatBytes } from '../../lib/format'
import notify from '../../lib/notify'
import rclone from '../../lib/rclone/client'
import type { JobItem } from '../../types/jobs'

export default function JobDetailsDrawer({
    isOpen,
    onClose,
    selectedJob,
}: {
    isOpen: boolean
    onClose: () => void
    selectedJob: JobItem
}) {
    const queryClient = useQueryClient()

    const jobStatusQuery = useQuery({
        queryKey: ['jobs', 'status', selectedJob.id],
        queryFn: async () =>
            rclone('/job/status', {
                params: {
                    query: {
                        jobid: selectedJob.id,
                    },
                },
            }),
        enabled: !!selectedJob.id,
        refetchInterval: 1000,
    })

    const mainError = useMemo(() => jobStatusQuery.data?.error || null, [jobStatusQuery.data])

    const otherErrors = useMemo(
        () =>
            !!jobStatusQuery.data?.output &&
            typeof jobStatusQuery.data?.output === 'object' &&
            'results' in jobStatusQuery.data.output &&
            Array.isArray(jobStatusQuery.data.output.results)
                ? (jobStatusQuery.data.output.results
                      .map((item: any) => {
                          if (!item.error) return null
                          return { error: item.error, input: item.input }
                      })
                      .filter(Boolean) as { error: string; input: object }[])
                : [],
        [jobStatusQuery.data]
    )

    const transferredQuery = useQuery({
        queryKey: ['jobs', 'transferring', selectedJob.id],
        queryFn: async () =>
            rclone('/core/transferred', {
                params: {
                    query: {
                        group: `job/${selectedJob.id}`,
                    },
                },
            }),
        enabled: !!selectedJob.id,
        refetchInterval: 1000,
    })

    const jobGroupStatsQuery = useQuery({
        queryKey: ['jobs', 'group', 'stats', selectedJob.id],
        queryFn: async () =>
            rclone('/core/stats', {
                params: {
                    query: {
                        group: `job/${selectedJob.id}`,
                    },
                },
            }),
        enabled: !!selectedJob.id,
        refetchInterval: 1000,
    })

    const stopJobMutation = useMutation({
        mutationFn: async (jobId: number) => {
            await rclone('/job/stopgroup', {
                params: {
                    query: {
                        group: `job/${jobId}`,
                    },
                },
            })
        },
        onSuccess: async () => {
            queryClient.refetchQueries({ queryKey: ['transfers', 'list', 'all'] })
            await notify({
                title: 'Job stopped',
                body: 'It will still appear as active, with declining transfer speeds, until rclone cleans it up',
            })
        },
        onError: async (error) => {
            console.error('Failed to stop job:', error)
            await message(error instanceof Error ? error.message : 'Unknown error occurred', {
                title: 'Could not stop job',
                kind: 'error',
            })
        },
    })

    const transferred = useMemo(
        () => transferredQuery.data?.transferred || [],
        [transferredQuery.data]
    )
    const transferring = useMemo(
        () => jobGroupStatsQuery.data?.transferring || [],
        [jobGroupStatsQuery.data]
    )

    return (
        <Drawer isOpen={isOpen} placement="bottom" size="2xl" onClose={onClose}>
            <DrawerContent
                className={cn(
                    'bg-content1/80 backdrop-blur-md dark:bg-content1/90',
                    platform() === 'macos' ? 'pt-6' : undefined
                )}
            >
                <DrawerHeader className="flex flex-row items-center gap-2">
                    Job Details #{selectedJob.id}{' '}
                    {selectedJob.type === 'inactive' ? (
                        <Chip color="primary" size="sm">
                            FINISHED
                        </Chip>
                    ) : (
                        <Tooltip content="Stop job" placement="right" color="foreground">
                            <Button
                                isIconOnly={true}
                                color="danger"
                                size="sm"
                                variant="light"
                                onPress={() => {
                                    stopJobMutation.mutate(selectedJob.id)
                                }}
                            >
                                <SquareIcon fill="currentColor" className="w-5 rounded-small" />
                            </Button>
                        </Tooltip>
                    )}
                </DrawerHeader>
                <DrawerBody className="pb-10">
                    {mainError || otherErrors.length > 0 ? (
                        <Alert color="danger" variant="faded" hideIcon={true}>
                            {mainError}
                            {otherErrors.length > 0 ? (
                                <pre className="break-all whitespace-pre-wrap">
                                    {JSON.stringify(otherErrors, null, 2)}
                                </pre>
                            ) : null}
                        </Alert>
                    ) : null}

                    <div className="flex flex-col gap-2">
                        <div className="flex flex-row items-center justify-between gap-2">
                            <h3 className="text-lg font-medium">Transferring</h3>
                            {jobGroupStatsQuery.isLoading ? (
                                <Spinner />
                            ) : (
                                `${transferring.length} items`
                            )}
                        </div>

                        {!jobGroupStatsQuery.isLoading && transferring.length === 0 ? (
                            <p>No items transferring</p>
                        ) : null}

                        {transferring.map((item, itemIndex) => {
                            // biome-ignore lint/style/useExplicitLengthCheck: <not relevant>
                            const size = item.size ? formatBytes(item.size) : '0 B'
                            const bytes = item.bytes ? formatBytes(item.bytes) : '0 B'
                            const speed = item.speed ? formatBytes(item.speed) : '0 B/s'
                            return (
                                <div
                                    key={item.name || itemIndex}
                                    className="flex flex-row items-center justify-between gap-5 pb-2 border-b border-divider"
                                >
                                    <p className="flex-1 line-clamp-1 min-w-80">{item.name}</p>
                                    <p className="w-24 tabular-nums shrink-0 whitespace-nowrap">
                                        {speed}/s
                                    </p>
                                    <Tooltip
                                        content={`Transferred ${bytes} of ${size}`}
                                        color="foreground"
                                        placement="bottom"
                                        size="lg"
                                    >
                                        <Progress
                                            value={item.percentage}
                                            classNames={{
                                                base: 'overflow-hidden rounded-full',
                                            }}
                                        />
                                    </Tooltip>
                                </div>
                            )
                        })}
                    </div>

                    <div className="flex flex-col gap-8 pt-6 ">
                        <div className="flex flex-col gap-2">
                            <div className="flex flex-row items-center justify-between gap-2 pb-2">
                                <h3 className="text-lg font-medium">Transferred</h3>
                                {transferredQuery.isLoading ? (
                                    <Spinner />
                                ) : (
                                    `${transferred.length} items`
                                )}
                            </div>

                            {!transferredQuery.isLoading && transferred.length === 0 ? (
                                <p>No items transferred</p>
                            ) : null}

                            {transferred.map((item, itemIndex) => {
                                return (
                                    <div
                                        key={item.name || itemIndex}
                                        className="flex flex-row items-center justify-between gap-2 pb-2 border-b border-divider"
                                    >
                                        <p className="flex-1 line-clamp-1">{item.name}</p>
                                        {item.error ? (
                                            <p>{item.error}</p>
                                        ) : item.completed_at ? (
                                            <p>{new Date(item.completed_at).toLocaleString()}</p>
                                        ) : null}
                                        {/* <p>{item.what}</p> */}
                                    </div>
                                )
                            })}
                        </div>
                    </div>
                </DrawerBody>
            </DrawerContent>
        </Drawer>
    )
}
