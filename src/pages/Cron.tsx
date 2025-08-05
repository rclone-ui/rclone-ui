import { Card, CardBody, CardHeader, Tooltip } from '@heroui/react'
import { Button, Chip } from '@heroui/react'
import { ask } from '@tauri-apps/plugin-dialog'
import CronExpressionParser from 'cron-parser'
import cronstrue from 'cronstrue'
import { formatDistance } from 'date-fns'
import { AlertCircleIcon, Clock7Icon, PauseIcon, PlayIcon, Trash2Icon } from 'lucide-react'
import { useMemo, useState } from 'react'
import { buildReadablePath } from '../../lib/format'
import { usePersistedStore } from '../../lib/store'
import { openWindow } from '../../lib/window'
import type { ScheduledTask } from '../../types/task'

export default function Cron() {
    const scheduledTasks = usePersistedStore((state) => state.scheduledTasks)

    if (scheduledTasks.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-screen gap-10 pb-24">
                <h1 className="text-2xl font-bold text-center">No scheduled tasks found</h1>
                <div className="flex flex-row items-center justify-center gap-2">
                    <Button
                        color="primary"
                        size="lg"
                        onPress={() => {
                            openWindow({
                                name: 'Copy',
                                url: '/copy',
                            })
                        }}
                    >
                        Create copy task
                    </Button>
                    <Button
                        color="success"
                        size="lg"
                        onPress={() => {
                            openWindow({
                                name: 'Sync',
                                url: '/sync',
                            })
                        }}
                    >
                        Create sync task
                    </Button>
                </div>
            </div>
        )
    }

    return (
        <div className="flex flex-col h-screen overflow-scroll">
            {scheduledTasks.map((task) => (
                <TaskCard key={task.id} task={task} />
            ))}
        </div>
    )
}

