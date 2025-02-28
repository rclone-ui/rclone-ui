import { Card, CardBody, CardFooter, CardHeader } from '@nextui-org/card'
import { Button, Chip, Divider, Progress, Spinner } from '@nextui-org/react'
import { listen } from '@tauri-apps/api/event'
import { ask } from '@tauri-apps/plugin-dialog'
import { Trash2Icon } from 'lucide-react'
import { useCallback, useEffect } from 'react'
import { useState } from 'react'
import { formatBytes } from '../../lib/format'
import { listJobs, stopJob } from '../../lib/rclone/api'

export default function Jobs() {
    const [isInitialLoad, setIsInitialLoad] = useState(true)
    const [jobs, setJobs] = useState<{
        active: any[]
        inactive: any[]
    }>({
        active: [],
        inactive: [],
    })

    const [busyIds, setBusyIds] = useState<number[]>([])

    const fetchJobs = useCallback(async () => {
        const jobs = await listJobs()

        console.log('jobs', JSON.stringify(jobs, null, 2))

        setJobs(jobs)
        setIsInitialLoad(false)
    }, [])

    const buildReadablePath = useCallback((path: string, type: 'short' | 'long' = 'long') => {
        if (!path) {
            return ''
        }

        const lastSegment = path.split('\\').slice(-1).join('').split('/').slice(-1).join('')

        if (type === 'short') {
            return lastSegment
        }

        return `${path.split(':')[0]}:/.../${lastSegment}`
    }, [])

    useEffect(() => {
        fetchJobs()

        const interval = setInterval(async () => {
            await fetchJobs()
        }, 2000)

        //! prevents jobs being refreshed after "X" was pressed on the window
        const unlisten = listen('tauri://close-requested', () => {
            clearInterval(interval)
        })

        return () => {
            clearInterval(interval)
            unlisten.then((unlisten) => unlisten())
        }
    }, [fetchJobs])

    if (isInitialLoad) {
        return (
            <div className="flex flex-col items-center justify-center h-screen">
                <Spinner size="lg" />
            </div>
        )
    }

    if (jobs.active.length === 0 && jobs.inactive.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-screen">
                <h1 className="text-2xl font-bold">No jobs found</h1>
            </div>
        )
    }

    return (
        <div className="flex flex-col h-screen overflow-scroll">
            {jobs.active.map((job) => (
                <Card
                    key={job.id}
                    radius="none"
                    style={{
                        flexShrink: 0,
                    }}
                >
                    <CardHeader>
                        <div className="flex flex-row items-center justify-between w-full">
                            <Chip isCloseable={false} size="sm" variant="bordered">
                                #{job.id}
                            </Chip>
                            <Button
                                isIconOnly={true}
                                color="danger"
                                isLoading={busyIds.includes(job.id)}
                                size="sm"
                                onPress={async () => {
                                    setBusyIds([...busyIds, job.id])
                                    const answer = await ask(
                                        'Are you sure you want to stop this job?'
                                    )
                                    if (answer) {
                                        await stopJob(job.id)
                                        await fetchJobs()
                                    }
                                    setBusyIds(busyIds.filter((id) => id !== job.id))
                                }}
                                data-focus-visible="false"
                            >
                                <Trash2Icon className="w-4 h-4" />
                            </Button>
                        </div>
                    </CardHeader>
                    <CardBody>
                        <div className="flex flex-col w-full gap-0">
                            <div className="font-bold">{buildReadablePath(job.srcFs, 'short')}</div>
                            <div className="text-sm text-gray-500">
                                {buildReadablePath(job.dstFs)}
                            </div>
                        </div>
                    </CardBody>
                    <CardFooter>
                        <div className="flex flex-col items-center justify-center w-full gap-2">
                            <div className="flex flex-row items-center justify-between w-full">
                                <div className="text-sm text-gray-500">
                                    {formatBytes(job.bytes)}/{formatBytes(job.totalBytes)} (
                                    {job.progress}%)
                                </div>
                                <div className="text-sm text-gray-500">
                                    {formatBytes(job.speed)}/s
                                </div>
                            </div>
                            <Progress value={job.progress} isStriped={true} />
                        </div>
                    </CardFooter>
                </Card>
            ))}

            {jobs.inactive.length > 0 && jobs.active.length > 0 && <Divider className="h-1" />}

            {jobs.inactive.map((job) => (
                <Card
                    key={job.id}
                    radius="none"
                    isDisabled={true}
                    style={{
                        flexShrink: 0,
                    }}
                >
                    <CardHeader>
                        <Chip
                            isCloseable={false}
                            size="sm"
                            variant="bordered"
                            color={job.progress === 100 ? 'success' : 'warning'}
                        >
                            #{job.id}
                        </Chip>
                    </CardHeader>
                    <CardBody>
                        <div className="flex flex-col w-full gap-0">
                            <div className="font-bold">{buildReadablePath(job.srcFs, 'short')}</div>
                            <div className="text-sm text-gray-500">
                                {buildReadablePath(job.dstFs)}
                            </div>
                        </div>
                    </CardBody>
                    <CardFooter>
                        {job.progress === 100
                            ? 'Finished successfully'
                            : `Stopped at ${job.progress}%`}
                    </CardFooter>
                </Card>
            ))}
        </div>
    )
}
