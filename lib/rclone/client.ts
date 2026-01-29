import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import pRetry from 'p-retry'
import createRCDClient, {
    type OpenApiMethodResponse,
    type OpenApiClient,
    type OpenApiClientPathsWithMethod,
    type OpenApiMaybeOptionalInit,
    type OpenApiRequiredKeysOf,
    type RCDClient,
} from 'rclone-sdk'
import { usePersistedStore } from '../../store/persisted'

// const client = createRCDClient({
//     baseUrl: 'http://localhost:5572',
//     fetch: (request: Request) => tauriFetch(request),
// })

let client: RCDClient | null = null

function getClient() {
    if (!client) {
        const currentHost = usePersistedStore.getState().currentHost
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
    console.log('[rclone] REQUEST', path, {
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

    const result = await client.POST(
        path,
        ...(init as InitParam<OpenApiMaybeOptionalInit<Paths[Path], 'post'>>)
    )

    if (result?.error) {
        console.error('[rclone] ERROR', path, { error: result.error })
        const message =
            typeof result.error === 'string' ? result.error : JSON.stringify(result.error)

        throw new Error(message)
    }

    const data = result.data as { error?: unknown } | undefined
    if (data?.error) {
        console.error('[rclone] DATA ERROR', path, { error: data.error })
        const message = typeof data.error === 'string' ? data.error : JSON.stringify(data.error)

        throw new Error(message)
    }

    if (!result.response.ok) {
        console.error('[rclone] HTTP ERROR', path, {
            status: result.response.status,
            statusText: result.response.statusText,
        })
        throw new Error(`${result.response.status} ${result.response.statusText}`)
    }

    console.log('[rclone] RESPONSE', path, { hasData: !!result.data })

    return result.data as OpenApiMethodResponse<typeof client, 'post', Path, Init>
}
