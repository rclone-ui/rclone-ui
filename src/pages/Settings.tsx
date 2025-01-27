import { Button, Card, CardBody } from '@nextui-org/react'
import { confirm } from '@tauri-apps/plugin-dialog'
import { CableIcon, PencilIcon, Plus, Trash2Icon } from 'lucide-react'
import { useState } from 'react'
import { deleteRemote } from '../../lib/rclone/api'
import { useStore } from '../../lib/store'
import { triggerTrayRebuild } from '../../lib/tray'
import RemoteCreateDrawer from '../components/RemoteCreateDrawer'
import RemoteDefaultsDrawer from '../components/RemoteDefaultsDrawer'
import RemoteEditDrawer from '../components/RemoteEditDrawer'

function Settings() {
    return (
        <div className="flex flex-col">
            <RemotesSection />
        </div>
    )
}

const RemotesSection = () => {
    const remotes = useStore((state) => state.remotes)
    const removeRemote = useStore((state) => state.removeRemote)

    const [pickedRemote, setPickedRemote] = useState<string | null>(null)

    const [editingDrawerOpen, setEditingDrawerOpen] = useState(false)
    const [creatingDrawerOpen, setCreatingDrawerOpen] = useState(false)
    const [defaultsDrawerOpen, setDefaultsDrawerOpen] = useState(false)

    if (remotes.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen gap-4">
                <h1 className="text-2xl font-bold">No remotes found</h1>
                <Button
                    onPress={() => setCreatingDrawerOpen(true)}
                    color="primary"
                    data-focus-visible="false"
                >
                    Create Remote
                </Button>
            </div>
        )
    }

    return (
        <div className="flex flex-col gap-4">
            <div className="sticky top-0 z-50 flex items-center justify-between p-4 bg-neutral-900/50 backdrop-blur-lg">
                <h2 className="text-xl font-semibold">Remotes</h2>
                <Button
                    onPress={() => setCreatingDrawerOpen(true)}
                    isIconOnly={true}
                    variant="light"
                    data-focus-visible="false"
                >
                    <Plus className="w-5 h-5" />
                </Button>
            </div>
            <div className="flex flex-col gap-2 p-4">
                {remotes.map((remote) => (
                    <Card key={remote} shadow="sm">
                        <CardBody>
                            <div className="flex items-center justify-between">
                                <span>{remote}</span>
                                <div className="space-x-2">
                                    <Button
                                        onPress={() => {
                                            setPickedRemote(remote)
                                            setDefaultsDrawerOpen(true)
                                        }}
                                        isIconOnly={true}
                                        color="primary"
                                        variant="light"
                                        data-focus-visible="false"
                                    >
                                        <CableIcon className="w-4 h-4" />
                                    </Button>
                                    <Button
                                        onPress={() => {
                                            setPickedRemote(remote)
                                            setEditingDrawerOpen(true)
                                        }}
                                        isIconOnly={true}
                                        color="primary"
                                        variant="light"
                                        data-focus-visible="false"
                                    >
                                        <PencilIcon className="w-4 h-4" />
                                    </Button>
                                    <Button
                                        isIconOnly={true}
                                        color="danger"
                                        variant="light"
                                        onPress={async () => {
                                            const confirmation = await confirm(
                                                `Are you sure you want to remove ${remote}? This action cannot be reverted.`,
                                                { title: `Removing ${remote}`, kind: 'warning' }
                                            )

                                            if (!confirmation) {
                                                return
                                            }

                                            await deleteRemote(remote)
                                            removeRemote(remote)
                                            await triggerTrayRebuild()
                                        }}
                                        data-focus-visible="false"
                                    >
                                        <Trash2Icon className="w-4 h-4" />
                                    </Button>
                                </div>
                            </div>
                        </CardBody>
                    </Card>
                ))}
            </div>

            {pickedRemote && (
                <RemoteEditDrawer
                    isOpen={editingDrawerOpen}
                    onClose={() => {
                        setEditingDrawerOpen(false)
                        setTimeout(() => {
                            // allow for drawer effect to happen
                            setPickedRemote(null)
                        }, 100)
                    }}
                    remoteName={pickedRemote}
                />
            )}

            <RemoteCreateDrawer
                isOpen={creatingDrawerOpen}
                onClose={() => {
                    setCreatingDrawerOpen(false)
                }}
            />

            {pickedRemote && (
                <RemoteDefaultsDrawer
                    isOpen={defaultsDrawerOpen}
                    onClose={() => {
                        setDefaultsDrawerOpen(false)
                        setTimeout(() => {
                            // allow for drawer effect to happen
                            setPickedRemote(null)
                        }, 100)
                    }}
                    remoteName={pickedRemote}
                />
            )}
        </div>
    )
}

export default Settings
