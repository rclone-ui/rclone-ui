import { invoke } from '@tauri-apps/api/core'
import { fetch } from '@tauri-apps/plugin-http'
import { platform } from '@tauri-apps/plugin-os'
import { usePersistedStore } from '../store/persisted'

interface LicenseCallLogs {
    start: string
    uidFail: string
    uidMissing: string
    fetchFail: string
    errorResponse: string
}

// Shared scaffold for the license API calls: builds the machine id, POSTs to rcloneui.com, and
// runs the error triage. Per-branch log strings are passed in so each caller's logs stay identical.
async function licenseCall<T extends { error?: string }>(
    endpoint: string,
    licenseKey: string,
    extraBody: Record<string, unknown>,
    failVerb: string,
    logs: LicenseCallLogs
): Promise<T> {
    console.log(logs.start)

    let id

    try {
        id = await invoke('get_uid')
    } catch (e) {
        console.error(logs.uidFail)
        console.error(JSON.stringify(e))
        throw new Error('Failed to build unique identifier. Please try again later.')
    }

    if (!id) {
        console.error(logs.uidMissing)
        throw new Error('Failed to build unique identifier. Please try again later.')
    }

    const response = await fetch(`https://rcloneui.com${endpoint}`, {
        method: 'POST',
        body: JSON.stringify({
            licenseKey,
            id,
            ...extraBody,
        }),
    })
        .then((r) => r.json() as Promise<T>)
        .catch((e) => {
            console.error(logs.fetchFail)
            console.error(JSON.stringify(e))
            throw new Error(`Failed to ${failVerb} license. Are you connected to the internet?`)
        })

    if (response.error) {
        console.error(logs.errorResponse)
        throw new Error(response.error)
    }

    return response
}

export async function validateLicense(licenseKey: string) {
    const validationResponse = await licenseCall<{ error: string; valid: boolean }>(
        '/api/v2/validate',
        licenseKey,
        { platform: platform() },
        'validate',
        {
            start: '[validateLicense]',
            uidFail: '[validateLicense] failed to build unique identifier',
            uidMissing: '[validateLicense] missing unique identifier',
            fetchFail: '[validateLicense] failed to validate license',
            errorResponse: '[validateLicense] failed to validate license',
        }
    )

    if (!validationResponse.valid) {
        console.error('[validateLicense] invalid license key')
        throw new Error('Invalid license key. Please check your license key and try again.')
    }

    usePersistedStore.setState({ licenseKey, licenseValid: true })

    console.log('[validateLicense] license validated')
}

export async function revokeMachineLicense(licenseKey: string) {
    const revocationResponse = await licenseCall<{ error: string; revoked: boolean }>(
        '/api/v1/revoke',
        licenseKey,
        {},
        'revoke',
        {
            start: '[revokeMachineLicense]',
            uidFail: '[revokeMachineLicense] failed to build unique identifier',
            uidMissing: '[revokeMachineLicense] missing unique identifier',
            fetchFail: '[revokeMachineLicense] failed to revoke license, fetch failed',
            errorResponse: '[revokeMachineLicense] failed to revoke license, has error response',
        }
    )

    if (!revocationResponse.revoked) {
        console.error('[revokeMachineLicense] failed to revoke license, missing revoked response')
        throw new Error('Failed to revoke license. Please check your license key and try again.')
    }

    usePersistedStore.setState({ licenseKey: undefined, licenseValid: false })

    console.log('[revokeMachineLicense] license revoked')
}
