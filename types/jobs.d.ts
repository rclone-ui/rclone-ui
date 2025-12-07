export type JobItem = {
    id: number
    type: 'active' | 'inactive'
    bytes: number
    totalBytes: number
    speed: number
    done: boolean
    progress: number
    hasError: boolean
    sources: string[]
}
