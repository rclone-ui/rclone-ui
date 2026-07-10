import type { LazyStore } from '@tauri-apps/plugin-store'
import type { StateStorage } from 'zustand/middleware'

// Single zustand<->tauri-plugin-store adapter shared by the persisted and per-host stores.
// `getStore` is resolved lazily on every call so the host store can swap its backing file.
// A null store makes every operation a no-op (getItem -> null), which the host store relies on
// before a host has been selected.
export function createTauriStateStorage(getStore: () => LazyStore | null): StateStorage {
    return {
        getItem: async (name: string): Promise<string | null> => {
            const store = getStore()
            if (!store) return null
            console.log('getItem', { name })
            return (await store.get(name)) ?? null
        },
        setItem: async (name: string, value: string): Promise<void> => {
            const store = getStore()
            if (!store) return
            console.log('setItem', { name })
            await store.set(name, value)
            await store.save()
        },
        removeItem: async (name: string): Promise<void> => {
            const store = getStore()
            if (!store) return
            console.log('removeItem', { name })
            await store.delete(name)
            await store.save()
        },
    }
}

// 50ms recursive poll until a persist store reports hydration. Callers log around it so each
// store keeps its own identifiable trace.
export async function waitForStoreHydration(hasHydrated: () => boolean): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 50))
    if (!hasHydrated()) {
        await waitForStoreHydration(hasHydrated)
    }
}
