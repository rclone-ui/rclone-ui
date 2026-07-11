import { shared } from 'use-broadcast-ts'
import { create } from 'zustand'

// Registered by the start* functions in lib/rclone/api.ts; consumed by the main window's job
// watcher (lib/notifications.ts). Plain JSON only — values cross a BroadcastChannel.
export interface WatchedJob {
    jobid: number
    operation: 'copy' | 'move' | 'sync' | 'bisync' | 'delete' | 'purge' | 'batch'
    sources?: string[]
    destination?: string
    startedAt: number
}

interface State {
    startupStatus:
        | null
        | 'initializing'
        | 'initialized'
        | 'updating'
        | 'updated'
        | 'error'
        | 'fatal'

    startupDisplayed: boolean

    isRestartingRclone: boolean

    cloudflaredTunnel: {
        pid: number
        url: string
    } | null

    dryRunJobIds: number[]

    watchedJobs: Record<number, WatchedJob>
}

export const useStore = create<State>()(
    shared(
        (_) => ({
            startupStatus: null,
            startupDisplayed: false,

            isRestartingRclone: false,

            cloudflaredTunnel: null,

            dryRunJobIds: [],

            watchedJobs: {},
        }),
        { name: 'shared-store' }
    )
)
