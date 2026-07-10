import { shared } from 'use-broadcast-ts'
import { create } from 'zustand'

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
}

export const useStore = create<State>()(
    shared(
        (_) => ({
            startupStatus: null,
            startupDisplayed: false,

            isRestartingRclone: false,

            cloudflaredTunnel: null,

            dryRunJobIds: [],
        }),
        { name: 'shared-store' }
    )
)
