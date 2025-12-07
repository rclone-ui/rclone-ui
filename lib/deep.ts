import { openWindow } from './window'

export function getDeepLinkUrl(url: string) {
    let cleanedUrl = url.replace('rclone:', '')
    while (cleanedUrl.startsWith('/')) {
        cleanedUrl = cleanedUrl.slice(1)
    }
    return cleanedUrl
}

export function handleDeepLinkUrl(url: string) {
    console.log('deep link url', url)

    const domain = url.split('/')[0]

    if (domain === 'add-template') {
        return openWindow({ name: 'Templates', url: '/templates?action=add' })
    }
}
