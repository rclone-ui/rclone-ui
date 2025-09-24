export const RCLONE_CONFIG_DEFAULTS = {
    'MultiThreadCutoff': '64M',
    'MultiThreadStreams': 8,
    'MultiThreadChunkSize': '8M',
    'UseListR': true,
    'UseServerModTime': true,
    'BufferSize': '32M',
    'Transfers': 8,
    'Checkers': 16,
}

export const RCLONE_VFS_DEFAULTS = {
    'ChunkSize': '4M',
    'ChunkStreams': 16,
}

export const RCLONE_CONF_REGEX = /[\/\\]rclone\.conf$/
export const DOUBLE_BACKSLASH_REGEX = /\\\\/g

export const SUPPORTED_BACKENDS = [
    'sftp',
    's3',
    'b2',
    'drive',
    'dropbox',
    'ftp',
    'azurefiles',
    'azureblob',
    'gcs',
    'protondrive',
    'box',
    'webdav',
    'onedrive',
    'http',
]