function TaskCard({ task }: { task: ScheduledTask }) {
    const [isBusy, setIsBusy] = useState(false)

    const removeScheduledTask = usePersistedStore((state) => state.removeScheduledTask)
    const updateScheduledTask = usePersistedStore((state) => state.updateScheduledTask)

    const nextRun = useMemo(() => {
        const parsed = CronExpressionParser.parse(task.cron)
        if (!parsed.hasNext()) {
            return null
        }
        return parsed.next().toDate()
    }, [task.cron])

    const lastRunLabel = useMemo(() => {
        if (task.isRunning) {
            return 'Running now'
        }
        if (task.lastRun) {
            const distance = formatDistance(new Date(task.lastRun), new Date(), {
                addSuffix: true,
            })
            return distance.charAt(0).toUpperCase() + distance.slice(1)
        }
        return 'Never'
    }, [task.isRunning, task.lastRun])

    const nextRunLabel = useMemo(() => {
        if (!nextRun) {
            return 'Never'
        }

        const distance = formatDistance(nextRun, new Date(), {
            addSuffix: true,
        })

        return distance.charAt(0).toUpperCase() + distance.slice(1)
    }, [nextRun])

    return (
        <Card
            key={task.id}
            radius="none"
            shadow="none"
            style={{
                flexShrink: 0,
                border: '1px solid #e0e0e070',
                padding: '0.5rem',
            }}
        >
            <CardHeader>
                <div className="flex flex-row items-start justify-between w-full h-10 gap-4">
                    <div className="flex flex-row justify-start flex-1 gap-2">
                        <Chip
                            isCloseable={false}
                            size="lg"
                            variant="flat"
                            radius="sm"
                            color={
                                task.type === 'delete'
                                    ? 'danger'
                                    : task.type === 'copy'
                                      ? 'success'
                                      : 'primary'
                            }
                            className="h-10"
                        >
                            {task.type.toUpperCase()}
                        </Chip>
                        <div className="flex flex-col gap-0">
                            <div className="text-sm font-bold">
                                {buildReadablePath(task.args.srcFs, 'short')}
                            </div>
                            <div className="text-sm text-gray-500">
                                {buildReadablePath(task.args.dstFs)}
                            </div>
                        </div>
                    </div>
                    <div className="flex flex-row justify-center w-1/2 gap-2">
                        <div className="flex flex-col items-center justify-center gap-0.5">
                            <Tooltip
                                content={
                                    task.isRunning
                                        ? undefined
                                        : task.lastRun
                                          ? new Date(task.lastRun).toLocaleDateString('en-US', {
                                                month: 'short',
                                                day: 'numeric',
                                                weekday: 'short',
                                                hour: '2-digit',
                                                minute: '2-digit',
                                                second: '2-digit',
                                            })
                                          : "This task hasn't run yet"
                                }
                            >
                                <Chip
                                    isCloseable={false}
                                    size="lg"
                                    variant="flat"
                                    radius="sm"
                                    color={
                                        task.isRunning
                                            ? 'success'
                                            : task.error
                                              ? 'danger'
                                              : 'default'
                                    }
                                >
                                    {lastRunLabel}
                                </Chip>
                            </Tooltip>
                            <p className="text-xs text-gray-500">Last run</p>
                        </div>
                        <div className="flex flex-col items-center justify-center gap-0.5">
                            <Tooltip
                                content={nextRun?.toLocaleDateString('en-US', {
                                    month: 'short',
                                    day: 'numeric',
                                    weekday: 'short',
                                    hour: '2-digit',
                                    minute: '2-digit',
                                    second: '2-digit',
                                })}
                            >
                                <Chip
                                    isCloseable={false}
                                    size="lg"
                                    variant="flat"
                                    radius="sm"
                                    color={'primary'}
                                >
                                    {nextRunLabel}
                                </Chip>
                            </Tooltip>
                            <p className="text-xs text-gray-500">Next run</p>
                        </div>
                    </div>
                    <div className="flex flex-row justify-end gap-2">
                        <Button
                            isIconOnly={true}
                            color={task.isEnabled ? 'primary' : 'warning'}
                            isDisabled={isBusy}
                            size="sm"
                            onPress={async () => {
                                setIsBusy(true)
                                if (task.isEnabled) {
                                    const answer = await ask(
                                        'Are you sure you want to disable this task? This will not stop the current run.'
                                    )
                                    if (answer) {
                                        updateScheduledTask(task.id, { isEnabled: false })
                                    }
                                } else {
                                    updateScheduledTask(task.id, { isEnabled: true })
                                }
                                setIsBusy(false)
                            }}
                            data-focus-visible="false"
                        >
                            {task.isEnabled ? (
                                <PauseIcon className="w-4 h-4" />
                            ) : (
                                <PlayIcon className="w-4 h-4" />
                            )}
                        </Button>
                        <Button
                            isIconOnly={true}
                            color="danger"
                            isDisabled={isBusy}
                            size="sm"
                            onPress={async () => {
                                setIsBusy(true)
                                const answer = await ask(
                                    'Are you sure you want to remove this task?'
                                )
                                if (answer) {
                                    removeScheduledTask(task.id)
                                }
                                setIsBusy(false)
                            }}
                            data-focus-visible="false"
                        >
                            <Trash2Icon className="w-4 h-4" />
                        </Button>
                    </div>
                </div>
            </CardHeader>
            <CardBody>
                <div className="flex flex-row items-center justify-start gap-1 text-sm font-bold">
                    {task.error ? (
                        <>
                            <AlertCircleIcon className="w-4 h-4 text-danger-600" />
                            <p className="text-sm font-bold text-danger-600">{task.error}</p>
                        </>
                    ) : (
                        <>
                            <Clock7Icon className="w-4 h-4" />
                            <p className="text-sm font-bold truncate">
                                {cronstrue.toString(task.cron)}.
                            </p>
                        </>
                    )}
                </div>
            </CardBody>
        </Card>
    )
}
