import {
    Drawer,
    DrawerBody,
    DrawerContent,
    DrawerFooter,
    DrawerHeader,
    Input,
    Textarea,
} from '@heroui/react'
import { Button } from '@heroui/react'
import { message } from '@tauri-apps/plugin-dialog'
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { useCallback, useEffect, useMemo, useState } from 'react'
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
    const initialConfig = useMemo(() => configFiles.find((c) => c.id === id), [configFiles, id])

    const [configLabel, setConfigLabel] = useState<string | null>(null)
    const [configPass, setConfigPass] = useState<string | null>(null)
    const [configContent, setConfigContent] = useState<string | null>(null)

    const [isSaving, setIsSaving] = useState(false)

    const isEncrypted = useMemo(() => {
        return configContent?.includes('RCLONE_ENCRYPT_V0:')
    }, [configContent])

    const handleUpdate = useCallback(
        async ({ label, pass, content }: { label?: string; pass?: string; content?: string }) => {
            if (!id) return

            try {
                if (!label) {
                    throw new Error('Label is required')
                }

                if (!content) {
                    throw new Error('Content is required')
                }

                if (content.includes('RCLONE_ENCRYPT_V0:') && !pass) {
                    throw new Error('Password is required for encrypted configs')
                }

                setIsSaving(true)

                const configPath = await getConfigPath({ id: id, validate: true })
                await writeTextFile(configPath, content)

                usePersistedStore.getState().updateConfigFile(id, {
                    label,
                    pass: pass || undefined,
                    isEncrypted: content.includes('RCLONE_ENCRYPT_V0:'),
                })

                onClose()
            } catch (error) {
                console.error('[handleUpdate] failed to save config', error)
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
        [id, onClose]
    )

    const initializeConfig = useCallback(async () => {
        if (!initialConfig) {
            return
        }

        const configPath = await getConfigPath({ id: initialConfig.id!, validate: true })
        const text = await readTextFile(configPath)
        setConfigContent(text)
        setConfigLabel(initialConfig.label)
        setConfigPass(initialConfig.pass || null)
    }, [initialConfig])

    useEffect(() => {
        if (isOpen && configContent === null && configLabel === null) {
            initializeConfig()
        }

        if (!isOpen) {
            setConfigContent(null)
            setConfigLabel(null)
            setConfigPass(null)
        }
    }, [isOpen, initializeConfig, configLabel, configContent])

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
                                        name="label"
                                        label="Password"
                                        labelPlacement="outside"
                                        placeholder="Enter the password for your config file"
                                        type="password"
                                        value={configPass || ''}
                                        autoComplete="off"
                                        autoCapitalize="off"
                                        autoCorrect="off"
                                        onValueChange={(value) => {
                                            setConfigPass(value)
                                        }}
                                        isClearable={true}
                                        onClear={() => {
                                            setConfigPass(null)
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
