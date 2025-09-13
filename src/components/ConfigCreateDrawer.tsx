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
import { sep } from '@tauri-apps/api/path'
import { message, open } from '@tauri-apps/plugin-dialog'
import { mkdir, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs'
import { UploadIcon } from 'lucide-react'
import { useState } from 'react'
import { getConfigPath } from '../../lib/rclone/common'
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

    const [isPasswordCommand, setIsPasswordCommand] = useState(false)
    const [isSaving, setIsSaving] = useState(false)

    const isEncrypted = configContent?.includes('RCLONE_ENCRYPT_V0:')

    async function handleCreate({
        label,
        pass,
        passCommand,
        content,
        isPasswordCommand,
        isEncrypted,
    }: {
        label?: string
        pass?: string
        passCommand?: string
        content: string | null
        isPasswordCommand: boolean
        isEncrypted: boolean
    }) {
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
            const generatedId = crypto.randomUUID()

            const configPath = await getConfigPath({ id: generatedId, validate: false })

            await mkdir(configPath.replace(sep() + 'rclone.conf', ''), {
                recursive: true,
            })
            await writeTextFile(configPath, content)
            console.log('[handleCreate] saved config to', configPath)

            usePersistedStore.getState().addConfigFile({
                id: generatedId,
                label,
                pass: savedPass,
                passCommand: savedPassCommand,
                isEncrypted: isEncrypted,
                sync: undefined,
            })

            onClose()
        } catch (error) {
            console.error('[handleCreate] failed to save config', error)
            await message(error instanceof Error ? error.message : 'An unknown error occurred', {
                title: 'Failed to save config',
                kind: 'error',
                okLabel: 'OK',
            })
        }
        setIsSaving(false)
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
                                        passCommand: config.passCommand,
                                        content: configContent,
                                        isPasswordCommand: isPasswordCommand,
                                        isEncrypted:
                                            configContent?.includes('RCLONE_ENCRYPT_V0:') || false,
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

                                                    setConfigContent(content)
                                                    setConfig({
                                                        ...config,
                                                        label:
                                                            config.label ||
                                                            selectedFile.split(sep()).pop() ||
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
