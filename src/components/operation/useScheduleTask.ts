import { useMutation } from '@tanstack/react-query'
import { invoke } from '@tauri-apps/api/core'
import cronstrue from 'cronstrue'
import { onErrorDialog } from '../../../lib/errors'
import notify from '../../../lib/notify'
import { useHostStore } from '../../../store/host'
import type { ScheduledTask } from '../../../types/schedules'

/**
 * The schedule mutation shared by the operation pages: page-specific validation (path checks,
 * the Copy/Move multi-source license gate) → cron validation → native name prompt →
 * addScheduledTask with the page-built args. `buildArgs` must return the EXACT persisted args
 * shape the page's start function takes — main.ts replays these verbatim.
 */
export function useScheduleTask<O extends ScheduledTask['operation']>({
    operation,
    cronExpression,
    buildArgs,
    validate,
}: {
    operation: O
    cronExpression: string | null
    buildArgs: () => Extract<ScheduledTask, { operation: O }>['args']
    validate?: () => void
}) {
    return useMutation({
        mutationFn: async () => {
            validate?.()

            if (!cronExpression) {
                throw new Error('Please enter a cron expression')
            }

            try {
                cronstrue.toString(cronExpression)
            } catch {
                throw new Error('Invalid cron expression')
            }

            const name = await invoke<string | null>('prompt', {
                title: 'Schedule Name',
                message: 'Enter a name for this schedule',
                default: `New Schedule ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: '2-digit' })}`,
            })

            if (!name) {
                throw new Error('Schedule name is required')
            }

            useHostStore.getState().addScheduledTask({
                name,
                operation,
                cron: cronExpression,
                args: buildArgs(),
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
