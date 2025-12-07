import type { FlagValue } from './rclone'

export interface Template {
    id: string
    name: string
    tags: ('copy' | 'sync' | 'move' | 'delete' | 'purge' | 'serve' | 'mount' | 'bisync')[]
    options: Record<string, FlagValue>
}
