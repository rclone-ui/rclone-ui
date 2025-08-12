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
import { message, open } from '@tauri-apps/plugin-dialog'
import { mkdir, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { platform } from '@tauri-apps/plugin-os'
import { UploadIcon } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { getConfigPath } from '../../lib/rclone/api'
import { usePersistedStore } from '../../lib/store'
import type { ConfigFile } from '../../types/config'

export default function ConfigCreateDrawer({
    onClose,
    isOpen,
}: {
    onClose: () => void
    isOpen: boolean
}) {
    const [config, setConfig] = useState<Partial<ConfigFile>>({
        label: 'New Config',
    })
    const [configContent, setConfigContent] = useState<string | null>(null)
    const [isSaving, setIsSaving] = useState(false)

    const isEncrypted = useMemo(() => {
        return configContent?.includes('RCLONE_ENCRYPT_V0:')
    }, [configContent])

    const handleCreate = useCallback(
        async ({
            label,
            pass,
            content,
        }: { label?: string; pass?: string; content: string | null }) => {
            try {
                if (!label) {
                    throw new Error('Label is required')
                }

                if (!content) {
                    throw new Error('Content is required')
                }

                if (!pass && content.includes('RCLONE_ENCRYPT_V0:')) {
                    throw new Error('Password is required for encrypted configs')
                }

                setIsSaving(true)

                const generatedId = crypto.randomUUID()

                const configPath = await getConfigPath({ id: generatedId, validate: false })

                const slashSymbol = platform() === 'windows' ? '\\' : '/'

                await mkdir(configPath.replace(slashSymbol + 'rclone.conf', ''), {
                    recursive: true,
                })
                await writeTextFile(configPath, content)
                console.log('[handleCreate] saved config to', configPath)

                usePersistedStore.getState().addConfigFile({
                    id: generatedId,
                    label,
                    pass,
                    isEncrypted: content.includes('RCLONE_ENCRYPT_V0:'),
                    sync: undefined,
                    passCommand: undefined,
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
                        <DrawerHeader className="flex flex-col gap-1">Import Config</DrawerHeader>
                        <DrawerBody>
                            <form
                                id="config-form"
                                className="flex flex-col gap-4"
                                onSubmit={(e) => {
                                    e.preventDefault()
                                    handleCreate({
                                        label: config.label,
                                        pass: config.pass,
                                        content: configContent,
                                    })
                                }}
                            >
                                <Input
                                    label="Name"
                                    labelPlacement="outside"
                                    placeholder="Enter a name for your config"
                                    type="text"
                                    value={config.label}
                                    autoComplete="off"
                                    autoCapitalize="off"
                                    autoCorrect="off"
                                    onValueChange={(value) => {
                                        setConfig({ ...config, label: value })
                                    }}
                                    isClearable={true}
                                    onClear={() => {
                                        setConfig({ ...config, label: '' })
                                    }}
                                    size="lg"
                                />

                                {isEncrypted && (
                                    <Input
                                        label="Password"
                                        labelPlacement="outside"
                                        placeholder="Enter the password for your config file"
                                        type="password"
                                        value={config.pass}
                                        autoComplete="off"
                                        autoCapitalize="off"
                                        autoCorrect="off"
                                        onValueChange={(value) => {
                                            setConfig({ ...config, pass: value })
                                        }}
                                        isClearable={true}
                                        onClear={() => {
                                            setConfig({ ...config, pass: '' })
                                        }}
                                        size="lg"
                                    />
                                )}

                                <Textarea
                                    className="w-full"
                                    label={
                                        <div className="flex items-center gap-1.5">
                                            <p className="text-medium">Config</p>
                                            <Button
                                                isIconOnly={true}
                                                variant="light"
                                                size="sm"
                                                onPress={async () => {
                                                    const selectedFile = await open({
                                                        directory: false,
                                                        multiple: false,
                                                        title: 'Select a config file',
                                                    })

                                                    if (!selectedFile) {
                                                        return
                                                    }

                                                    let content = await readTextFile(selectedFile)

                                                    if (selectedFile.endsWith('.json')) {
                                                        const importedRemotes = JSON.parse(
                                                            content
                                                        ) as Record<string, object>
                                                        content = Object.entries(importedRemotes)
                                                            .map(([name, remote]) => {
                                                                const remoteName = `[${name}]`
                                                                const remoteConfig = Object.entries(
                                                                    remote
                                                                )
                                                                    .map(([key, value]) => {
                                                                        return `${key} = ${value}`
                                                                    })
                                                                    .join('\n')
                                                                return `${remoteName}\n${remoteConfig}`
                                                            })
                                                            .reduce((acc, curr) => {
                                                                return `${curr}\n\n${acc}`
                                                            }, '')
                                                    }

                                                    const slashSymbol =
                                                        platform() === 'windows' ? '\\' : '/'

                                                    setConfigContent(content)
                                                    setConfig({
                                                        ...config,
                                                        label:
                                                            config.label ||
                                                            selectedFile.split(slashSymbol).pop() ||
                                                            'New Config',
                                                        isEncrypted:
                                                            content.includes('RCLONE_ENCRYPT_V0:'),
                                                    })
                                                }}
                                            >
                                                <UploadIcon className="w-4 h-4" />
                                            </Button>
                                        </div>
                                    }
                                    labelPlacement="outside"
                                    placeholder="Paste your config here or import an existing file"
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
                                {isSaving ? 'Saving...' : 'Import'}
                            </Button>
                        </DrawerFooter>
                    </>
                )}
            </DrawerContent>
        </Drawer>
    )
}
