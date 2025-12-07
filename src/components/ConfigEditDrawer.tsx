import {
    Drawer,
    DrawerBody,
    DrawerContent,
    DrawerFooter,
    DrawerHeader,
    Input,
    Switch,
    Textarea,
    cn,
} from '@heroui/react'
import { Button } from '@heroui/react'
import { useMutation } from '@tanstack/react-query'
import { message } from '@tauri-apps/plugin-dialog'
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { platform } from '@tauri-apps/plugin-os'
import { startTransition, useCallback, useEffect, useMemo, useState } from 'react'
import { getConfigPath } from '../../lib/rclone/common'
import { useHostStore } from '../../store/host'

export default function ConfigEditDrawer({
    id,
    onClose,
    isOpen,
}: {
    id?: string | null
    onClose: () => void
    isOpen: boolean
}) {
    const configFiles = useHostStore((state) => state.configFiles)
    const initialConfig = configFiles.find((c) => c.id === id)

    const [configLabel, setConfigLabel] = useState<string | null>(null)
    const [configPass, setConfigPass] = useState<string | null>(null)
    const [configPassCommand, setConfigPassCommand] = useState<string | null>(null)
    const [configContent, setConfigContent] = useState<string | null>(null)

    const [isPasswordCommand, setIsPasswordCommand] = useState(false)

    const isEncrypted = useMemo(
        () => configContent?.includes('RCLONE_ENCRYPT_V0:'),
        [configContent]
    )

    const updateConfigMutation = useMutation({
        mutationFn: async ({
            label,
            pass,
            content,
            passCommand,
            isPasswordCommand,
            isEncrypted,
        }: {
            label: string
            pass?: string
            content: string
            passCommand?: string
            isPasswordCommand?: boolean
            isEncrypted?: boolean
        }) => {
            if (!id) throw new Error('Config ID not found')

            const savedPass = isPasswordCommand ? undefined : pass
            const savedPassCommand = isPasswordCommand ? passCommand : undefined

            const configPath = await getConfigPath({ id: id, validate: true })
            await writeTextFile(configPath, content)

            useHostStore.getState().updateConfigFile(id, {
                label: label,
                pass: savedPass,
                passCommand: savedPassCommand,
                isEncrypted: !!isEncrypted,
            })

            return true
        },
        onSuccess: () => {
            onClose()
        },
        onError: async (error) => {
            console.error('[updateConfig] failed to save config', error)
            await message(error instanceof Error ? error.message : 'An unknown error occurred', {
                title: 'Failed to save config',
                kind: 'error',
                okLabel: 'OK',
            })
        },
    })

    const initializeConfig = useCallback(async () => {
        if (!initialConfig) {
            return
        }

        const configPath = await getConfigPath({ id: initialConfig.id!, validate: true })
        const text = await readTextFile(configPath)

        startTransition(() => {
            setConfigContent(text)
            setConfigLabel(initialConfig.label)
            setConfigPass(initialConfig.pass || null)
            setConfigPassCommand(initialConfig.passCommand || null)
            setIsPasswordCommand(initialConfig.passCommand !== null)
        })
    }, [initialConfig])

    useEffect(() => {
        if (isOpen && configContent === null && configLabel === null) {
            initializeConfig()
        }

        if (!isOpen) {
            startTransition(() => {
                setConfigContent(null)
                setConfigLabel(null)
                setConfigPass(null)
                setConfigPassCommand(null)
                setIsPasswordCommand(false)
            })
        }
    }, [isOpen, configLabel, initializeConfig, configContent])

    if (!id) {
        return null
    }

    return (
        <Drawer
            isOpen={isOpen}
            placement={'bottom'}
            size="full"
            onClose={onClose}
            hideCloseButton={true}
        >
            <DrawerContent
                className={cn(
                    'bg-content1/80 backdrop-blur-md dark:bg-content1/90',
                    platform() === 'macos' && 'pt-5'
                )}
            >
                {(close) => (
                    <>
                        <DrawerHeader className="flex flex-col gap-1">
                            Edit {configLabel}
                        </DrawerHeader>
                        <DrawerBody>
                            <div className="flex flex-col gap-4">
                                <Input
                                    name="label"
                                    label="Name"
                                    labelPlacement="outside"
                                    placeholder="Enter a name for your config"
                                    type="text"
                                    value={configLabel || ''}
                                    autoCapitalize="off"
                                    autoComplete="off"
                                    autoCorrect="off"
                                    spellCheck="false"
                                    onValueChange={(value) => {
                                        setConfigLabel(value)
                                    }}
                                    isClearable={true}
                                    onClear={() => {
                                        setConfigLabel(null)
                                    }}
                                    size="lg"
                                />

                                {isEncrypted && (
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
                                                : 'Leave blank to be prompted on every startup'
                                        }
                                        type={isPasswordCommand ? 'text' : 'password'}
                                        value={
                                            (isPasswordCommand ? configPassCommand : configPass) ||
                                            ''
                                        }
                                        autoCapitalize="off"
                                        autoComplete="off"
                                        autoCorrect="off"
                                        spellCheck="false"
                                        onValueChange={(value) => {
                                            if (isPasswordCommand) {
                                                setConfigPassCommand(value)
                                            } else {
                                                setConfigPass(value)
                                            }
                                        }}
                                        isClearable={true}
                                        onClear={() => {
                                            if (isPasswordCommand) {
                                                setConfigPassCommand(null)
                                            } else {
                                                setConfigPass(null)
                                            }
                                        }}
                                        size="lg"
                                    />
                                )}

                                <Textarea
                                    className="w-full"
                                    name="content"
                                    label={
                                        <div className="flex items-center gap-1.5">
                                            <p className="text-medium">Config</p>
                                        </div>
                                    }
                                    labelPlacement="outside"
                                    placeholder="Update your config here"
                                    value={configContent || ''}
                                    onValueChange={(value) => {
                                        console.log(value)
                                        setConfigContent(value)
                                    }}
                                    autoCapitalize="off"
                                    autoComplete="off"
                                    autoCorrect="off"
                                    spellCheck="false"
                                    minRows={14}
                                    rows={14}
                                    maxRows={14}
                                    disableAutosize={true}
                                    size="lg"
                                    onClear={() => {
                                        setConfigContent(null)
                                    }}
                                    data-focus-visible="false"
                                />
                            </div>
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
                                isDisabled={updateConfigMutation.isPending}
                                data-focus-visible="false"
                                onPress={async () => {
                                    if (!configLabel) {
                                        await message('Label is required', {
                                            title: 'Failed to save config',
                                            kind: 'error',
                                            okLabel: 'OK',
                                        })
                                        return
                                    }

                                    if (!configContent) {
                                        await message('Content is required', {
                                            title: 'Failed to save config',
                                            kind: 'error',
                                            okLabel: 'OK',
                                        })
                                        return
                                    }

                                    if (isEncrypted && isPasswordCommand && !configPassCommand) {
                                        await message(
                                            'Password command is required for encrypted configs',
                                            {
                                                title: 'Failed to save config',
                                                kind: 'error',
                                                okLabel: 'OK',
                                            }
                                        )
                                        return
                                    }

                                    updateConfigMutation.mutate({
                                        label: configLabel,
                                        pass: configPass || undefined,
                                        content: configContent,
                                        passCommand: configPassCommand || undefined,
                                        isPasswordCommand: isPasswordCommand,
                                        isEncrypted:
                                            configContent?.includes('RCLONE_ENCRYPT_V0:') || false,
                                    })
                                }}
                            >
                                {updateConfigMutation.isPending ? 'Saving...' : 'Save Changes'}
                            </Button>
                        </DrawerFooter>
                    </>
                )}
            </DrawerContent>
        </Drawer>
    )
}
