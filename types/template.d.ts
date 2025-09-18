export interface Template {
    id: string
    name: string
    operation: 'copy' | 'sync' | 'move' | 'delete' | 'purge'
    options: Record<string, any>
}
