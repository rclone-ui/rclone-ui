import { LazyStore } from '@tauri-apps/plugin-store'
import { shared } from 'use-broadcast-ts'
import { create } from 'zustand'
import { type StateStorage, createJSONStorage, persist } from 'zustand/middleware'
import type { ConfigFile } from '../types/config'
import type { ScheduledTask } from '../types/task'
import type { Template } from '../types/template'

// const { LazyStore } = window.__TAURI__.store
const store = new LazyStore('store.json')

export interface RemoteConfig {
    disabledActions?: ('tray' | 'tray-mount' | 'tray-browse' | 'tray-remove' | 'tray-cleanup')[]

    defaultRemotePath?: string
    defaultMountPoint?: string
    mountOnStart?: boolean

    mountDefaults?: Record<string, any>
    vfsDefaults?: Record<string, any>
    filterDefaults?: Record<string, any>
    copyDefaults?: Record<string, any>
    moveDefaults?: Record<string, any>
    syncDefaults?: Record<string, any>
    configDefaults?: Record<string, any>
    remoteDefaults?: Record<string, any>
}

interface State {
    firstWindow: boolean

    rcloneLoaded: boolean
    rcloneAuth: string
    rcloneAuthHeader: string

    remotes: string[]
    setRemotes: (remotes: string[]) => void
    addRemote: (remote: string) => void
    removeRemote: (remote: string) => void

    startupStatus:
        | null
        | 'initializing'
        | 'initialized'
        | 'updating'
        | 'updated'
        | 'error'
        | 'fatal'

    startupDisplayed: boolean
}

type SupportedAction =
    | 'tray-mount'
    | 'tray-sync'
    | 'tray-copy'
    | 'tray-serve'
    | 'tray-move'
    | 'tray-delete'
    | 'tray-purge'
    | 'tray-download'

interface PersistedState {
    remoteConfigList: Record<string, RemoteConfig>
    setRemoteConfig: (remote: string, config: RemoteConfig) => void
    mergeRemoteConfig: (remote: string, config: RemoteConfig) => void

    disabledActions: SupportedAction[]

    setDisabledActions: (actions: SupportedAction[]) => void

    proxy:
        | {
              url: string
              ignoredHosts: string[]
          }
        | undefined

    favoritePaths: { remote: string; path: string; added: number }[]

    settingsPass: string | undefined
    setSettingsPass: (pass: string | undefined) => void

    licenseKey: string | undefined
    setLicenseKey: (key: string | undefined) => void
    licenseValid: boolean
    setLicenseValid: (valid: boolean) => void

    startOnBoot: boolean
    setStartOnBoot: (startOnBoot: boolean) => void

    scheduledTasks: ScheduledTask[]
    addScheduledTask: (
        task: Omit<
            ScheduledTask,
            'id' | 'isRunning' | 'currentRunId' | 'lastRun' | 'configId' | 'isEnabled'
        >
    ) => void
    removeScheduledTask: (id: string) => void
    updateScheduledTask: (id: string, task: Partial<ScheduledTask>) => void

    templates: Template[]

    configFiles: ConfigFile[]
    addConfigFile: (configFile: ConfigFile) => void
    removeConfigFile: (id: string) => void
    activeConfigFile: ConfigFile | null
    setActiveConfigFile: (configFile: string) => void
    updateConfigFile: (id: string, configFile: Partial<ConfigFile>) => void

    lastSkippedVersion: string | undefined

    hideStartup: boolean

    theme: 'light' | 'dark' | undefined
}

const getStorage = (store: LazyStore): StateStorage => ({
    getItem: async (name: string): Promise<string | null> => {
        console.log('getItem', { name })
        return (await store.get(name)) || null
    },
    setItem: async (name: string, value: string): Promise<void> => {
        console.log('setItem', { name, value })
        await store.set(name, value)
        await store.save()
    },
    removeItem: async (name: string): Promise<void> => {
        console.log('removeItem', { name })
        await store.delete(name)
        await store.save()
    },
})

