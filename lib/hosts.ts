import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import pRetry from 'p-retry'
import createRCDClient from 'rclone-sdk'

export interface Host {
    id: 'local' | string
    name: string
    cliVersion: string
    os: 'windows' | 'macos' | 'linux'
    url: string
    authUser?: string
    authPassword?: string
}

export const LOCAL_HOST_ID = 'local' as const

export const LABEL_FOR_OS = {
    windows: 'Windows',
    macos: 'macOS',
    linux: 'Linux',
} as const

export async function getHostInfo({
    url,
    authUser,
    authPassword,
}: {
    url: string
    authUser?: string
    authPassword?: string
}) {
    try {
        const parsedUrl = new URL(url)
        if (!parsedUrl.hostname) {
            return null
        }
    } catch {
        return null
    }

    let authHeader = ''
    if (authUser && authPassword) {
        authHeader = `Basic ${btoa(`${authUser}:${authPassword}`)}`
    }

    console.log('[getHostInfo] authHeader', authHeader)

    const rcloneClient = createRCDClient({
        baseUrl: url,
        headers: authHeader
            ? {
                  'Authorization': authHeader,
              }
            : undefined,
        fetch: (request: Request) => tauriFetch(request),
    })

    console.log('[getHostInfo] rcloneClient', rcloneClient)

    const infoResponse = await pRetry(
        () =>
            rcloneClient.POST('/core/version').then((res) => {
                if (!res || !res.data || res.error) {
                    throw new Error('Failed to get rclone version')
                }
                return res.data
            }),
        {
            retries: 3,
            factor: 2,
            minTimeout: 1000,
            maxTimeout: 10000,
        }
    )

    console.log('[getHostInfo] infoResponse', infoResponse)

    const { os, version } = infoResponse

    const cleanedVersion = version.replace(/^v/, '')
    const parsedOs = os === 'windows' ? 'windows' : os === 'darwin' ? 'macos' : 'linux'

    return {
        cliVersion: cleanedVersion,
        os: parsedOs,
    } as const
}
