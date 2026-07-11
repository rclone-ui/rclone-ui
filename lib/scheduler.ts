import * as Sentry from '@sentry/browser'
import { useQuery } from '@tanstack/react-query'
import { invoke } from '@tauri-apps/api/core'
import { initHostStore, useHostStore } from '../store/host'
import { usePersistedStore } from '../store/persisted'
import type { ScheduledTask } from '../types/schedules'
import { LOCAL_HOST_ID } from './hosts'
import { type RcRequest, type TaskRequestInput, buildTaskRequests } from './rclone/requests'

// Orchestration between the zustand host store (task definitions — the source of truth) and the
// Rust OS scheduler (registration reality). Registration is always an upsert, so the startup
// reconcile() self-heals deleted OS artifacts, moved app bundles, and restored backups.
//
// Scheduling is LOCAL-HOST-ONLY: tasks stored under remote hosts stay inert.

export interface SchedulerSupport {
    supported: boolean
    reason?: string
}

export interface SchedulerJobSpec {
    schemaVersion: 1
    taskId: string
    hostId: string
    name: string
    operation: ScheduledTask['operation']
    cron: string
    configId: string
    binary: 'app-default' | string
    maxRunSeconds: number
    verboseLogging: boolean
    runMode: 'system' | 'user'
    requests: RcRequest[]
}

export interface SchedulerTaskStatus {
    taskId: string
    installed: boolean
    enabled: boolean
    running: boolean
    lastFinished?: {
        runId: string
        ts: string
        success: boolean
        error?: string
        durationMs: number
        jobids?: number[]
        stats?: { bytes?: number; transfers?: number; errors?: number }
        /** Synthesized: the run left a started event but no finished one (crash/power loss). */
        interrupted?: boolean
    }
    /** Backend health warning — installed+enabled but the OS won't fire it (e.g. the macOS
     * background item was toggled off in System Settings). */
    warning?: string
}

export type SchedulerHistoryLine =
    | { event: 'started'; runId: string; ts: string; pid: number; hostId: string }
    | {
          event: 'finished'
          runId: string
          ts: string
          success: boolean
          error?: string
          durationMs: number
          jobids?: number[]
          stats?: { bytes?: number; transfers?: number; errors?: number }
      }
    | { event: 'skipped'; ts: string; reason: string }

/** Max run time bounds, in hours. The wire format (JobSpec.maxRunSeconds) stays in seconds. */
export const DEFAULT_MAX_RUN_HOURS = 24
export const MAX_RUN_HOURS_LIMIT = 120

function clampMaxRunHours(hours: number | undefined): number {
    if (!Number.isFinite(hours)) {
        return DEFAULT_MAX_RUN_HOURS
    }
    return Math.min(Math.max(Math.round(hours as number), 1), MAX_RUN_HOURS_LIMIT)
}

let cachedSupport: SchedulerSupport | null = null

export async function schedulerSupported(): Promise<SchedulerSupport> {
    if (!cachedSupport) {
        cachedSupport = await invoke<SchedulerSupport>('scheduler_supported')
    }
    return cachedSupport
}

export function useSchedulerSupported() {
    return useQuery({
        queryKey: ['scheduler', 'supported'],
        queryFn: schedulerSupported,
        staleTime: Number.POSITIVE_INFINITY,
    })
}

export interface CronValidation {
    valid: boolean
    error?: string
    /** Next local fire times (RFC3339), computed by the same Rust matcher the runner uses —
     * the only preview source that can't disagree with what the OS schedule will do. */
    nextRuns: string[]
}

export async function schedulerValidateCron(cron: string) {
    return invoke<CronValidation>('scheduler_validate_cron', { cron })
}

export async function schedulerStatus(hostId: string) {
    return invoke<SchedulerTaskStatus[]>('scheduler_status', { hostId })
}

export async function schedulerReadHistory(taskId: string, limit?: number) {
    return invoke<SchedulerHistoryLine[]>('scheduler_read_history', { taskId, limit })
}

