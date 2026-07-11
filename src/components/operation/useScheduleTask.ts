import { useMutation } from '@tanstack/react-query'
import { invoke } from '@tauri-apps/api/core'
import { onErrorDialog } from '../../../lib/errors'
import { notify } from '../../../lib/notifications'
import { createScheduledTask } from '../../../lib/scheduler'
import type { ScheduledTask } from '../../../types/schedules'

/**
 * The schedule mutation shared by the operation pages: page-specific validation (path checks,
 * the Copy/Move multi-source license gate) → per-platform cron validation → native name prompt →
 * createScheduledTask, which persists the task and registers it with the OS scheduler. The
 * headless runner replays the pre-serialized requests built from `buildArgs()` output.
 */
export function useScheduleTask<O extends ScheduledTask['operation']>({
    operation,
    cronExpression,
    configId,
    binaryPath,
    buildArgs,
    validate,
}: {
    operation: O
    cronExpression: string | null
    /** From the page's Advanced section; omitted/null = active config. */
    configId?: string | null
    /** From the page's Advanced section; omitted = 'app-default'. */
    binaryPath?: string
    buildArgs: () => Extract<ScheduledTask, { operation: O }>['args']
    validate?: () => void
}) {
    return useMutation({
        mutationFn: async () => {
            validate?.()

            if (!cronExpression) {
                throw new Error('Please enter a cron expression')
            }

            const name = await invoke<string | null>('prompt', {
                title: 'Schedule Name',
                message: 'Enter a name for this schedule',
                default: `New Schedule ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: '2-digit' })}`,
            })

            if (!name) {
                throw new Error('Schedule name is required')
            }

            await createScheduledTask({
                name,
                operation,
                cron: cronExpression,
                args: buildArgs(),
                configId: configId ?? undefined,
                binaryPath,
            })
        },
        onSuccess: async () => {
            await notify({
                title: 'Success',
                body: 'New schedule has been created',
            })
        },
        onError: onErrorDialog('Schedule', 'Failed to schedule task', {
            capture: false,
            log: ['Error scheduling task:'],
        }),
    })
}
