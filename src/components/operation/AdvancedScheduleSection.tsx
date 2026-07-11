import { Button, cn } from '@heroui/react'
import { useQuery } from '@tanstack/react-query'
import { ChevronDownIcon, SlidersHorizontalIcon } from 'lucide-react'
import { useCallback, useState } from 'react'
import { LOCAL_HOST_ID } from '../../../lib/hosts'
import { schedulerValidateCron, useSchedulerSupported } from '../../../lib/scheduler'
import { useHostStore } from '../../../store/host'
import { usePersistedStore } from '../../../store/persisted'
import BinarySelect, { APP_DEFAULT_BINARY } from '../BinarySelect'
import ConfigSelect, { configPasswordMissing } from '../ConfigSelect'
import CronEditor from '../CronEditor'

export interface AdvancedSchedule {
    cronExpression: string | null
    setCronExpression: (expr: string | null) => void
    binaryPath: string
    setBinaryPath: (path: string) => void
    /** null = use the active config at creation time. */
    configId: string | null
    setConfigId: (id: string) => void
    reset: () => void
}

/** Page-lifted state for the Advanced section: the schedule the page's create flow reads. */
export function useAdvancedSchedule(): AdvancedSchedule {
    const [cronExpression, setCronExpression] = useState<string | null>(null)
    const [binaryPath, setBinaryPath] = useState<string>(APP_DEFAULT_BINARY)
    const [configId, setConfigId] = useState<string | null>(null)

    const reset = useCallback(() => {
        setCronExpression(null)
        setBinaryPath(APP_DEFAULT_BINARY)
        setConfigId(null)
    }, [])

    return {
        cronExpression,
        setCronExpression,
        binaryPath,
        setBinaryPath,
        configId,
        setConfigId,
        reset,
    }
}

/**
 * Collapsible "Advanced" block rendered under the path inputs on the operation pages: cron
 * schedule plus the binary and config the scheduled task will run with. These apply to the
 * SCHEDULED task only (live runs go through the app's shared daemon), so the section hides
 * entirely where scheduling can't work (sandboxed installs, remote hosts).
 */
export default function AdvancedScheduleSection({ advanced }: { advanced: AdvancedSchedule }) {
    const [expanded, setExpanded] = useState(false)
    const [pickerError, setPickerError] = useState<string | null>(null)

    const currentHostId = usePersistedStore((state) => state.currentHostId) ?? LOCAL_HOST_ID
    const supportQuery = useSchedulerSupported()
    const configFiles = useHostStore((state) => state.configFiles)
    const activeConfigId = useHostStore((state) => state.activeConfigId)

    const cronValidation = useQuery({
        queryKey: ['scheduler', 'validate-cron', advanced.cronExpression],
        queryFn: () => schedulerValidateCron(advanced.cronExpression ?? ''),
        enabled: expanded && !!advanced.cronExpression,
    })
    const cronError =
        advanced.cronExpression && cronValidation.data && !cronValidation.data.valid
            ? (cronValidation.data.error ?? 'Invalid cron expression')
            : null

    if (currentHostId !== LOCAL_HOST_ID || !(supportQuery.data?.supported ?? false)) {
        return null
    }

    const effectiveConfigId = advanced.configId ?? activeConfigId
    const passwordMissing = configPasswordMissing(configFiles, effectiveConfigId)
    const hasSchedule = !!advanced.cronExpression

    return (
        <div className="flex flex-col gap-4 px-4">
            <Button
                variant="light"
                size="sm"
                className="self-start"
                startContent={<SlidersHorizontalIcon className="w-4 h-4" />}
                endContent={
                    <ChevronDownIcon
                        className={cn('w-4 h-4 transition-transform', expanded && 'rotate-180')}
                    />
                }
                onPress={() => setExpanded(!expanded)}
                data-focus-visible="false"
            >
                Advanced{hasSchedule ? ' — scheduled' : ''}
            </Button>

            {expanded && (
                <div className="flex flex-col gap-4 p-4 border rounded-medium border-divider bg-content2/50">
                    <div className="flex flex-col gap-2">
                        <p className="text-sm font-semibold uppercase text-default-500">Schedule</p>
                        <CronEditor
                            expression={advanced.cronExpression}
                            onChange={advanced.setCronExpression}
                            error={cronError}
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <ConfigSelect
                            configFiles={configFiles}
                            value={effectiveConfigId}
                            onChange={advanced.setConfigId}
                        />
                        <BinarySelect
                            value={advanced.binaryPath}
                            onChange={(path) => {
                                setPickerError(null)
                                advanced.setBinaryPath(path)
                            }}
                            onError={setPickerError}
                        />
                    </div>
                    <p className="text-tiny text-default-400">
                        The config and binary apply to the scheduled task; immediate runs use the
                        app's active config and binary.
                    </p>
                    {!!pickerError && <p className="text-sm text-danger-500">{pickerError}</p>}
                    {passwordMissing && (
                        <p className="text-sm text-warning-600">
                            This config is encrypted with no saved password — scheduled runs will
                            fail until you save it in Settings → Config.
                        </p>
                    )}
                </div>
            )}
        </div>
    )
}