export async function schedulerRunNow(taskId: string) {
    return invoke('scheduler_run_now', { taskId })
}

export async function schedulerReadLog(taskId: string, which: 'runner' | 'daemon') {
    return invoke<{ content: string; truncated: boolean }>('scheduler_read_log', {
        taskId,
        which,
    })
}

function buildJobSpec(task: ScheduledTask): SchedulerJobSpec {
    return {
        schemaVersion: 1,
        taskId: task.id,
        hostId: LOCAL_HOST_ID,
        name: task.name ?? task.operation,
        operation: task.operation,
        cron: task.cron,
        configId: task.configId,
        binary: task.binaryPath,
        maxRunSeconds: clampMaxRunHours(task.maxRunHours) * 3600,
        verboseLogging: task.verboseLogging ?? false,
        runMode: task.runMode ?? 'user',
        // Pre-serialized here, at save time, by the exact same builders the live start* path
        // uses — the runner just POSTs them. Throws when the args can't serialize.
        requests: buildTaskRequests(task),
    }
}

async function registerTask(task: ScheduledTask): Promise<void> {
    const spec = buildJobSpec(task)
    // One command: the artifact is installed directly in the target enabled state. A separate
    // set_enabled step used to leave disabled tasks briefly armed (and, when it failed, running
    // against the user's intent — or flagged as unregistered although active).
    await invoke('scheduler_register', { spec, enabled: task.isEnabled })
}

function isCurrentHostLocal() {
    return (usePersistedStore.getState().currentHostId ?? LOCAL_HOST_ID) === LOCAL_HOST_ID
}

function assertLocalHost() {
    if (!isCurrentHostLocal()) {
        throw new Error('Scheduling is only available on your local machine')
    }
}

async function assertSupported() {
    const support = await schedulerSupported()
    if (!support.supported) {
        throw new Error(support.reason ?? 'Scheduling is not available on this system')
    }
}

/**
 * Creates a task, registers it with the OS scheduler, and returns its id. On registration
 * failure the task is kept (with the error stored on it) — never silently lost; the startup
 * reconcile retries. isEnabled always reflects user intent, never system state.
 */
export async function createScheduledTask(input: {
    name: string
    operation: ScheduledTask['operation']
    cron: string
    args: ScheduledTask['args']
    /** Defaults to the active config when omitted. */
    configId?: string
    /** Defaults to 'app-default' when omitted. */
    binaryPath?: string
    /** Defaults to 'user' (only runs while logged in) when omitted. */
    runMode?: 'system' | 'user'
}): Promise<string> {
    assertLocalHost()
    await assertSupported()

    const validation = await schedulerValidateCron(input.cron)
    if (!validation.valid) {
        throw new Error(validation.error ?? 'Invalid cron expression')
    }

    const hostState = useHostStore.getState()
    const configId = input.configId ?? hostState.activeConfigId
    if (!configId) {
        throw new Error('No active config file')
    }
    if (!hostState.configFiles.some((config) => config.id === configId)) {
        throw new Error('The selected config file no longer exists')
    }

    const task = {
        name: input.name,
        operation: input.operation,
        cron: input.cron,
        args: input.args,
        isEnabled: true,
        configId,
        binaryPath: input.binaryPath ?? 'app-default',
        runMode: input.runMode ?? 'user',
    } as Omit<ScheduledTask, 'id'>

    // Serialization must succeed before anything persists. (Callers guarantee the operation/args
    // correlation via useScheduleTask's generic; Omit<> flattens the discriminated union, hence
    // the cast.)
    buildTaskRequests({ operation: input.operation, args: input.args } as TaskRequestInput)

    const id = hostState.addScheduledTask(task)
    const stored = useHostStore.getState().scheduledTasks.find((t) => t.id === id)
    if (!stored) {
        throw new Error('Failed to save the scheduled task')
    }

    try {
        await registerTask(stored)
    } catch (error) {
        const registrationError = error instanceof Error ? error.message : String(error)
        useHostStore.getState().updateScheduledTask(id, { registrationError })
        throw new Error(
            `The schedule was saved but could not be registered with the system: ${registrationError}`
        )
    }

    return id
}

