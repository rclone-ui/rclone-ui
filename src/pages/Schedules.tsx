import { Card, CardBody, CardHeader, Input, Tooltip } from '@heroui/react'
import { Button, Chip } from '@heroui/react'
import { ask } from '@tauri-apps/plugin-dialog'
import { platform } from '@tauri-apps/plugin-os'
import CronExpressionParser from 'cron-parser'
import cronstrue from 'cronstrue'
import { formatDistance } from 'date-fns'
import { AlertCircleIcon, Clock7Icon, PauseIcon, PlayIcon, Trash2Icon } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { buildReadablePath } from '../../lib/format'
import { useHostStore } from '../../store/host'
import type { ScheduledTask } from '../../types/schedules'
import CommandsDropdown from '../components/CommandsDropdown'

export default function Schedules() {
    const scheduledTasks = useHostStore((state) => state.scheduledTasks)

    if (scheduledTasks.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-screen gap-8">
                <h1 className="text-2xl font-bold text-center">
                    You can schedule tasks to run later, when the UI is in the background.
                </h1>
                <CommandsDropdown title="New scheduled task" />
            </div>
        )
    }

    return (
        <div className="flex flex-col h-screen overflow-scroll">
            {platform() === 'macos' && (
                <div className="w-full h-10 border-b bg-content1 border-divider" />
            )}
            {scheduledTasks.map((task) => (
                <TaskCard key={task.id} task={task} />
            ))}
        </div>
    )
}

function TaskCard({ task }: { task: ScheduledTask }) {
    const [isBusy, setIsBusy] = useState(false)
    const [isEditingName, setIsEditingName] = useState(false)
    const [editingName, setEditingName] = useState(task.name)

    const removeScheduledTask = useHostStore((state) => state.removeScheduledTask)
    const updateScheduledTask = useHostStore((state) => state.updateScheduledTask)

    useEffect(() => {
        if (!isEditingName) {
            setEditingName(task.name)
        }
    }, [task.name, isEditingName])

    const parsed = useMemo(() => CronExpressionParser.parse(task.cron), [task.cron])
    const nextRun = useMemo(() => (parsed.hasNext() ? parsed.next().toDate() : null), [parsed])

    const source = useMemo(
        () => ('source' in task.args ? task.args.source : task.args.sources[0]),
        [task.args]
    )

    const nextRunLabel = useMemo(() => {
        if (nextRun) {
            const distance = formatDistance(nextRun, new Date(), { addSuffix: true })
            return distance.charAt(0).toUpperCase() + distance.slice(1)
        }
        return 'Never'
    }, [nextRun])

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

    return (
        <Card
            key={task.id}
            radius="none"
            shadow="none"
            style={{
                flexShrink: 0,
                // border: '1px solid #e0e0e070',
                // borderBottom: '1px solid #e0e0e070',
                // padding: '0.5rem',
            }}
            className="p-2 border-b border-divider"
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
                                task.operation === 'delete'
                                    ? 'danger'
                                    : task.operation === 'copy'
                                      ? 'success'
                                      : 'primary'
                            }
                            className="h-10"
                        >
                            {task.operation.toUpperCase()}
                        </Chip>
                        <div className="flex flex-col gap-0">
                            <Tooltip
                                content="Tap to edit the name"
                                placement="bottom"
                                size="lg"
                                color="foreground"
                            >
                                <Input
                                    size="sm"
                                    value={
                                        isEditingName
                                            ? editingName
                                            : task.name || 'Untitled Schedule'
                                    }
                                    variant="bordered"
                                    isReadOnly={!isEditingName}
                                    classNames={{
                                        'input': 'font-bold',
                                        'inputWrapper': 'p-0 border-0 min-h-0 h-full w-64',
                                    }}
                                    autoCapitalize="off"
                                    autoComplete="off"
                                    autoCorrect="off"
                                    spellCheck="false"
                                    onClick={(e) => {
                                        setEditingName(task.name || 'Untitled Schedule')
                                        setIsEditingName(true)
                                        e.currentTarget.select()
                                    }}
                                    onBlur={() => {
                                        updateScheduledTask(task.id, { name: editingName })
                                        setIsEditingName(false)
                                    }}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                            updateScheduledTask(task.id, { name: editingName })
                                            setIsEditingName(false)
                                            e.currentTarget.blur()
                                        } else if (e.key === 'Escape') {
                                            setEditingName(task.name)
                                            setIsEditingName(false)
                                            e.currentTarget.blur()
                                        }
                                    }}
                                    onValueChange={(newName) => setEditingName(newName)}
                                />
                            </Tooltip>
                            <div className="text-sm text-gray-500">
                                {buildReadablePath(source, 'short')} {'→'}{' '}
                                {'destination' in task.args
                                    ? buildReadablePath(task.args.destination, 'short')
                                    : 'N/A'}
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
                                placement="bottom"
                                size="lg"
                                color="foreground"
                                isDisabled={task.isRunning}
                            >
                                <Chip
                                    isCloseable={false}
                                    size="lg"
                                    variant="flat"
                                    radius="sm"
                                    color={
                                        task.isRunning
                                            ? 'success'
                                            : task.lastRunError
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
                                placement="bottom"
                                size="lg"
                                color="foreground"
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
                    {task.lastRunError ? (
                        <>
                            <AlertCircleIcon className="w-4 h-4 text-danger-600" />
                            <p className="text-sm font-bold text-danger-600">{task.lastRunError}</p>
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
