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

    isRestartingRclone: boolean

    currentTheme: {
        app: 'light' | 'dark' | 'system'
        tray: 'light' | 'dark' | 'system'
    }
}

export const useStore = create<State>()(
    shared(
        (_) => ({
            firstWindow: true,

            startupStatus: null,
            startupDisplayed: false,

            isRestartingRclone: false,

            currentTheme: {
                app: 'dark',
                tray: 'system',
            },
        }),
        { name: 'shared-store' }
    )
)