/**
 * Updates a task and re-registers it (upsert). On a remote host this is a store-only edit —
 * remote tasks are inert in v1 and must never touch the local OS scheduler.
 */
export async function updateScheduledTask(
    id: string,
    patch: Partial<ScheduledTask>
): Promise<void> {
    if (!isCurrentHostLocal()) {
        useHostStore.getState().updateScheduledTask(id, patch)
        return
    }

    await assertSupported()

    if (patch.cron) {
        const validation = await schedulerValidateCron(patch.cron)
        if (!validation.valid) {
            throw new Error(validation.error ?? 'Invalid cron expression')
        }
    }

    const store = useHostStore.getState()
    store.updateScheduledTask(id, { ...patch, registrationError: undefined })
    const merged = useHostStore.getState().scheduledTasks.find((t) => t.id === id)
    if (!merged) {
        throw new Error('Task not found')
    }

    try {
        await registerTask(merged)
    } catch (error) {
        const registrationError = error instanceof Error ? error.message : String(error)
        useHostStore.getState().updateScheduledTask(id, { registrationError })
        throw new Error(`The task was saved but could not be registered: ${registrationError}`)
    }
}

/**
 * Removes the task. The OS unregister removes the job file even when the OS-level uninstall
 * fails, so a surviving trigger self-heals on its next fire (the runner finds no job file,
 * removes the trigger, and exits). Remote-host tasks are store-only.
 */
export async function removeScheduledTask(id: string): Promise<void> {
    if (isCurrentHostLocal()) {
        try {
            await invoke('scheduler_unregister', { taskId: id, hostId: LOCAL_HOST_ID })
        } catch (error) {
            console.error(
                '[scheduler] unregister failed; the trigger self-heals on next fire',
                error
            )
        }
    }
    useHostStore.getState().removeScheduledTask(id)
}

export async function setScheduledTaskEnabled(id: string, enabled: boolean): Promise<void> {
    const task = useHostStore.getState().scheduledTasks.find((t) => t.id === id)
    if (!task) {
        throw new Error('Task not found')
    }

    // Remote-host tasks are inert — the toggle is a definition-only edit.
    if (!isCurrentHostLocal()) {
        useHostStore.getState().updateScheduledTask(id, { isEnabled: enabled })
        return
    }

    // Enabling a task whose registration previously failed retries the full registration.
    if (enabled && task.registrationError) {
        await updateScheduledTask(id, { isEnabled: true })
        return
    }

    // Disabling a task whose registration failed: an OS artifact may STILL exist (a failed
    // edit leaves the previous artifact active; a failed mode flip can leave one in the other
    // backend). The Rust side sweeps every backend and treats "no artifact anywhere" as
    // success, so always ask it — a real disable failure must surface rather than leave the
    // task firing while the UI says paused.
    if (!enabled && task.registrationError) {
        await invoke('scheduler_set_enabled', { taskId: id, enabled: false })
        useHostStore.getState().updateScheduledTask(id, { isEnabled: false })
        return
    }

    // OS first, store second — a failed OS call must not leave the UI claiming a state the
    // scheduler doesn't have.
    await invoke('scheduler_set_enabled', { taskId: id, enabled })
    useHostStore.getState().updateScheduledTask(id, { isEnabled: enabled })
}

/**
 * Startup/host-switch reconciliation — idempotent, runs on EVERY start. Re-registers every
 * local task (heals exe-path drift, deleted OS artifacts, and performs the one-time migration
 * registration after the v3 store migrate) and unregisters strays the store no longer knows.
 */
