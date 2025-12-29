import type {
    startBisync,
    startCopy,
    startDelete,
    startMove,
    startPurge,
    startSync,
} from '../lib/rclone/api'

export type ScheduledTask = {
    id: string
    name?: string
    cron: string
    isRunning: boolean
    isEnabled: boolean
    currentRunId?: string
    lastRun?: string
    lastRunError?: string
    configId: string
} & (
    | {
          operation: 'delete'
          args: Parameters<typeof startDelete>[0]
      }
    | {
          operation: 'sync'
          args: Parameters<typeof startSync>[0]
      }
    | {
          operation: 'copy'
          args: Parameters<typeof startCopy>[0]
      }
    | {
          operation: 'move'
          args: Parameters<typeof startMove>[0]
      }
    | {
          operation: 'purge'
          args: Parameters<typeof startPurge>[0]
      }
    | {
          operation: 'bisync'
          args: Parameters<typeof startBisync>[0]
      }
)
