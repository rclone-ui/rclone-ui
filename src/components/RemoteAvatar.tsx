import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import rclone from '../../lib/rclone/client'

export default function RemoteAvatar({ remote, size = 4 }: { remote: string; size?: number }) {
    const remoteConfigQuery = useQuery({
        queryKey: ['remote', remote, 'config'],
        queryFn: async () => {
            return await rclone('/config/get', {
                params: {
                    query: {
                        name: remote,
                    },
                },
            })
        },
    })

    const info = useMemo(() => remoteConfigQuery.data ?? null, [remoteConfigQuery.data])

    const avatarSrc = useMemo(
        () =>
            info
                ? info.provider && !info.type
                    ? `/icons/providers/${info.provider}.png`
                    : `/icons/backends/${info.type}.png`
                : undefined,
        [info]
    )

    return (
        <div className={`min-w-${size} min-h-${size}`}>
            <img src={avatarSrc} className={`object-contain w-${size} h-${size}`} alt={remote} />
        </div>
    )
}
