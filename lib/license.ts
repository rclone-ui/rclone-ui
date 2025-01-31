import { invoke } from '@tauri-apps/api/core'
import { fetch } from '@tauri-apps/plugin-http'
import { usePersistedStore } from './store'

export async function validateLicense(licenseKey: string) {
    let id

    try {
        id = await invoke('get_uid')
    } catch (e) {
        console.error(JSON.stringify(e))
        throw new Error('Failed to build unique identifier. Please try again later.')
    }

    if (!id) {
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
            console.error(JSON.stringify(e))
            throw new Error('Failed to validate license. Are you connected to the internet?')
        })

    // console.log(JSON.stringify(validationResponse))

    if (validationResponse.error) {
        throw new Error(validationResponse.error)
    }

    if (!validationResponse.valid) {
        throw new Error('Invalid license key. Please check your license key and try again.')
    }

    usePersistedStore.setState({ licenseKey, licenseValid: true })
}

export async function revokeLicense(licenseKey: string) {
    let id

    try {
        id = await invoke('get_uid')
    } catch (e) {
        console.error(JSON.stringify(e))
        throw new Error('Failed to build unique identifier. Please try again later.')
    }

    if (!id) {
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
            console.error(JSON.stringify(e))
            throw new Error('Failed to revoke license. Are you connected to the internet?')
        })

    // console.log(JSON.stringify(revocationResponse))

    if (revocationResponse.error) {
        throw new Error(revocationResponse.error)
    }

    if (!revocationResponse.revoked) {
        throw new Error('Failed to revoke license. Please check your license key and try again.')
    }

    usePersistedStore.setState({ licenseKey: undefined, licenseValid: false })
}