export const useStore = create<State>()(
    shared(
        (set) => ({
            firstWindow: true,

            rcloneLoaded: false,
            rcloneAuth: '',
            rcloneAuthHeader: '',

            remotes: [],
            setRemotes: (remotes: string[]) => set((_) => ({ remotes })),
            addRemote: (remote: string) =>
                set((state) => ({ remotes: [...state.remotes, remote] })),
            removeRemote: (remote: string) =>
                set((state) => ({ remotes: state.remotes.filter((r) => r !== remote) })),

            startupStatus: null,
            startupDisplayed: false,
        }),
        { name: 'shared-store' }
    )
)

export const usePersistedStore = create<PersistedState>()(
    persist(
        (set) => ({
            remoteConfigList: {},
            setRemoteConfig: (remote: string, config: Record<string, any>) =>
                set((state) => ({
                    remoteConfigList: { ...state.remoteConfigList, [remote]: config },
                })),
            mergeRemoteConfig: (remote: string, config: Record<string, any>) =>
                set((state) => ({
                    remoteConfigList: {
                        ...state.remoteConfigList,
                        [remote]: { ...state.remoteConfigList[remote], ...config },
                    },
                })),

            disabledActions: [],
            setDisabledActions: (actions: SupportedAction[]) =>
                set((_) => ({ disabledActions: actions })),

            favoritePaths: [],

            proxy: undefined,

            settingsPass: undefined,
            setSettingsPass: (pass: string | undefined) => set((_) => ({ settingsPass: pass })),

            licenseKey: undefined,
            setLicenseKey: (key: string | undefined) => set((_) => ({ licenseKey: key })),
            licenseValid: false,
            setLicenseValid: (valid: boolean) => set((_) => ({ licenseValid: valid })),

            startOnBoot: false,
            setStartOnBoot: (startOnBoot: boolean) => set((_) => ({ startOnBoot })),

            scheduledTasks: [],
            addScheduledTask: (
                task: Omit<
                    ScheduledTask,
                    'id' | 'isRunning' | 'currentRunId' | 'lastRun' | 'configId' | 'isEnabled'
                >
            ) => {
                const state = usePersistedStore.getState()
                const configId = state.activeConfigFile?.id

                if (!configId) {
                    console.error('No active config file for scheduled task')
                    throw new Error('No active config file')
                }

                set((state) => ({
                    scheduledTasks: [
                        ...state.scheduledTasks,
                        {
                            ...task,
                            id: crypto.randomUUID(),
                            isRunning: false,
                            isEnabled: true,
                            configId,
                        },
                    ],
                }))
            },
            removeScheduledTask: (id: string) =>
                set((state) => ({
                    scheduledTasks: state.scheduledTasks.filter((t) => t.id !== id),
                })),
            updateScheduledTask: (id: string, task: Partial<ScheduledTask>) =>
                set((state) => ({
                    scheduledTasks: state.scheduledTasks.map((t) =>
                        t.id === id ? { ...t, ...task } : t
                    ),
                })),

            templates: [],

            configFiles: [],
            addConfigFile: (configFile: ConfigFile) =>
                set((state) => ({
                    configFiles: [...state.configFiles, configFile],
                })),
            removeConfigFile: (id: string) =>
                set((state) => ({
                    configFiles: state.configFiles.filter((f) => f.id !== id),
                })),
            activeConfigFile: null,
            setActiveConfigFile: (id: string) =>
                set((state) => ({
                    activeConfigFile: state.configFiles.find((f) => f.id === id) || null,
                })),
            updateConfigFile: (id: string, configFile: Partial<ConfigFile>) =>
                set((state) => ({
                    configFiles: state.configFiles.map((f) =>
                        f.id === id ? { ...f, ...configFile } : f
                    ),
                })),

            lastSkippedVersion: undefined,

            hideStartup: false,

            theme: undefined,
        }),
        {
            name: 'store',
            storage: createJSONStorage(() => getStorage(store)),
            version: 1,
        }
    )
)

// useStore.persist.onFinishHydration(() => {
//     console.log('onFinishHydration')
// })

store.onKeyChange('store', async (_) => {
    await usePersistedStore.persist.rehydrate()
})
