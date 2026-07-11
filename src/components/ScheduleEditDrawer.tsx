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
    Input,
    ScrollShadow,
    Switch,
    Tab,
    Tabs,
    cn,
} from '@heroui/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { platform } from '@tauri-apps/plugin-os'
import { format, formatDistance } from 'date-fns'
import { CalendarClockIcon } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { formatErrorMessage } from '../../lib/errors'
import { buildReadablePath } from '../../lib/format'
import { useNow } from '../../lib/hooks'
import {
    DEFAULT_MAX_RUN_HOURS,
    MAX_RUN_HOURS_LIMIT,
    schedulerReadHistory,
    schedulerReadLog,
    updateScheduledTask as schedulerUpdateTask,
    schedulerValidateCron,
} from '../../lib/scheduler'
import { useHostStore } from '../../store/host'
import type { ScheduledTask } from '../../types/schedules'
import BinarySelect from './BinarySelect'
import ConfigSelect, { configPasswordMissing as isConfigPasswordMissing } from './ConfigSelect'
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
    const queryClient = useQueryClient()
    const configFiles = useHostStore((state) => state.configFiles)

    const [cronExpression, setCronExpression] = useState(selectedTask.cron)
    const [configId, setConfigId] = useState(selectedTask.configId)
    const [binaryPath, setBinaryPath] = useState(selectedTask.binaryPath)
    const [isEnabled, setIsEnabled] = useState(selectedTask.isEnabled)
    const [verboseLogging, setVerboseLogging] = useState(selectedTask.verboseLogging ?? false)
    const [runMode, setRunMode] = useState<'system' | 'user'>(selectedTask.runMode ?? 'user')
    const [maxRunHours, setMaxRunHours] = useState(
        String(selectedTask.maxRunHours ?? DEFAULT_MAX_RUN_HOURS)
    )
    const [logView, setLogView] = useState<'runner' | 'daemon'>('runner')
    const [saveError, setSaveError] = useState<string | null>(null)

    useEffect(() => {
        if (isOpen) {
            setCronExpression(selectedTask.cron)
            setConfigId(selectedTask.configId)
            setBinaryPath(selectedTask.binaryPath)
            setIsEnabled(selectedTask.isEnabled)
            setVerboseLogging(selectedTask.verboseLogging ?? false)
            setRunMode(selectedTask.runMode ?? 'user')
            setMaxRunHours(String(selectedTask.maxRunHours ?? DEFAULT_MAX_RUN_HOURS))
            setSaveError(null)
        }
    }, [isOpen, selectedTask])

    const maxRunHoursNumber = Number(maxRunHours)
    const maxRunHoursInvalid =
        !Number.isInteger(maxRunHoursNumber) ||
        maxRunHoursNumber < 1 ||
        maxRunHoursNumber > MAX_RUN_HOURS_LIMIT

    const source = useMemo(
        () =>
            'source' in selectedTask.args ? selectedTask.args.source : selectedTask.args.sources[0],
        [selectedTask.args]
    )

    const destination = useMemo(
        () => ('destination' in selectedTask.args ? selectedTask.args.destination : null),
        [selectedTask.args]
    )

    // The drawer stays mounted after close, so "the next 5 runs" must be re-anchored to the
    // current time on every open (and kept fresh while open) — paused while closed.
    const now = useNow(isOpen ? 30_000 : null)

    const cronValidation = useQuery({
        queryKey: ['scheduler', 'validate-cron', cronExpression],
        queryFn: () => schedulerValidateCron(cronExpression),
        enabled: isOpen && !!cronExpression,
        // The response carries the next-runs preview anchored at fetch time; without refetching,
        // a frequent schedule (e.g. every minute) drains all 5 entries past `now` while the
        // drawer sits open.
        refetchInterval: 30_000,
    })
    const cronError =
        cronValidation.data && !cronValidation.data.valid
            ? (cronValidation.data.error ?? 'Invalid cron expression')
            : null

    const historyQuery = useQuery({
        queryKey: ['scheduler', 'history', selectedTask.id],
        queryFn: () => schedulerReadHistory(selectedTask.id, 10),
        enabled: isOpen,
        refetchInterval: 15_000,
    })

    const finishedRuns = useMemo(
        () => (historyQuery.data ?? []).filter((line) => line.event === 'finished'),
        [historyQuery.data]
    )

    const selectedConfig = useMemo(
        () => configFiles.find((config) => config.id === configId) ?? null,
        [configFiles, configId]
    )
    const configMissing = !selectedConfig
    const configPasswordMissing = isConfigPasswordMissing(configFiles, configId)

    // From the validation query, i.e. computed in Rust by the runner's own cron matcher — a JS
    // library here can (and did) predict fires real cron never performs (dom/dow star flag).
    // The `now` filter keeps the list fresh between refetches of the 30s-anchored query.
    const upcomingRuns = useMemo(
        () =>
            (cronValidation.data?.nextRuns ?? [])
                .map((run) => new Date(run))
                .filter((run) => run.getTime() > now),
        [cronValidation.data, now]
    )

    const hasChanges = useMemo(
        () =>
            cronExpression !== selectedTask.cron ||
            configId !== selectedTask.configId ||
            binaryPath !== selectedTask.binaryPath ||
            isEnabled !== selectedTask.isEnabled ||
            verboseLogging !== (selectedTask.verboseLogging ?? false) ||
            runMode !== (selectedTask.runMode ?? 'user') ||
            maxRunHoursNumber !== (selectedTask.maxRunHours ?? DEFAULT_MAX_RUN_HOURS),
        [
            cronExpression,
            configId,
            binaryPath,
            isEnabled,
            verboseLogging,
            runMode,
            maxRunHoursNumber,
            selectedTask,
        ]
    )

    const logQuery = useQuery({
        queryKey: ['scheduler', 'log', selectedTask.id, logView],
        queryFn: () => schedulerReadLog(selectedTask.id, logView),
        enabled: isOpen,
        refetchInterval: 5_000,
    })

    const saveMutation = useMutation({
        mutationFn: async () => {
            setSaveError(null)
            await schedulerUpdateTask(selectedTask.id, {
                cron: cronExpression,
                configId,
                binaryPath,
                isEnabled,
                verboseLogging,
                runMode,
                maxRunHours: maxRunHoursNumber,
            })
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['scheduler'] })
            onClose()
        },
        onError: (error) => {
            setSaveError(formatErrorMessage(error, 'Failed to save the schedule'))
        },
    })

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
                                    {!!selectedTask.registrationError && (
                                        <Alert
                                            color="danger"
                                            variant="faded"
                                            title="Not registered with the system scheduler"
                                        >
                                            <pre className="text-sm break-all whitespace-pre-wrap">
                                                {selectedTask.registrationError}
                                            </pre>
                                        </Alert>
                                    )}
                                    {!!saveError && (
                                        <Alert color="danger" variant="faded" title="Save failed">
                                            <pre className="text-sm break-all whitespace-pre-wrap">
                                                {saveError}
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
                                        </div>
                                    </div>

                                    <Divider />

                                    <div className="flex flex-col gap-3">
                                        <h3 className="text-lg font-medium">Execution</h3>
                                        <div className="grid grid-cols-2 gap-4">
                                            <ConfigSelect
                                                configFiles={configFiles}
                                                value={configId}
                                                onChange={setConfigId}
                                                placeholder={
                                                    configMissing
                                                        ? 'Config no longer exists'
                                                        : undefined
                                                }
                                            />
                                            <BinarySelect
                                                value={binaryPath}
                                                onChange={(path) => {
                                                    setSaveError(null)
                                                    setBinaryPath(path)
                                                }}
                                                onError={setSaveError}
                                            />
                                        </div>
                                        {configMissing && (
                                            <Alert color="danger" variant="faded" title="">
                                                The config this task used no longer exists — pick
                                                another one.
                                            </Alert>
                                        )}
                                        {configPasswordMissing && (
                                            <Alert
                                                color="warning"
                                                variant="faded"
                                                title="Encrypted config without a saved password"
                                            >
                                                This config is encrypted and has no saved password
                                                or password command. The scheduled runner cannot
                                                prompt for it, so runs will fail until you save the
                                                password in Settings → Config.
                                            </Alert>
                                        )}
                                        <Switch
                                            size="sm"
                                            color="primary"
                                            isSelected={isEnabled}
                                            onValueChange={setIsEnabled}
                                            data-focus-visible="false"
                                        >
                                            Enabled
                                        </Switch>
                                        <div className="flex flex-col gap-1">
                                            <span className="text-small">Run mode</span>
                                            <Tabs
                                                size="sm"
                                                selectedKey={runMode}
                                                onSelectionChange={(key) =>
                                                    setRunMode(key as 'system' | 'user')
                                                }
                                                data-focus-visible="false"
                                            >
                                                <Tab key="user" title="User" />
                                                <Tab key="system" title="System" />
                                            </Tabs>
                                            <span className="text-tiny text-default-400">
                                                {runMode === 'user'
                                                    ? 'Runs only while you are logged in, inside your session. OS keychain passwords and session-mounted drives work; fires while logged out are skipped. On macOS it runs as Rclone UI, so protected folders work once you grant the app access.'
                                                    : 'Runs even while logged out, but outside your login session. No OS keychain or session-mounted drives, and protected folders on macOS need Full Disk Access for cron.'}
                                            </span>
                                        </div>
                                        <Switch
                                            size="sm"
                                            color="primary"
                                            isSelected={verboseLogging}
                                            onValueChange={setVerboseLogging}
                                            data-focus-visible="false"
                                        >
                                            <div className="flex flex-col">
                                                <span className="text-small">Verbose logging</span>
                                                <span className="text-tiny text-default-400">
                                                    Log individual transfers to the rclone log
                                                    (grows faster)
                                                </span>
                                            </div>
                                        </Switch>
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
                                            error={cronError}
                                        />
                                    </div>

                                    <Divider />

                                    <div className="flex flex-col gap-3">
                                        <h3 className="text-lg font-medium">Advanced</h3>
                                        <Input
                                            type="number"
                                            label="Max run time (hours)"
                                            labelPlacement="outside"
                                            min={1}
                                            max={MAX_RUN_HOURS_LIMIT}
                                            value={maxRunHours}
                                            onValueChange={setMaxRunHours}
                                            isInvalid={maxRunHoursInvalid}
                                            errorMessage={`Enter a whole number of hours between 1 and ${MAX_RUN_HOURS_LIMIT}`}
                                            description="A run still going after this long is stopped and marked failed."
                                            className="max-w-64"
                                            data-focus-visible="false"
                                        />
                                    </div>

                                    <Divider />

                                    <div className="flex flex-col gap-3">
                                        <h3 className="text-lg font-medium">Run History</h3>
                                        {finishedRuns.length > 0 ? (
                                            <div className="flex flex-col gap-2">
                                                {finishedRuns.map((run) =>
                                                    run.event === 'finished' ? (
                                                        <div
                                                            key={run.runId}
                                                            className="flex items-center gap-3 text-sm"
                                                        >
                                                            <Chip
                                                                size="sm"
                                                                variant="flat"
                                                                color={
                                                                    run.success
                                                                        ? 'success'
                                                                        : 'danger'
                                                                }
                                                            >
                                                                {run.success ? 'OK' : 'Failed'}
                                                            </Chip>
                                                            <span>
                                                                {formatDistance(
                                                                    new Date(run.ts),
                                                                    new Date(now),
                                                                    { addSuffix: true }
                                                                )}
                                                            </span>
                                                            <span className="text-foreground-500">
                                                                {Math.round(run.durationMs / 1000)}s
                                                            </span>
                                                            {!!run.error && (
                                                                <span className="text-danger-500 line-clamp-1">
                                                                    {run.error}
                                                                </span>
                                                            )}
                                                        </div>
                                                    ) : null
                                                )}
                                            </div>
                                        ) : (
                                            <p className="text-sm text-foreground-500">
                                                This task hasn't run yet.
                                            </p>
                                        )}
                                    </div>

                                    <Divider />

                                    <div className="flex flex-col gap-3">
                                        <div className="flex items-center justify-between">
                                            <h3 className="text-lg font-medium">Logs</h3>
                                            <div className="flex gap-1">
                                                <Button
                                                    size="sm"
                                                    variant={
                                                        logView === 'runner' ? 'solid' : 'light'
                                                    }
                                                    color={
                                                        logView === 'runner' ? 'primary' : 'default'
                                                    }
                                                    onPress={() => setLogView('runner')}
                                                    data-focus-visible="false"
                                                >
                                                    Runner
                                                </Button>
                                                <Button
                                                    size="sm"
                                                    variant={
                                                        logView === 'daemon' ? 'solid' : 'light'
                                                    }
                                                    color={
                                                        logView === 'daemon' ? 'primary' : 'default'
                                                    }
                                                    onPress={() => setLogView('daemon')}
                                                    data-focus-visible="false"
                                                >
                                                    rclone
                                                </Button>
                                            </div>
                                        </div>
                                        {logQuery.data?.truncated && (
                                            <p className="text-tiny text-default-400">
                                                Showing the last 64 KB — older lines are on disk.
                                            </p>
                                        )}
                                        <pre className="p-3 overflow-auto font-mono whitespace-pre-wrap rounded-medium bg-content2 text-tiny max-h-64">
                                            {logQuery.data?.content ||
                                                (logView === 'runner'
                                                    ? 'No runner output yet.'
                                                    : 'No rclone output yet.')}
                                        </pre>
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
                                isDisabled={
                                    !hasChanges ||
                                    !!cronError ||
                                    configMissing ||
                                    maxRunHoursInvalid
                                }
                                isLoading={saveMutation.isPending}
                                onPress={() => saveMutation.mutate()}
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
