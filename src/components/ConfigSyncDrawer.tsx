import {
    Drawer,
    DrawerBody,
    DrawerContent,
    DrawerFooter,
    DrawerHeader,
    Input,
    Switch,
} from '@heroui/react'
import { Button } from '@heroui/react'
import { message, open } from '@tauri-apps/plugin-dialog'
import { exists, readTextFile } from '@tauri-apps/plugin-fs'
import { platform } from '@tauri-apps/plugin-os'
import { UploadIcon } from 'lucide-react'
import { useCallback, useState } from 'react'
import { usePersistedStore } from '../../lib/store'
import type { ConfigFile } from '../../types/config'

export default function ConfigSyncDrawer({
    onClose,
    isOpen,
}: {
    onClose: () => void
    isOpen: boolean
}) {
    const [config, setConfig] = useState<Partial<ConfigFile>>({
        label: 'New Config',
    })

    const [isPasswordCommand, setIsPasswordCommand] = useState(false)

    const [isSaving, setIsSaving] = useState(false)

    const handleCreate = useCallback(
        async ({
            label,
            pass,
            isEncrypted,
            passCommand,
            sync,
        }: {
            label?: string
            sync?: string
            isEncrypted?: boolean
            pass?: string
            passCommand?: string
        }) => {
            try {
                if (!label) {
                    throw new Error('Label is required')
                }

                if (!sync) {
                    throw new Error('Path is required')
                }

                if (isEncrypted) {
                    if (!pass && !passCommand) {
                        throw new Error('Password is required for encrypted configs')
                    }
                }

                setIsSaving(true)

                const generatedId = crypto.randomUUID()

                usePersistedStore.getState().addConfigFile({
                    id: generatedId,
                    label,
                    isEncrypted: isEncrypted || false,
                    pass,
                    passCommand,
                    sync,
                })

                onClose()
            } catch (error) {
                console.error('[handleCreate] failed to save config', error)
                await message(
                    error instanceof Error ? error.message : 'An unknown error occurred',
                    {
                        title: 'Failed to save config',
                        kind: 'error',
                        okLabel: 'OK',
                    }
                )
            } finally {
                setIsSaving(false)
            }
        },
        [onClose]
    )

    return (
        <Drawer
            isOpen={isOpen}
            placement={'bottom'}
            size="full"
            onClose={onClose}
            hideCloseButton={true}
        >
            <DrawerContent>
                {(close) => (
                    <>
                        <DrawerHeader className="flex flex-col gap-1">Sync Config</DrawerHeader>
                        <DrawerBody>
                            <form
                                id="config-form"
                                className="flex flex-col gap-5"
                                onSubmit={(e) => {
                                    e.preventDefault()
                                    handleCreate({
                                        label: config.label,
                                        pass: isPasswordCommand ? undefined : config.pass,
                                        isEncrypted: config.isEncrypted,
                                        passCommand: isPasswordCommand
                                            ? config.passCommand
                                            : undefined,
                                        sync: config.sync,
                                    })
                                }}
                            >
                                <Switch
                                    size="lg"
                                    isSelected={config.isEncrypted}
                                    onValueChange={() =>
                                        setConfig({ ...config, isEncrypted: !config.isEncrypted })
                                    }
                                    color="primary"
                                >
                                    Encrypted
                                </Switch>

                                <Input
                                    label="Name"
                                    labelPlacement="outside"
                                    placeholder="Enter a name for your config"
                                    type="text"
                                    value={config.label}
                                    autoCapitalize="off"
                                    autoComplete="off"
                                    autoCorrect="off"
                                    spellCheck="false"
                                    onValueChange={(value) => {
                                        setConfig({ ...config, label: value })
                                    }}
                                    isClearable={true}
                                    onClear={() => {
                                        setConfig({ ...config, label: '' })
                                    }}
                                    size="lg"
                                />

                                {config.isEncrypted && (
                                    <Input
                                        label={
                                            <div className="flex items-center gap-1.5">
                                                <p className="text-medium">Password</p>
                                                <Switch
                                                    size="sm"
                                                    isSelected={isPasswordCommand}
                                                    onValueChange={() =>
                                                        setIsPasswordCommand(!isPasswordCommand)
                                                    }
                                                    color="primary"
                                                >
                                                    Command
                                                </Switch>
                                            </div>
                                        }
                                        labelPlacement="outside"
                                        placeholder={
                                            isPasswordCommand
                                                ? 'Enter the password command for your config file'
                                                : 'Enter the password for your config file'
                                        }
                                        type={isPasswordCommand ? 'text' : 'password'}
                                        value={isPasswordCommand ? config.passCommand : config.pass}
                                        autoCapitalize="off"
                                        autoComplete="off"
                                        autoCorrect="off"
                                        spellCheck="false"
                                        onValueChange={(value) => {
                                            setConfig({
                                                ...config,
                                                ...(isPasswordCommand
                                                    ? { passCommand: value }
                                                    : { pass: value }),
                                            })
                                        }}
                                        isClearable={true}
                                        onClear={() => {
                                            setConfig({
                                                ...config,
                                                ...(isPasswordCommand
                                                    ? { passCommand: '' }
                                                    : { pass: '' }),
                                            })
                                        }}
                                        size="lg"
                                    />
                                )}

                                <Input
                                    label={
                                        <div className="flex items-center gap-1.5">
                                            <p className="text-medium">Config</p>
                                            <Button
                                                isIconOnly={true}
                                                variant="light"
                                                size="sm"
                                                onPress={async () => {
                                                    try {
                                                        let selectedFolder = await open({
                                                            directory: true,
                                                            multiple: false,
                                                            title: 'Select the root directory of your config file',
                                                        })

                                                        if (!selectedFolder) {
                                                            return
                                                        }

                                                        if (
                                                            selectedFolder.endsWith('/') ||
                                                            selectedFolder.endsWith('\\')
                                                        ) {
                                                            selectedFolder = selectedFolder.slice(
                                                                0,
                                                                -1
                                                            )
                                                        }

                                                        if (!(await exists(selectedFolder))) {
                                                            throw new Error(
                                                                'The selected path does not exist'
                                                            )
                                                        }

                                                        const slashSymbol =
                                                            platform() === 'windows' ? '\\' : '/'

                                                        const configPath =
                                                            selectedFolder +
                                                            slashSymbol +
                                                            'rclone.conf'

                                                        let content: string | null = null

                                                        try {
                                                            content = await readTextFile(configPath)
                                                        } catch {
                                                            throw new Error(
                                                                'Could not find an rclone.conf file in the selected folder'
                                                            )
                                                        }

                                                        if (!content) {
                                                            throw new Error(
                                                                'Empty rclone.conf file'
                                                            )
                                                        }

                                                        setConfig({
                                                            ...config,
                                                            label:
                                                                config.label ||
                                                                configPath
                                                                    .split(slashSymbol)
                                                                    .pop() ||
                                                                'New Config',
                                                            sync: selectedFolder,
                                                        })
                                                    } catch (error) {
                                                        await message(
                                                            error instanceof Error
                                                                ? error.message
                                                                : 'An unknown error occurred',
                                                            {
                                                                title: 'Failed to sync config',
                                                                kind: 'error',
                                                                okLabel: 'OK',
                                                            }
                                                        )
                                                    }
                                                }}
                                            >
                                                <UploadIcon className="w-4 h-4" />
                                            </Button>
                                        </div>
                                    }
                                    labelPlacement="outside"
                                    placeholder="Select the folder containing your rclone.conf file"
                                    value={config.sync || ''}
                                    onValueChange={(value) => {
                                        console.log(value)
                                        setConfig({ ...config, sync: value })
                                    }}
                                    autoCapitalize="off"
                                    autoComplete="off"
                                    autoCorrect="off"
                                    spellCheck="false"
                                    type="textarea"
                                    size="lg"
                                    isClearable={true}
                                    onClear={() => {
                                        setConfig({ ...config, sync: '' })
                                    }}
                                    data-focus-visible="false"
                                />
                            </form>
                        </DrawerBody>
                        <DrawerFooter>
                            <Button
                                color="danger"
                                variant="light"
                                onPress={close}
                                data-focus-visible="false"
                            >
                                Close
                            </Button>
                            <Button
                                color="primary"
                                type="submit"
                                form="config-form"
                                isDisabled={isSaving}
                                data-focus-visible="false"
                            >
                                {isSaving ? 'Saving...' : 'Sync'}
                            </Button>
                        </DrawerFooter>
                    </>
                )}
            </DrawerContent>
        </Drawer>
    )
}
