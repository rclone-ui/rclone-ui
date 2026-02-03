import { Button, ScrollShadow, Tooltip, cn } from '@heroui/react'
import { useQuery } from '@tanstack/react-query'
import { platform } from '@tauri-apps/plugin-os'
import { LaptopIcon, StarIcon } from 'lucide-react'
import rclone from '../../../lib/rclone/client.ts'
import type { AllowedKey, RemoteString } from './types'

function RemoteButton({
    remote,
    onSelect,
    isSelected,
}: {
    remote: string
    onSelect: (remote: string) => void
    isSelected: boolean
}) {
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

    const info = remoteConfigQuery.data ?? null

    return (
        <Tooltip content={remote} placement="right" size="lg" color="foreground">
            <Button
                isIconOnly={true}
                size="lg"
                variant={isSelected ? 'faded' : 'light'}
                onPress={() => onSelect(remote)}
                className="shrink-0"
            >
                <img
                    src={`/icons/backends/${info?.type}.png`}
                    className="object-contain size-6"
                    alt={info?.type}
                />
            </Button>
        </Tooltip>
    )
}

export default function RemoteSidebar({
    position,
    selectedRemote,
    onRemoteSelect,
    allowedKeys,
    remotes,
}: {
    position: 'left' | 'right'
    selectedRemote: RemoteString
    onRemoteSelect: (remote: string | 'UI_LOCAL_FS' | 'UI_FAVORITES') => void
    allowedKeys: AllowedKey[]
    remotes: string[]
}) {
    const canShowFavorites = allowedKeys.includes('FAVORITES')
    const canShowLocal = allowedKeys.includes('LOCAL_FS')
    const canShowRemotes = allowedKeys.includes('REMOTES')

    const orderClass = position === 'right' ? 'order-last' : 'order-first'

    return (
        <div className={cn('flex flex-col items-center w-20 h-full shrink-0', orderClass)}>
            <ScrollShadow
                className={cn(
                    'flex flex-col items-center w-full h-full gap-5 py-4 overflow-y-auto',
                    platform() === 'macos' && 'pt-8'
                )}
                size={69}
            >
                {canShowFavorites && (
                    <Tooltip
                        content="Favorites"
                        placement={position === 'left' ? 'right' : 'left'}
                        size="lg"
                        color="foreground"
                    >
                        <Button
                            isIconOnly={true}
                            className="shrink-0"
                            size="lg"
                            variant={selectedRemote === 'UI_FAVORITES' ? 'faded' : 'light'}
                            onPress={() => onRemoteSelect('UI_FAVORITES')}
                        >
                            <StarIcon className="stroke-warning fill-warning size-6" />
                        </Button>
                    </Tooltip>
                )}
                {canShowLocal && (
                    <Tooltip
                        content="Local Filesystem"
                        placement={position === 'left' ? 'right' : 'left'}
                        color="foreground"
                        size="lg"
                    >
                        <Button
                            isIconOnly={true}
                            className="shrink-0"
                            size="lg"
                            onPress={() => onRemoteSelect('UI_LOCAL_FS')}
                            variant={selectedRemote === 'UI_LOCAL_FS' ? 'faded' : 'light'}
                        >
                            <LaptopIcon className="size-6" />
                        </Button>
                    </Tooltip>
                )}
                {canShowRemotes &&
                    remotes.map((remote) => (
                        <RemoteButton
                            remote={remote}
                            key={remote}
                            onSelect={() => onRemoteSelect(remote)}
                            isSelected={selectedRemote === remote}
                        />
                    ))}
            </ScrollShadow>
        </div>
    )
}
