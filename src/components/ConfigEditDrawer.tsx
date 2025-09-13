import {
    Drawer,
    DrawerBody,
    DrawerContent,
    DrawerFooter,
    DrawerHeader,
    Input,
    Switch,
    Textarea,
} from '@heroui/react'
import { Button } from '@heroui/react'
import { message } from '@tauri-apps/plugin-dialog'
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { useEffect, useState } from 'react'
import { getConfigPath } from '../../lib/rclone/common'
import { usePersistedStore } from '../../lib/store'

export default function ConfigEditDrawer({
    id,
    onClose,
    isOpen,
}: {
    id?: string | null
    onClose: () => void
    isOpen: boolean
}) {
    const configFiles = usePersistedStore((state) => state.configFiles)
    const initialConfig = configFiles.find((c) => c.id === id)

    const [configLabel, setConfigLabel] = useState<string | null>(null)
    const [configPass, setConfigPass] = useState<string | null>(null)
    const [configPassCommand, setConfigPassCommand] = useState<string | null>(null)
    const [configContent, setConfigContent] = useState<string | null>(null)

    const [isPasswordCommand, setIsPasswordCommand] = useState(false)
    const [isSaving, setIsSaving] = useState(false)

    const isEncrypted = configContent?.includes('RCLONE_ENCRYPT_V0:')

    async function handleUpdate({
        label,
        pass,
        content,
        passCommand,
        isPasswordCommand,
        isEncrypted,
    }: {
        label?: string
        pass?: string
        content?: string
        passCommand?: string
        isPasswordCommand?: boolean
        isEncrypted?: boolean
    }) {
        if (!id) return

        if (!label) {
            await message('Label is required', {
                title: 'Failed to save config',
                kind: 'error',
                okLabel: 'OK',
            })
            return
        }

        if (!content) {
            await message('Content is required', {
                title: 'Failed to save config',
                kind: 'error',
                okLabel: 'OK',
            })
            return
        }

        if (isEncrypted && isPasswordCommand && !passCommand) {
            await message('Password command is required for encrypted configs', {
                title: 'Failed to save config',
                kind: 'error',
                okLabel: 'OK',
            })
            return
        }

        setIsSaving(true)

        const savedPass = isPasswordCommand ? undefined : pass
        const savedPassCommand = isPasswordCommand ? passCommand : undefined

        try {
            const configPath = await getConfigPath({ id: id, validate: true })
            await writeTextFile(configPath, content)

            usePersistedStore.getState().updateConfigFile(id, {
                label,
                pass: savedPass,
                passCommand: savedPassCommand,
                isEncrypted: isEncrypted,
            })

            onClose()
        } catch (error) {
            console.error('[handleUpdate] failed to save config', error)
            await message(error instanceof Error ? error.message : 'An unknown error occurred', {
                title: 'Failed to save config',
                kind: 'error',
                okLabel: 'OK',
            })
        }
        setIsSaving(false)
    }

    async function initializeConfig() {
        if (!initialConfig) {
            return
        }

        const configPath = await getConfigPath({ id: initialConfig.id!, validate: true })
        const text = await readTextFile(configPath)
        setConfigContent(text)
        setConfigLabel(initialConfig.label)
        setConfigPass(initialConfig.pass || null)
        setConfigPassCommand(initialConfig.passCommand || null)
        setIsPasswordCommand(initialConfig.passCommand !== null)
    }

    useEffect(() => {
        if (isOpen && configContent === null && configLabel === null) {
            initializeConfig()
        }

        if (!isOpen) {
            setConfigContent(null)
            setConfigLabel(null)
            setConfigPass(null)
            setConfigPassCommand(null)
            setIsPasswordCommand(false)
        }
        // biome-ignore lint/correctness/useExhaustiveDependencies: <compiler>
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
            <DrawerContent>
                {(close) => (
                    <>
                        <DrawerHeader className="flex flex-col gap-1">
                            Edit {configLabel}
                        </DrawerHeader>
                        <DrawerBody>
                            <form
                                id="config-form"
                                className="flex flex-col gap-4"
                                onSubmit={(e) => {
                                    e.preventDefault()
                                    handleUpdate({
                                        label: configLabel || undefined,
                                        pass: configPass || undefined,
                                        content: configContent || undefined,
                                        passCommand: configPassCommand || undefined,
                                        isPasswordCommand: isPasswordCommand,
                                        isEncrypted:
                                            configContent?.includes('RCLONE_ENCRYPT_V0:') || false,
                                    })
                                }}
                            >
                                <Input
                                    name="label"
                                    label="Name"
                                    labelPlacement="outside"
                                    placeholder="Enter a name for your config"
                                    type="text"
                                    value={configLabel || ''}
                                    autoComplete="off"
                                    autoCapitalize="off"
                                    autoCorrect="off"
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
                                    onKeyDown={(e) => {
                                        //if it's tab key, add 2 spaces at the current text cursor position
                                        if (e.key === 'Tab') {
                                            e.preventDefault()
                                            const text = e.currentTarget.value
                                            const cursorPosition = e.currentTarget.selectionStart
                                            const newText =
                                                text.slice(0, cursorPosition) +
                                                '  ' +
                                                text.slice(cursorPosition)
                                            e.currentTarget.value = newText
                                            e.currentTarget.selectionStart = cursorPosition + 2
                                            e.currentTarget.selectionEnd = cursorPosition + 2
                                        }
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
                                {isSaving ? 'Saving...' : 'Save Changes'}
                            </Button>
                        </DrawerFooter>
                    </>
                )}
            </DrawerContent>
        </Drawer>
    )
}
