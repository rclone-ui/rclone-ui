import { invoke } from '@tauri-apps/api/core'
import { fetch } from '@tauri-apps/plugin-http'
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

    const validationResponse = await fetch('https://rcloneui.com/api/v1/validate', {
        method: 'POST',
        body: JSON.stringify({
            licenseKey,
            id,
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

export async function revokeLicense(licenseKey: string) {
    console.log('[revokeLicense]')

    let id

    try {
        id = await invoke('get_uid')
    } catch (e) {
        console.error('[revokeLicense] failed to build unique identifier')
        console.error(JSON.stringify(e))
        throw new Error('Failed to build unique identifier. Please try again later.')
    }

    if (!id) {
        console.error('[revokeLicense] missing unique identifier')
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
            console.error('[revokeLicense] failed to revoke license, fetch failed')
            console.error(JSON.stringify(e))
            throw new Error('Failed to revoke license. Are you connected to the internet?')
        })

    if (revocationResponse.error) {
        console.error('[revokeLicense] failed to revoke license, has error response')
        throw new Error(revocationResponse.error)
    }

    if (!revocationResponse.revoked) {
        console.error('[revokeLicense] failed to revoke license, missing revoked response')
        throw new Error('Failed to revoke license. Please check your license key and try again.')
    }

    usePersistedStore.setState({ licenseKey: undefined, licenseValid: false })

    console.log('[revokeLicense] license revoked')
}