export async function reconcile(): Promise<void> {
    const support = await schedulerSupported()
    if (!support.supported) {
        console.log('[scheduler] unsupported, skipping reconcile:', support.reason)
        return
    }

    // Never reconcile against a non-local host store: the stray sweep would treat every real
    // local registration as unknown and destroy it.
    if (!isCurrentHostLocal()) {
        console.log('[scheduler] current host is remote, skipping reconcile')
        return
    }

    const taskIds = useHostStore.getState().scheduledTasks.map((task) => task.id)

    for (const id of taskIds) {
        // Re-read at registration time: the UI is usable while reconcile runs, so a user edit
        // mid-loop must win — registering a stale snapshot would silently revert it in the job
        // file and OS artifact while the store shows the new definition.
        const task = useHostStore.getState().scheduledTasks.find((t) => t.id === id)
        if (!task) {
            continue
        }
        try {
            await registerTask(task)
            if (task.registrationError) {
                useHostStore.getState().updateScheduledTask(task.id, {
                    registrationError: undefined,
                })
            }
        } catch (error) {
            // registrationError only — isEnabled stays user intent, so a transient failure
            // (user bus not ready yet, launchctl hiccup) heals on the next reconcile instead of
            // permanently pausing the task.
            const registrationError = error instanceof Error ? error.message : String(error)
            console.error('[scheduler] failed to register task', task.id, registrationError)
            useHostStore.getState().updateScheduledTask(task.id, { registrationError })
        }
    }

    // Strays: OS registrations whose task no longer exists in the store.
    try {
        const statuses = await schedulerStatus(LOCAL_HOST_ID)
        const known = new Set(useHostStore.getState().scheduledTasks.map((t) => t.id))
        for (const status of statuses) {
            if (!known.has(status.taskId)) {
                console.log('[scheduler] unregistering stray task', status.taskId)
                await invoke('scheduler_unregister', {
                    taskId: status.taskId,
                    hostId: LOCAL_HOST_ID,
                })
            }
        }
    } catch (error) {
        console.error('[scheduler] stray sweep failed', error)
    }

    // Artifact-only leftovers: an OS artifact whose job file is gone (a failed uninstall after
    // the job file was already removed). A DISABLED leftover never fires, so the runner's
    // fire-time self-heal can never reach it — this sweep is the only cleanup path. Runs last:
    // the loop above just re-registered every stored task, so their job files protect them.
    try {
        const swept = await invoke<number>('scheduler_sweep_orphans')
        if (swept > 0) {
            console.log('[scheduler] swept orphaned artifacts:', swept)
        }
    } catch (error) {
        console.error('[scheduler] orphan sweep failed', error)
    }
}

let initialized = false

/**
 * Called ONLY from the hidden main window (single writer, like initJobWatcher): reconciles at
 * startup and again whenever the user switches back to the local host.
 */
export async function initScheduler(): Promise<void> {
    if (initialized) {
        return
    }
    initialized = true

    const isLocal = () =>
        (usePersistedStore.getState().currentHostId ?? LOCAL_HOST_ID) === LOCAL_HOST_ID

    let lastHostId = usePersistedStore.getState().currentHostId
    usePersistedStore.subscribe((state) => {
        if (state.currentHostId !== lastHostId) {
            lastHostId = state.currentHostId
            if (isLocal()) {
                // This window's useHostStore must be re-pointed at the local host BEFORE
                // reconciling — nothing else in the hidden main window re-inits it on host
                // switch, and reconciling against a stale (remote) host store would sweep away
                // every genuine local registration as a stray.
                initHostStore(LOCAL_HOST_ID)
                    .then(() => reconcile())
                    .catch((error) => {
                        console.error('[scheduler] reconcile after host switch failed', error)
                    })
            }
        }
    })

    if (!isLocal()) {
        return
    }

    try {
        await reconcile()
    } catch (error) {
        console.error('[scheduler] startup reconcile failed', error)
        Sentry.captureException(error)
    }
}
