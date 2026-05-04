import { shared } from 'use-broadcast-ts'
import { create } from 'zustand'

interface State {
    firstWindow: boolean

    startupStatus:
        | null
        | 'initializing'
        | 'initialized'
        | 'updating'
        | 'updated'
        | 'error'
        | 'fatal'

    startupDisplayed: boolean
    startupMessage: string | null
    startupIsDownloading: boolean
    startupDownloadedBytes: number
    startupTotalBytes: number | null
    startupDownloadSpeed: number | null

    isRestartingRclone: boolean

    currentTheme: {
        app: 'light' | 'dark' | 'system'
        tray: 'light' | 'dark' | 'system'
    }

    cloudflaredTunnel: {
        pid: number
        url: string
    } | null

    dryRunJobIds: number[]
}

export const useStore = create<State>()(
    shared(
        (_) => ({
            firstWindow: true,

            startupStatus: null,
            startupDisplayed: false,
            startupMessage: null,
            startupIsDownloading: false,
            startupDownloadedBytes: 0,
            startupTotalBytes: null,
            startupDownloadSpeed: null,

            isRestartingRclone: false,

            currentTheme: {
                app: 'dark',
                tray: 'system',
            },

            cloudflaredTunnel: null,

            dryRunJobIds: [],
        }),
        { name: 'shared-store' }
    )
)
