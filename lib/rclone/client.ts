import { ask, message } from '@tauri-apps/plugin-dialog'
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import pRetry from 'p-retry'
import createRCDClient, {
    type AsyncJobResponse,
    type OpenApiMethodResponse,
    type OpenApiClient,
    type OpenApiClientPathsWithMethod,
    type OpenApiMaybeOptionalInit,
    type OpenApiRequiredKeysOf,
    type RCDClient,
} from 'rclone-sdk'
import { selectCurrentHost, usePersistedStore } from '../../store/persisted'

const RE_RECONNECT = /rclone config reconnect (\S+?):/

async function handleReconnectIfNeeded(errorMessage: string) {
    const match = errorMessage.match(RE_RECONNECT)
    if (!match) return
    const remoteName = match[1]
    const confirmed = await ask(
        `Remote "${remoteName}" needs to be reconnected. This usually means the authentication token has expired.\n\nWould you like to reconnect now?`,
        {
            title: 'Reconnect Remote',
            kind: 'warning',
            okLabel: 'Reconnect',
            cancelLabel: 'Dismiss',
        }
    )
    if (!confirmed) return
    try {
        const { reconnectRemote } = await import('./api')
        await reconnectRemote(remoteName)
        await message(`Remote "${remoteName}" has been reconnected successfully.`, {
            title: 'Reconnected',
            kind: 'info',
        })
    } catch (err) {
        await message(err instanceof Error ? err.message : 'Reconnection failed', {
            title: 'Reconnect Error',
            kind: 'error',
        })
    }
}

// const client = createRCDClient({
//     baseUrl: 'http://localhost:5572',
//     fetch: (request: Request) => tauriFetch(request),
// })

let client: RCDClient | null = null

function getClient() {
    if (!client) {
        const currentHost = selectCurrentHost(usePersistedStore.getState())
        if (!currentHost) {
            console.error('[rclone] No current host')
            throw new Error('No current host')
        }

        let authHeader = ''
        if (currentHost.authUser && currentHost.authPassword) {
            authHeader = `Basic ${btoa(`${currentHost.authUser}:${currentHost.authPassword}`)}`
        }

        client = createRCDClient({
            baseUrl: currentHost.url,
            headers: authHeader
                ? {
                      'Authorization': authHeader,
                  }
                : undefined,
            fetch: (request: Request) => tauriFetch(request),
        })
    }
    return client
}

export function clearClient() {
    client = null
}

type ClientPaths<T> = T extends OpenApiClient<infer P, any> ? P : never
type Paths = ClientPaths<RCDClient>
type InitParam<Init> = OpenApiRequiredKeysOf<Init> extends never
    ? [(Init & { [key: string]: unknown })?]
    : [Init & { [key: string]: unknown }]

type RequestResult = {
    error?: unknown
    data?: unknown
    response: Response
}

// Shared transport core for the sync (POST) and async (ASYNC) RC calls. The two exported wrappers
// differ only in the client method, the log prefix, and the return cast; everything else — client
// acquisition and the 3-branch error triage — is identical and has always been patched in both.
async function request(mode: 'sync' | 'async', path: string, init: any[]): Promise<unknown> {
    const label = mode === 'async' ? 'ASYNC ' : ''

    console.log(`[rclone] ${label}REQUEST`, path, {
        params: init[0]?.params,
        body: init[0]?.body,
    })

    const client = await pRetry(() => getClient(), {
        'maxTimeout': 500,
    }) //! for some reason this still fails sometimes

    if (!client) {
        console.error('[rclone] ERROR: Failed to get client after retries', path)
        throw new Error('Failed to get client after retries')
    }

    const result = (
        mode === 'async'
            ? await client.ASYNC(path as any, ...(init as [any]))
            : await client.POST(path as any, ...(init as [any]))
    ) as RequestResult

    if (result?.error) {
        console.error('[rclone] ERROR', path, { error: result.error })
        const errMsg =
            typeof result.error === 'string' ? result.error : JSON.stringify(result.error)

        await handleReconnectIfNeeded(errMsg)
        throw new Error(errMsg)
    }

    const data = result.data as { error?: unknown } | undefined
    if (data?.error) {
        console.error('[rclone] DATA ERROR', path, { error: data.error })
        const errMsg = typeof data.error === 'string' ? data.error : JSON.stringify(data.error)

        await handleReconnectIfNeeded(errMsg)
        throw new Error(errMsg)
    }

    if (!result.response.ok) {
        console.error('[rclone] HTTP ERROR', path, {
            status: result.response.status,
            statusText: result.response.statusText,
        })
        throw new Error(`${result.response.status} ${result.response.statusText}`)
    }

    console.log(`[rclone] ${label}RESPONSE`, path, { hasData: !!result.data })

    return result.data
}

export default async function rclone<
    Path extends OpenApiClientPathsWithMethod<RCDClient, 'post'>,
    Init extends OpenApiMaybeOptionalInit<Paths[Path], 'post'> = OpenApiMaybeOptionalInit<
        Paths[Path],
        'post'
    >,
>(
    path: Path,
    ...init: InitParam<Init>
): Promise<OpenApiMethodResponse<RCDClient, 'post', Path, Init>> {
    return (await request('sync', path, init)) as OpenApiMethodResponse<
        RCDClient,
        'post',
        Path,
        Init
    >
}

export async function rcloneAsync<
    Path extends OpenApiClientPathsWithMethod<RCDClient, 'post'>,
    Init extends OpenApiMaybeOptionalInit<Paths[Path], 'post'> = OpenApiMaybeOptionalInit<
        Paths[Path],
        'post'
    >,
>(path: Path, ...init: InitParam<Init>): Promise<AsyncJobResponse> {
    return (await request('async', path, init)) as AsyncJobResponse
}
