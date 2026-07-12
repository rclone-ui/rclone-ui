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
        'vfs_read_chunk_size': '4M',
        'vfs_read_chunk_streams': 16,
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

// Backend capabilities are no longer hardcoded here. They are read per-remote from the rclone RC
// `operations/fsinfo` endpoint (see `fsInfoQueryOptions` / `hasFeature` in lib/hooks.ts), which is
// authoritative and correct for wrapping backends (crypt/alias/union) that static type lists could
// not express.
