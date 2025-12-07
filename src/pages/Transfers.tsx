import { Card, CardBody, Progress, Tab, Tabs, Tooltip, useDisclosure } from '@heroui/react'
import { Button, Chip, Spinner } from '@heroui/react'
import { useQuery } from '@tanstack/react-query'
import { message } from '@tauri-apps/plugin-dialog'
import { ChevronRightIcon, RefreshCcwIcon } from 'lucide-react'
import { startTransition, useCallback, useMemo, useState } from 'react'
import { buildReadablePathMultiple, formatBytes } from '../../lib/format'
import { listTransfers } from '../../lib/rclone/api'
import { usePersistedStore } from '../../store/persisted'
import type { JobItem } from '../../types/jobs'
import CommandsDropdown from '../components/CommandsDropdown'
import JobDetailsDrawer from '../components/JobDetailsDrawer'

export default function Transfers() {
    const { isOpen, onOpen, onClose } = useDisclosure({
        onClose: () => {
            setTimeout(() => {
                startTransition(() => {
                    setSelectedJob(null)
                })
                if (!acknowledgements.includes('escToCloseJobDetails')) {
                    message('You can close the job details panel by pressing the ESC key.', {
                        title: 'Did you know?',
                        buttons: {
                            ok: 'Good to know',
                        },
                    }).then(() => {
                        usePersistedStore.setState((prev) => ({
                            acknowledgements: [...prev.acknowledgements, 'escToCloseJobDetails'],
                        }))
                    })
                }
            }, 500)
        },
    })
    const [selectedJob, setSelectedJob] = useState<JobItem | null>(null)
    const acknowledgements = usePersistedStore((state) => state.acknowledgements)

    const handleSelectJob = useCallback(
        (job: JobItem) => {
            setSelectedJob(job)
            onOpen()
        },
        [onOpen]
    )

    const transfersQuery = useQuery({
        queryKey: ['transfers', 'list', 'all'],
        queryFn: async () => await listTransfers(),
        // refetchInterval: 2000,
        // refetchOnWindowFocus: true,
        // refetchOnMount: true,
        // refetchOnReconnect: true,
        // refetchIntervalInBackground: true,
    })

    const transfers = useMemo(
        () => transfersQuery.data ?? { active: [], inactive: [] },
        [transfersQuery.data]
    )

    console.log('transfers', JSON.stringify(transfers, null, 2))

    if (transfersQuery.isLoading) {
        return (
            <div className="flex flex-col items-center justify-center h-screen">
                <Spinner size="lg" />
            </div>
        )
    }

    if (!transfers || (transfers.active.length === 0 && transfers.inactive.length === 0)) {
        return (
            <div className="flex flex-col items-center justify-center w-full h-screen gap-8">
                <h1 className="text-2xl font-bold">No transfers found</h1>
                <CommandsDropdown title="Run a command" />
            </div>
        )
    }

    return (
        <>
            <Tabs
                fullWidth={true}
                size="lg"
                classNames={{
                    'tabList': 'pt-8 fixed top-0 left-0 right-0 z-50 !bg-content2',
                    panel: 'min-h-[calc(100vh-1.5rem)] p-0 pt-12',
                }}
                variant="underlined"
            >
                <Tab key="active" title="ACTIVE">
                    {transfers.active.map((job) => (
                        <JobCard key={job.id} job={job} onSelect={handleSelectJob} />
                    ))}
                </Tab>
                <Tab key="inactive" title="INACTIVE">
                    {transfers.inactive.map((job) => (
                        <JobCard key={job.id} job={job} onSelect={handleSelectJob} />
                    ))}
                </Tab>
            </Tabs>

            <Button
                size="lg"
                isIconOnly={true}
                radius="full"
                color="primary"
                className="absolute bottom-5 right-6"
                onPress={() => {
                    setTimeout(async () => {
                        transfersQuery.refetch()
                    }, 100)
                }}
                startContent={
                    <RefreshCcwIcon
                        size={28}
                        className={transfersQuery.isRefetching ? 'animate-spin' : ''}
                    />
                }
            />

            {selectedJob && (
                <JobDetailsDrawer isOpen={isOpen} onClose={onClose} selectedJob={selectedJob} />
            )}
        </>
    )
}

function JobCard({ job, onSelect }: { job: JobItem; onSelect: (job: JobItem) => void }) {
    return (
        <Card
            key={job.id}
            radius="none"
            shadow="none"
            style={{
                flexShrink: 0,
            }}
            className="w-full border-b border-divider"
            onPress={() => onSelect(job)}
            isPressable={true}
            data-focus-visible="false"
        >
            <CardBody className="p-0 py-1">
                <div className="flex flex-row items-center w-full">
                    <Tooltip content="Job ID" placement="right" color="foreground">
                        <Chip
                            isCloseable={false}
                            size="lg"
                            variant="flat"
                            color={job.type === 'active' ? 'success' : 'primary'}
                            className="mx-2"
                        >
                            #{job.id}
                        </Chip>
                    </Tooltip>

                    <div className="flex flex-row items-center flex-1">
                        {job.hasError && <p className="text-danger">ERROR: Tap to view details.</p>}

                        {!job.hasError && (
                            <>
                                <p className="flex-1 font-bold text-left line-clamp-1 text-large min-w-80">
                                    {buildReadablePathMultiple(job.sources, 'short', true)}
                                </p>

                                {job.type === 'inactive' ? (
                                    job.progress < 100 ? (
                                        <p className="text-gray-500">Stopped at {job.progress}%</p>
                                    ) : null
                                ) : null}

                                {job.type === 'active' ? (
                                    <Tooltip
                                        content={`${formatBytes(job.bytes)} out of ${formatBytes(job.totalBytes)}`}
                                    >
                                        <Progress value={job.progress} isStriped={true} />
                                    </Tooltip>
                                ) : null}
                            </>
                        )}
                    </div>

                    <Button
                        isIconOnly={true}
                        variant="light"
                        onPress={() => onSelect(job)}
                        data-focus-visible="false"
                    >
                        <ChevronRightIcon className="w-5" />
                    </Button>
                </div>
            </CardBody>
        </Card>
    )
}
