import { useEffect, useState } from 'react'
import { getRemote } from '../../lib/rclone/api'

export default function RemoteAvatar({ remote, size = 4 }: { remote: string; size?: number }) {
    const [remoteData, setRemoteData] = useState<{ type: string; provider?: string } | null>(null)

    const avatarSrc = remoteData
        ? remoteData.provider
            ? `/icons/providers/${remoteData.provider}.png`
            : `/icons/backends/${remoteData.type}.png`
        : undefined

    useEffect(() => {
        getRemote(remote).then(setRemoteData)
    }, [remote])

    return (
        <div className={`min-w-${size} min-h-${size}`}>
            <img src={avatarSrc} className={`object-contain w-${size} h-${size}`} alt={remote} />
        </div>
    )
}
