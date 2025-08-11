export interface ScheduledTask {
    id: string
    type: 'delete' | 'sync' | 'copy'
    cron: string
    isRunning: boolean
    isEnabled: boolean
    currentRunId?: string
    lastRun?: string
    configId: string
    args: Record<string, any>
    error?: string
}
