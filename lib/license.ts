import { invoke } from '@tauri-apps/api/core'
import { fetch } from '@tauri-apps/plugin-http'
import { platform } from '@tauri-apps/plugin-os'
import { usePersistedStore } from './store'

export async function validateLicense(licenseKey: string) {
    console.log('[validateLicense]')

    let id

    try {
        id = await invoke('get_uid')
    } catch (e) {
        console.error('[validateLicense] failed to build unique identifier')
        console.error(JSON.stringify(e))
        throw new Error('Failed to build unique identifier. Please try again later.')
    }

    if (!id) {
        console.error('[validateLicense] missing unique identifier')
        throw new Error('Failed to build unique identifier. Please try again later.')
    }

    const validationResponse = await fetch('https://rcloneui.com/api/v2/validate', {
        method: 'POST',
        body: JSON.stringify({
            licenseKey,
            id,
            platform: platform(),
        }),
    })
        .then((r) => r.json())
        .catch((e) => {
            console.error('[validateLicense] failed to validate license')
            console.error(JSON.stringify(e))
            throw new Error('Failed to validate license. Are you connected to the internet?')
        })

    if (validationResponse.error) {
        console.error('[validateLicense] failed to validate license')
        throw new Error(validationResponse.error)
    }

    if (!validationResponse.valid) {
        console.error('[validateLicense] invalid license key')
        throw new Error('Invalid license key. Please check your license key and try again.')
    }

    usePersistedStore.setState({ licenseKey, licenseValid: true })

    console.log('[validateLicense] license validated')
}

export async function revokeMachineLicense(licenseKey: string) {
    console.log('[revokeMachineLicense]')

    let id

    try {
        id = await invoke('get_uid')
    } catch (e) {
        console.error('[revokeMachineLicense] failed to build unique identifier')
        console.error(JSON.stringify(e))
        throw new Error('Failed to build unique identifier. Please try again later.')
    }

    if (!id) {
        console.error('[revokeMachineLicense] missing unique identifier')
        throw new Error('Failed to build unique identifier. Please try again later.')
    }

    const revocationResponse = await fetch('https://rcloneui.com/api/v1/revoke', {
        method: 'POST',
        body: JSON.stringify({
            licenseKey,
            id,
        }),
    })
        .then((r) => r.json())
        .catch((e) => {
            console.error('[revokeMachineLicense] failed to revoke license, fetch failed')
            console.error(JSON.stringify(e))
            throw new Error('Failed to revoke license. Are you connected to the internet?')
        })

    if (revocationResponse.error) {
        console.error('[revokeMachineLicense] failed to revoke license, has error response')
        throw new Error(revocationResponse.error)
    }

    if (!revocationResponse.revoked) {
        console.error('[revokeMachineLicense] failed to revoke license, missing revoked response')
        throw new Error('Failed to revoke license. Please check your license key and try again.')
    }

    usePersistedStore.setState({ licenseKey: undefined, licenseValid: false })

    console.log('[revokeMachineLicense] license revoked')
}
