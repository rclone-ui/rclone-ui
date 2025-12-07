import { LazyStore } from '@tauri-apps/plugin-store'
import { create } from 'zustand'
import { type StateStorage, createJSONStorage, persist } from 'zustand/middleware'
import type { ConfigFile } from '../types/config'
import type { ScheduledTask } from '../types/cron'

let activeHostId: string | null = null
let activeStore: LazyStore | null = null
let disposeKeyChange: (() => void) | null = null

export async function initHostStore(hostId: string) {
    if (activeHostId === hostId && activeStore) {
        async function waitForHostStoreHydration() {
            await new Promise((resolve) => setTimeout(resolve, 50))
            if (!useHostStore.persist.hasHydrated()) {
                await waitForHostStoreHydration()
            }
            console.log('[waitForHostStoreHydration] host store hydrated')
        }

        await waitForHostStoreHydration()
        return
    }

    console.log('[HostStore] Initializing for host:', hostId)
    activeHostId = hostId
    activeStore = new LazyStore(`hosts/${hostId}/store.json`)

    if (disposeKeyChange) {
        try {
            disposeKeyChange()
        } catch {}
        disposeKeyChange = null
    }

    try {
        disposeKeyChange = activeStore.onKeyChange('host-store', async () => {
            await useHostStore.persist.rehydrate()
        }) as unknown as () => void
    } catch (err) {
        console.error('[HostStore] failed to register onKeyChange listener', err)
    }

    // trigger a rehydration to load the new file's content into the store
    await useHostStore.persist.rehydrate()
}

const getStorage = (): StateStorage => ({
    getItem: async (name: string): Promise<string | null> => {
        if (!activeStore) return null
        // console.log('[HostStore] getItem', { name, host: activeHostId })
        return (await activeStore.get(name)) || null
    },
    setItem: async (name: string, value: string): Promise<void> => {
        if (!activeStore) return
        console.log('[HostStore] setItem', { name, value })
        await activeStore.set(name, value)
        await activeStore.save()
    },
    removeItem: async (name: string): Promise<void> => {
        if (!activeStore) return
        await activeStore.delete(name)
        await activeStore.save()
    },
})

export interface RemoteConfig {
    mountOnStart?: {
        enabled: boolean
        remotePath: string
        mountPoint: string
        mountOptions: Record<string, any>
        vfsOptions: Record<string, any>
        filterOptions: Record<string, any>
        configOptions: Record<string, any>
    }
}

interface HostState {
    remoteConfigs: Record<string, RemoteConfig>
    setRemoteConfig: (remote: string, config: RemoteConfig) => void
    mergeRemoteConfig: (remote: string, config: RemoteConfig) => void

    proxy:
        | {
              url: string
              ignoredHosts: string[]
          }
        | undefined

    favoritePaths: { remote: string; path: string; added: number }[]

    scheduledTasks: ScheduledTask[]
    addScheduledTask: (
        task: Omit<
            ScheduledTask,
            'id' | 'isRunning' | 'currentRunId' | 'lastRun' | 'configId' | 'isEnabled'
        >
    ) => void
    removeScheduledTask: (id: string) => void
    updateScheduledTask: (id: string, task: Partial<ScheduledTask>) => void

    configFiles: ConfigFile[]
    addConfigFile: (configFile: ConfigFile) => void
    removeConfigFile: (id: string) => void
    activeConfigFile: ConfigFile | null
    setActiveConfigFile: (configFile: string) => void
    updateConfigFile: (id: string, configFile: Partial<ConfigFile>) => void

    lastSkippedVersion: string | undefined
}

export const useHostStore = create<HostState>()(
    persist(
        (set, get) => ({
            remoteConfigs: {},
            setRemoteConfig: (remote: string, config: RemoteConfig) =>
                set((state) => ({
                    remoteConfigs: { ...state.remoteConfigs, [remote]: config },
                })),
            mergeRemoteConfig: (remote: string, config: RemoteConfig) =>
                set((state) => ({
                    remoteConfigs: {
                        ...state.remoteConfigs,
                        [remote]: { ...state.remoteConfigs[remote], ...config },
                    },
                })),

            proxy: undefined,

            favoritePaths: [],

            scheduledTasks: [],
            addScheduledTask: (
                task: Omit<
                    ScheduledTask,
                    'id' | 'isRunning' | 'currentRunId' | 'lastRun' | 'configId' | 'isEnabled'
                >
            ) => {
                const state = get()
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
                        } as ScheduledTask,
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
                        t.id === id ? ({ ...t, ...task } as ScheduledTask) : t
                    ),
                })),

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
                    activeConfigFile:
                        state.activeConfigFile?.id === id
                            ? { ...state.activeConfigFile, ...configFile }
                            : state.activeConfigFile,
                })),

            lastSkippedVersion: undefined,
        }),
        {
            name: 'host-store',
            storage: createJSONStorage(getStorage),
            skipHydration: true,
            version: 1,
        }
    )
)
