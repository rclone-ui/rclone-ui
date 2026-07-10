export const RCLONE_CONFIG_DEFAULTS = {
    copy: {
        'multi_thread_cutoff': '64M',
        'multi_thread_streams': 8,
        'multi_thread_chunk_size': '8M',
    },
    config: {
        'fast_list': true,
        'use_server_modtime': true,
        'buffer_size': '32M',
        'transfers': 8,
        'checkers': 16,
    },
    vfs: {
        'chunk_size': '4M',
        'chunk_streams': 16,
    },
} as const

export const RCLONE_CONF_REGEX = /[\/\\]rclone\.conf$/
export const DOUBLE_BACKSLASH_REGEX = /\\\\/g

// Minimum rclone version the app's RC surface requires. The Serve feature calls
// /serve/start|list|stop|stopall, which rclone added in 1.70.
export const MIN_RCLONE_VERSION = '1.70.0'
export const RCLONE_RELEASES_API = 'https://api.github.com/repos/rclone/rclone/releases?per_page=30'
export const RCLONE_RELEASES_SHOWN = 20

export const SERVE_TYPES = ['dlna', 'ftp', 'sftp', 'http', 'nfs', 'restic', 's3', 'webdav'] as const

export const SUPPORTS_CLEANUP = [
    's3',
    'b2',
    'box',
    'filefabric',
    'filen',
    'drive',
    'internetarchive',
    'jottacloud',
    'mailru',
    'mega',
    'onedrive',
    'oos',
    'pcloud',
    'pikpak',
    'putio',
    'protondrive',
    'qingstor',
    'seafile',
    'yandex',
] as const

export const SUPPORTS_PURGE = [
    'netstorage',
    'box',
    'sharefile',
    'dropbox',
    'filefabric',
    'filescom',
    'filen',
    'gofile',
    'gcs',
    'drive',
    'hdfs',
    'hifile',
    'iclouddrive',
    'imagekit',
    'jottacloud',
    'koofr',
    'mailru',
    'mega',
    'azureblob',
    'onedrive',
    'opendrive',
    'swift',
    'pikpak',
    'pcloud',
    'pixeldrain',
    'premiumizeme',
    'putio',
    'protondrive',
    'quatrix',
    'seafile',
    'sugarsync',
    'storj',
    'webdav',
    'yandex',
    'zoho',
] as const

export const SUPPORTS_ABOUT = [
    'box',
    'dropbox',
    'gofile',
    'drive',
    'filen',
    'hdfs',
    'internetarchive',
    'jottacloud',
    'koofr',
    'mailru',
    'mega',
    'azurefiles',
    'onedrive',
    'opendrive',
    'swift',
    'pcloud',
    'pikpak',
    'pixeldrain',
    'premiumizeme',
    'putio',
    'protondrive',
    'quatrix',
    'seafile',
    'sftp',
    'webdav',
    'yandex',
    'zoho',
    'local',
] as const

export const SUPPORTS_LINK = [
    'b2',
    'box',
    'drive',
    'dropbox',
    'fichier',
    'filescom',
    'gofile',
    'imagekit',
    'internetarchive',
    'jottacloud',
    'koofr',
    'mailru',
    'mega',
    'onedrive',
    'pikpak',
    'pixeldrain',
    'premiumizeme',
    'pcloud',
    's3',
    'seafile',
    'storj',
    'sugarsync',
    'yandex',
] as const

export function supportsPublicLink(backendType?: string | null): boolean {
    if (!backendType) return false
    return SUPPORTS_LINK.includes(backendType.toLowerCase() as any)
}

export const CANNOT_PERSIST_EMPTY_FOLDERS = [
    's3',
    'gcs',
    'azureblob',
    'b2',
    'swift',
    'oracleobjectstorage',
    'oos',
    'qingstor',
    'storj',
    'memory',
]

export function supportsPersistentEmptyFolders(backendType?: string | null) {
    if (!backendType) return true
    return !CANNOT_PERSIST_EMPTY_FOLDERS.includes(backendType.toLowerCase())
}
