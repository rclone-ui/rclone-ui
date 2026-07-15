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
    // Set when a restart is requested while one is already running: instead of dropping the request
    // (which would leave the daemon on a stale config while the store/symlink point at the new one),
    // the in-flight restart loops once more after it finishes. See the RESTART_RCLONE listener.
    rcloneRestartPending: boolean

    cloudflaredTunnel: {
        pid: number
        url: string
    } | null

    dryRunJobIds: number[]

    watchedJobs: Record<number, WatchedJob>

    reconnectDialogsShown: string[]
}

export const useStore = create<State>()(
    shared(
        (_) => ({
            startupStatus: null,
            startupDisplayed: false,

            isRestartingRclone: false,
            rcloneRestartPending: false,

            cloudflaredTunnel: null,

            dryRunJobIds: [],

            watchedJobs: {},

            reconnectDialogsShown: [],
        }),
        { name: 'shared-store' }
    )
)

export function claimReconnectDialog(remoteName: string): boolean {
    let claimed = false

    useStore.setState((state) => {
        if (state.reconnectDialogsShown.includes(remoteName)) return state
        claimed = true
        return { reconnectDialogsShown: [...state.reconnectDialogsShown, remoteName] }
    })

    return claimed
}
