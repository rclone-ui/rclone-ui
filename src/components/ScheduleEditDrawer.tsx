import {
    Alert,
    Button,
    Chip,
    Divider,
    Drawer,
    DrawerBody,
    DrawerContent,
    DrawerFooter,
    DrawerHeader,
    ScrollShadow,
    cn,
} from '@heroui/react'
import { platform } from '@tauri-apps/plugin-os'
import CronExpressionParser from 'cron-parser'
import { format } from 'date-fns'
import { CalendarClockIcon } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { buildReadablePath } from '../../lib/format'
import { useHostStore } from '../../store/host'
import type { ScheduledTask } from '../../types/schedules'
import CronEditor from './CronEditor'

export default function ScheduleEditDrawer({
    isOpen,
    onClose,
    selectedTask,
}: {
    isOpen: boolean
    onClose: () => void
    selectedTask: ScheduledTask
}) {
    const updateScheduledTask = useHostStore((state) => state.updateScheduledTask)

    const [cronExpression, setCronExpression] = useState(selectedTask.cron)

    useEffect(() => {
        if (isOpen) {
            setCronExpression(selectedTask.cron)
        }
    }, [isOpen, selectedTask.cron])

    const source = useMemo(
        () =>
            'source' in selectedTask.args ? selectedTask.args.source : selectedTask.args.sources[0],
        [selectedTask.args]
    )

    const destination = useMemo(
        () => ('destination' in selectedTask.args ? selectedTask.args.destination : null),
        [selectedTask.args]
    )

    const upcomingRuns = useMemo(() => {
        try {
            const parsed = CronExpressionParser.parse(cronExpression)
            const runs: Date[] = []
            for (let i = 0; i < 5; i++) {
                if (parsed.hasNext()) {
                    runs.push(parsed.next().toDate())
                }
            }
            return runs
        } catch {
            return []
        }
    }, [cronExpression])

    const hasChanges = useMemo(
        () => cronExpression !== selectedTask.cron,
        [cronExpression, selectedTask.cron]
    )

    const handleSave = useCallback(() => {
        updateScheduledTask(selectedTask.id, { cron: cronExpression })
        onClose()
    }, [selectedTask.id, cronExpression, updateScheduledTask, onClose])

    return (
        <Drawer
            isOpen={isOpen}
            placement="bottom"
            size="full"
            onClose={onClose}
            hideCloseButton={true}
        >
            <DrawerContent
                className={cn(
                    'bg-content1/80 backdrop-blur-md dark:bg-content1/90',
                    platform() === 'macos' && 'pt-5'
                )}
            >
                {(close) => (
                    <>
                        <DrawerHeader className="px-0 pb-0">
                            <div className="flex flex-col w-full gap-2">
                                <div className="flex flex-row items-center w-full gap-4 pl-6 pr-4 pb-0.5">
                                    <p className="shrink-0">Edit Schedule</p>
                                    <Chip
                                        size="sm"
                                        variant="flat"
                                        color={
                                            selectedTask.operation === 'delete'
                                                ? 'danger'
                                                : selectedTask.operation === 'copy'
                                                  ? 'success'
                                                  : 'primary'
                                        }
                                    >
                                        {selectedTask.operation.toUpperCase()}
                                    </Chip>
                                    <p className="text-small text-foreground-500 line-clamp-1">
                                        {selectedTask.name || 'Untitled Schedule'}
                                    </p>
                                </div>
                                <Divider />
                            </div>
                        </DrawerHeader>
                        <DrawerBody className="py-0">
                            <ScrollShadow size={30} visibility="top">
                                <div className="flex flex-col gap-6 pt-6 pb-10">
                                    {selectedTask.lastRunError && (
                                        <Alert
                                            color="danger"
                                            variant="faded"
                                            title="Last Run Error"
                                        >
                                            <pre className="text-sm break-all whitespace-pre-wrap">
                                                {selectedTask.lastRunError}
                                            </pre>
                                        </Alert>
                                    )}

                                    <div className="flex flex-col gap-3">
                                        <h3 className="text-lg font-medium">Details</h3>
                                        <div className="grid grid-cols-2 gap-4">
                                            <div className="flex flex-col gap-1">
                                                <p className="text-sm text-foreground-500">
                                                    Source
                                                </p>
                                                <p className="font-mono text-sm">
                                                    {buildReadablePath(source, 'long')}
                                                </p>
                                            </div>
                                            {destination && (
                                                <div className="flex flex-col gap-1">
                                                    <p className="text-sm text-foreground-500">
                                                        Destination
                                                    </p>
                                                    <p className="font-mono text-sm">
                                                        {buildReadablePath(destination, 'long')}
                                                    </p>
                                                </div>
                                            )}
                                            <div className="flex flex-col gap-1">
                                                <p className="text-sm text-foreground-500">
                                                    Last Run
                                                </p>
                                                <p className="text-sm">
                                                    {selectedTask.lastRun
                                                        ? format(
                                                              new Date(selectedTask.lastRun),
                                                              'PPpp'
                                                          )
                                                        : 'Never'}
                                                </p>
                                            </div>
                                            <div className="flex flex-col gap-1">
                                                <p className="text-sm text-foreground-500">
                                                    Status
                                                </p>
                                                <Chip
                                                    size="sm"
                                                    variant="flat"
                                                    color={
                                                        selectedTask.isRunning
                                                            ? 'success'
                                                            : selectedTask.isEnabled
                                                              ? 'primary'
                                                              : 'warning'
                                                    }
                                                >
                                                    {selectedTask.isRunning
                                                        ? 'Running'
                                                        : selectedTask.isEnabled
                                                          ? 'Enabled'
                                                          : 'Paused'}
                                                </Chip>
                                            </div>
                                        </div>
                                    </div>

                                    <Divider />

                                    <div className="flex flex-col gap-3">
                                        <h3 className="flex items-center gap-2 text-lg font-medium">
                                            <CalendarClockIcon className="w-5 h-5" />
                                            Upcoming Runs
                                        </h3>
                                        {upcomingRuns.length > 0 ? (
                                            <div className="flex flex-col gap-2">
                                                {upcomingRuns.map((run, index) => (
                                                    <div
                                                        key={run.toISOString()}
                                                        className="flex items-center gap-3 text-sm"
                                                    >
                                                        <Chip
                                                            size="sm"
                                                            variant="flat"
                                                            color="default"
                                                        >
                                                            {index + 1}
                                                        </Chip>
                                                        <span>
                                                            {format(run, 'EEEE, MMMM d, yyyy')}
                                                        </span>
                                                        <span className="text-foreground-500">
                                                            at
                                                        </span>
                                                        <span className="font-mono">
                                                            {format(run, 'HH:mm')}
                                                        </span>
                                                    </div>
                                                ))}
                                            </div>
                                        ) : (
                                            <p className="text-sm text-foreground-500">
                                                No upcoming runs scheduled (invalid cron expression)
                                            </p>
                                        )}
                                    </div>

                                    <Divider />

                                    <div className="flex flex-col gap-3">
                                        <h3 className="text-lg font-medium">Schedule</h3>
                                        <CronEditor
                                            expression={cronExpression}
                                            onChange={(expr) =>
                                                setCronExpression(expr || '* * * * *')
                                            }
                                        />
                                    </div>
                                </div>
                            </ScrollShadow>
                        </DrawerBody>
                        <DrawerFooter>
                            <Button
                                color="danger"
                                variant="light"
                                onPress={() => close()}
                                data-focus-visible="false"
                            >
                                CANCEL
                            </Button>
                            <Button
                                color="primary"
                                isDisabled={!hasChanges}
                                onPress={handleSave}
                                data-focus-visible="false"
                            >
                                SAVE CHANGES
                            </Button>
                        </DrawerFooter>
                    </>
                )}
            </DrawerContent>
        </Drawer>
    )
}
