export type SelectItem = { path: string; type: 'file' | 'folder' }

export type RemoteString = string | 'UI_LOCAL_FS' | 'UI_FAVORITES' | null

export type Entry = {
    key: string
    name: string
    isDir: boolean
    size?: number
    modTime?: string
    mimeType?: string
    remote?: string | 'UI_LOCAL_FS'
    fullPath: string
}

export type PaddingItem = {
    key: string
    padding: true
}

export type VirtualizedEntry = Entry & { isSelected: boolean }

export type AllowedKey = 'REMOTES' | 'LOCAL_FS' | 'FAVORITES'

export type ContextMenuItem = {
    key: string
    label: string
    icon?: React.ReactNode
    color?: 'default' | 'primary' | 'secondary' | 'success' | 'warning' | 'danger'
    onPress: (entry: Entry) => void
}

export type FilePanelHandle = {
    refresh: () => void
    getSelection: () => SelectItem[]
    clearSelection: () => void
    selectAll: (type: 'files' | 'folders' | 'all') => void
    navigate: (remote: string, path: string) => void
    getCurrentPath: () => { remote: RemoteString; path: string }
}
