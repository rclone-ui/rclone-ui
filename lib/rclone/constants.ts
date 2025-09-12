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
