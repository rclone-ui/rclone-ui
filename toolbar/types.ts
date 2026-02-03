export type ToolbarCommandId =
    | 'copy'
    | 'move'
    | 'sync'
    | 'mount'
    | 'download'
    | 'serve'
    | 'bisync'
    | 'delete'
    | 'purge'
    | 'cleanup'
    | 'browse'
    | 'settings'
    | 'github'
    | 'transfers'
    | 'schedules'
    | 'templates'
    | 'remoteCreate'
    | 'remoteEdit'
    | 'remoteAutoMount'
    | 'quit'
    | 'remoteList'
    | 'vfs'
    | 'commander'

export type ToolbarActionArgs = Record<string, any>

export interface ToolbarActionResult {
    label: string
    description?: string
    args: ToolbarActionArgs
    score?: number
}

export interface ToolbarActionOnPressContext {
    openWindow: (options: { name: string; url: string }) => Promise<unknown>
    updateText: (text: string) => void
}

export interface ToolbarActionPath {
    full: string
    readable: string
    isLocal: boolean
    remoteName?: string
    remoteType?: string
}

export interface ToolbarActionContext {
    query: string
    fullQuery: string
    paths: ToolbarActionPath[]
    remotes: string[]
}

export interface ToolbarActionDefaultContext {
    remotes: string[]
}

export interface ToolbarActionDefinition {
    id: ToolbarCommandId
    label: string
    description?: string
    keywords: string[]
    getResults: (context: ToolbarActionContext) => ToolbarActionResult[]
    getDefaultResult?: (context: ToolbarActionDefaultContext) => ToolbarActionResult
    onPress: (args: ToolbarActionArgs, context: ToolbarActionOnPressContext) => Promise<void> | void
}
