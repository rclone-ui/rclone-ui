import {
    FileIcon as FileIconLucide,
    FileTextIcon,
    FileImageIcon,
    FileVideoIcon,
    FileAudioIcon,
    FileArchiveIcon,
    FileCodeIcon,
    FileSpreadsheetIcon,
    FolderIcon,
    FileJson2Icon,
    FileTypeIcon,
} from 'lucide-react'
import { getFileExtension } from './utils'
import type { Entry } from './types'

const IMAGE_EXTENSIONS = new Set([
    'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico', 'tiff', 'tif', 'heic', 'heif', 'avif'
])

const VIDEO_EXTENSIONS = new Set([
    'mp4', 'webm', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'm4v', 'mpg', 'mpeg', '3gp', 'ogv'
])

const AUDIO_EXTENSIONS = new Set([
    'mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'wma', 'opus', 'aiff', 'mid', 'midi'
])

const ARCHIVE_EXTENSIONS = new Set([
    'zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'tgz', 'tbz2', 'lz', 'lzma', 'cab', 'iso', 'dmg'
])

const CODE_EXTENSIONS = new Set([
    'js', 'ts', 'jsx', 'tsx', 'py', 'rb', 'java', 'c', 'cpp', 'h', 'hpp', 'cs', 'go', 'rs',
    'php', 'swift', 'kt', 'scala', 'sh', 'bash', 'zsh', 'ps1', 'bat', 'cmd', 'lua', 'r',
    'pl', 'pm', 'ex', 'exs', 'erl', 'hrl', 'clj', 'cljs', 'hs', 'ml', 'fs', 'vb', 'asm', 's'
])

const CONFIG_EXTENSIONS = new Set([
    'json', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'config', 'env', 'properties'
])

const DOCUMENT_EXTENSIONS = new Set([
    'pdf', 'doc', 'docx', 'odt', 'rtf', 'pages'
])

const SPREADSHEET_EXTENSIONS = new Set([
    'xls', 'xlsx', 'csv', 'ods', 'numbers'
])

const PRESENTATION_EXTENSIONS = new Set([
    'ppt', 'pptx', 'odp', 'key'
])

const TEXT_EXTENSIONS = new Set([
    'txt', 'md', 'markdown', 'rst', 'log', 'readme', 'license', 'changelog', 'todo'
])

export type FileType = 
    | 'folder'
    | 'image'
    | 'video'
    | 'audio'
    | 'archive'
    | 'code'
    | 'config'
    | 'document'
    | 'spreadsheet'
    | 'presentation'
    | 'text'
    | 'unknown'

export function getFileType(entry: Entry): FileType {
    if (entry.isDir) return 'folder'
    
    const ext = getFileExtension(entry.name)
    
    if (IMAGE_EXTENSIONS.has(ext)) return 'image'
    if (VIDEO_EXTENSIONS.has(ext)) return 'video'
    if (AUDIO_EXTENSIONS.has(ext)) return 'audio'
    if (ARCHIVE_EXTENSIONS.has(ext)) return 'archive'
    if (CODE_EXTENSIONS.has(ext)) return 'code'
    if (CONFIG_EXTENSIONS.has(ext)) return 'config'
    if (DOCUMENT_EXTENSIONS.has(ext)) return 'document'
    if (SPREADSHEET_EXTENSIONS.has(ext)) return 'spreadsheet'
    if (PRESENTATION_EXTENSIONS.has(ext)) return 'presentation'
    if (TEXT_EXTENSIONS.has(ext)) return 'text'
    
    return 'unknown'
}

export function isPreviewable(entry: Entry): boolean {
    const type = getFileType(entry)
    return type === 'image' || type === 'video' || type === 'audio' || type === 'text' || type === 'document'
}

const ICON_SIZE_MAP = {
    sm: 'size-4',
    md: 'size-5',
    lg: 'size-6',
} as const

export default function FileIcon({
    entry,
    size = 'md',
}: {
    entry: Entry
    size?: 'sm' | 'md' | 'lg'
}) {
    const sizeClass = ICON_SIZE_MAP[size]
    const type = getFileType(entry)
    
    switch (type) {
        case 'folder':
            return <FolderIcon className={`${sizeClass} text-warning`} />
        case 'image':
            return <FileImageIcon className={`${sizeClass} text-success`} />
        case 'video':
            return <FileVideoIcon className={`${sizeClass} text-danger`} />
        case 'audio':
            return <FileAudioIcon className={`${sizeClass} text-secondary`} />
        case 'archive':
            return <FileArchiveIcon className={`${sizeClass} text-warning`} />
        case 'code':
            return <FileCodeIcon className={`${sizeClass} text-primary`} />
        case 'config':
            return <FileJson2Icon className={`${sizeClass} text-default-500`} />
        case 'document':
            return <FileTypeIcon className={`${sizeClass} text-danger`} />
        case 'spreadsheet':
            return <FileSpreadsheetIcon className={`${sizeClass} text-success`} />
        case 'presentation':
            return <FileTypeIcon className={`${sizeClass} text-warning`} />
        case 'text':
            return <FileTextIcon className={`${sizeClass} text-default-600`} />
        default:
            return <FileIconLucide className={`${sizeClass} text-default-400`} />
    }
}
