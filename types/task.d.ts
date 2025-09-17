export interface ScheduledTask {
    id: string
    type: 'delete' | 'sync' | 'copy' | 'move' | 'purge'
    cron: string
    isRunning: boolean
    isEnabled: boolean
    currentRunId?: string
    lastRun?: string
    configId: string
    args: Record<string, any>
    error?: string
}
