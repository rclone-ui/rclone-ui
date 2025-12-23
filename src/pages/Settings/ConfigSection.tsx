import {
    Avatar,
    Button,
    Card,
    CardBody,
    Chip,
    Dropdown,
    DropdownItem,
    DropdownMenu,
    DropdownTrigger,
    Tooltip,
} from '@heroui/react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { invoke } from '@tauri-apps/api/core'
import { sep } from '@tauri-apps/api/path'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { ask, message, open } from '@tauri-apps/plugin-dialog'
import { readTextFile, remove, writeTextFile } from '@tauri-apps/plugin-fs'
import { revealItemInDir } from '@tauri-apps/plugin-opener'
import { platform } from '@tauri-apps/plugin-os'
import {
    DownloadIcon,
    FolderOpenIcon,
    ImportIcon,
    LockIcon,
    PencilIcon,
    PlusIcon,
    Trash2Icon,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { removeConfigPassword, setConfigPassword } from '../../../lib/rclone/api'
import { promptForConfigPassword, restartActiveRclone } from '../../../lib/rclone/cli'
import rclone from '../../../lib/rclone/client'
import { getConfigPath } from '../../../lib/rclone/common'
import { useHostStore } from '../../../store/host'
import { usePersistedStore } from '../../../store/persisted'
import type { ConfigFile } from '../../../types/config'
import ConfigCreateDrawer from '../../components/ConfigCreateDrawer'
import ConfigEditDrawer from '../../components/ConfigEditDrawer'
import ConfigSyncDrawer from '../../components/ConfigSyncDrawer'
import BaseSection from './BaseSection'

export default function ConfigSection() {
    const licenseValid = usePersistedStore((state) => state.licenseValid)

    const configFiles = useHostStore((state) => state.configFiles)
    const activeConfigFile = useHostStore((state) => state.activeConfigFile)

    const queryClient = useQueryClient()

    const [isCreateDrawerOpen, setIsCreateDrawerOpen] = useState(false)
    const [isSyncDrawerOpen, setIsSyncDrawerOpen] = useState(false)
    const [isEditDrawerOpen, setIsEditDrawerOpen] = useState(false)
    const [focusedConfigId, setFocusedConfigId] = useState<string | null>(null)

    const switchConfigMutation = useMutation({
        mutationFn: async (configFile: ConfigFile) => {
            if (configFile.id === activeConfigFile?.id) {
                return
            }

            const confirmed = await ask(`Switch to config ${configFile.label}?`, {
                title: 'Switch Config',
                kind: 'info',
                okLabel: 'OK',
                cancelLabel: 'Cancel',
            })

            if (!confirmed) {
                return
            }

            const shouldRestartRclone =
                Boolean(activeConfigFile?.isEncrypted) || Boolean(configFile.isEncrypted)

            useHostStore.getState().setActiveConfigFile(configFile.id!)

            if (shouldRestartRclone) {
                await restartActiveRclone()
            } else {
                const configPath = await getConfigPath({
                    id: configFile.id!,
                    validate: true,
                })

                await rclone('/config/setpath', {
                    params: {
                        query: {
                            'path': configPath,
                        },
                    },
                })
            }
            await queryClient.cancelQueries()
            await queryClient.resetQueries()
        },
        onError: async (error) => {
            console.error('[switchConfig] failed to switch config', error)
            await message(error instanceof Error ? error.message : 'An unknown error occurred', {
                title: 'Switch Config',
                kind: 'error',
                okLabel: 'OK',
            })
        },
    })

    const locateConfigMutation = useMutation({
        mutationFn: async (id: string) => {
            const configPath = await getConfigPath({ id: id, validate: true })
            await revealItemInDir(configPath)
        },
        onError: async (error) => {
            console.error('[locateConfig] failed to locate config', error)
            await message(error instanceof Error ? error.message : 'An unknown error occurred', {
                title: 'Failed to locate config',
                kind: 'error',
                okLabel: 'OK',
            })
        },
    })

    const exportConfigMutation = useMutation({
        mutationFn: async ({ id, label }: { id: string; label: string }) => {
            const configPath = await getConfigPath({ id: id, validate: true })
            const text = await readTextFile(configPath)

            await getCurrentWindow().setFocus()
            const selectedPath = await open({
                title: `Select a directory to export "${label}"`,
                multiple: false,
                directory: true,
            })

            if (!selectedPath) {
                return
            }

            console.log('[exportConfig] selectedPath', selectedPath)

            // allow spaces, dashes, and underscores
            const exportPath = `${selectedPath}${sep()}${label.replace(/[^a-zA-Z0-9\s\-_]/g, '')}.conf`

            await writeTextFile(exportPath, text)
        },
        onError: async (error) => {
            console.error('[exportConfig] failed to export config', error)
            await message(error instanceof Error ? error.message : 'An unknown error occurred', {
                title: 'Failed to export config',
                kind: 'error',
                okLabel: 'OK',
            })
        },
    })

    const removePasswordMutation = useMutation({
        mutationFn: async (id: string) => {
            if (!activeConfigFile?.id || id !== activeConfigFile.id) {
                throw new Error('Only the active configuration can be decrypted.')
            }

            if (!activeConfigFile.isEncrypted) {
                throw new Error('Encryption is already disabled for the active configuration.')
            }

            const confirmed = await ask(
                'This will remove the encryption password from the config.',
                {
                    title: 'Disable Encryption?',
                    kind: 'warning',
                    okLabel: 'Disable',
                    cancelLabel: 'Cancel',
                }
            )

            if (!confirmed) {
                return
            }

            await removeConfigPassword()
        },
        onError: async (error) => {
            console.error('[removePassword] failed to remove password', error)
            await message(error instanceof Error ? error.message : 'An unknown error occurred', {
                title: 'Config Encryption',
                kind: 'error',
                okLabel: 'OK',
            })
        },
    })

    const setPasswordMutation = useMutation({
        mutationFn: async (id: string) => {
            if (!activeConfigFile?.id || id !== activeConfigFile.id) {
                throw new Error('Only the active configuration password can be set.')
            }

            const password = await promptForConfigPassword(
                `Enter a new password for "${activeConfigFile.label}".`
            )

            if (!password) {
                return
            }

            await setConfigPassword({
                password,
                persist: Boolean(activeConfigFile.pass),
            })
        },
        onError: async (error) => {
            console.error('[setPassword] failed to set password', error)
            await message(error instanceof Error ? error.message : 'An unknown error occurred', {
                title: 'Config Encryption',
                kind: 'error',
                okLabel: 'OK',
            })
        },
    })

    const savePasswordMutation = useMutation({
        mutationFn: async (id: string) => {
            if (!activeConfigFile?.id || id !== activeConfigFile.id) {
                throw new Error('Only the active configuration password can be saved.')
            }

            if (!activeConfigFile.isEncrypted) {
                throw new Error('Enable encryption before saving the password.')
            }

            if (activeConfigFile.pass) {
                throw new Error('A password is already saved for this configuration.')
            }

            if (activeConfigFile.passCommand) {
                throw new Error('A password command is already saved for this configuration.')
            }

            const password = await promptForConfigPassword(
                `Enter the current password for "${activeConfigFile.label}" to save it.`
            )

            if (!password) {
                return
            }

            useHostStore.getState().updateConfigFile(id, {
                pass: password,
                passCommand: undefined,
            })
            await message('The password has been saved for this configuration.', {
                title: 'Config Password',
                kind: 'info',
                okLabel: 'OK',
            })
        },
        onError: async (error) => {
            console.error('[savePasswordCommand] failed to save password command', error)
            await message(error instanceof Error ? error.message : 'An unknown error occurred', {
                title: 'Config Password',
                kind: 'error',
                okLabel: 'OK',
            })
        },
    })

    const savePasswordCommandMutation = useMutation({
        mutationFn: async (id: string) => {
            if (!activeConfigFile?.id || id !== activeConfigFile.id) {
                throw new Error('Only the active configuration password command can be saved.')
            }

            if (!activeConfigFile.isEncrypted) {
                throw new Error('Enable encryption before saving the password command.')
            }

            if (activeConfigFile.passCommand) {
                throw new Error('A password command is already saved for this configuration.')
            }

            if (activeConfigFile.pass) {
                throw new Error('Remove the saved password before adding a password command.')
            }

            const command = await invoke<string | null>('prompt', {
                title: 'Save Password Command',
                message: `Enter a command that outputs the password for "${activeConfigFile.label}".`,
                default: '',
                sensitive: false,
            }).catch(async (error) => {
                console.error('[Settings] Failed to prompt for password command', error)
                throw new Error('Failed to collect the password command.')
            })

            const trimmedCommand = command?.trim()

            if (!trimmedCommand) {
                return
            }

            useHostStore.getState().updateConfigFile(id, {
                pass: undefined,
                passCommand: trimmedCommand,
            })
            await message('The password command has been saved for this configuration.', {
                title: 'Config Password Command',
                kind: 'info',
                okLabel: 'OK',
            })
        },
        onError: async (error) => {
            console.error('[savePasswordCommand] failed to save password command', error)
            await message(error instanceof Error ? error.message : 'An unknown error occurred', {
                title: 'Config Password',
                kind: 'error',
                okLabel: 'OK',
            })
        },
    })

    const removeSavedPasswordMutation = useMutation({
        mutationFn: async (id: string) => {
            if (!activeConfigFile?.id || id !== activeConfigFile.id) {
                throw new Error('Only the active configuration password can be removed.')
            }

            if (!activeConfigFile.pass && !activeConfigFile.passCommand) {
                throw new Error('There is no saved password to remove.')
            }

            const confirmed = await ask(
                `Remove the saved password for "${activeConfigFile.label}"? You will be prompted for it next time it's needed.`,
                {
                    title: 'Remove Saved Password',
                    kind: 'warning',
                    okLabel: 'Remove',
                    cancelLabel: 'Cancel',
                }
            )

            if (!confirmed) {
                return
            }

            useHostStore.getState().updateConfigFile(id, {
                pass: undefined,
                passCommand: undefined,
            })
            await message('The saved password has been removed.', {
                title: 'Config Password',
                kind: 'info',
                okLabel: 'OK',
            })
        },
        onError: async (error) => {
            console.error('[removeSavedPassword] failed to remove saved password', error)
            await message(error instanceof Error ? error.message : 'An unknown error occurred', {
                title: 'Config Password',
                kind: 'error',
                okLabel: 'OK',
            })
        },
    })

    return (
        <BaseSection
            header={{
                title: 'Config',
                endContent: (
                    <Dropdown shadow={platform() === 'windows' ? 'none' : undefined}>
                        <DropdownTrigger>
                            <Button variant="faded" color="primary" data-focus-visible="false">
                                Add Config
                            </Button>
                        </DropdownTrigger>
                        <DropdownMenu
                            onAction={(key) => {
                                setTimeout(async () => {
                                    if (key === 'import') {
                                        setIsCreateDrawerOpen(true)
                                    } else {
                                        if (!licenseValid) {
                                            await message(
                                                'Community version does not support syncing configs.\n\nIf you do not wish to update it outside of Rclone UI, you can simply import.',
                                                {
                                                    title: 'Missing license',
                                                    kind: 'error',
                                                }
                                            )
                                            return
                                        }
                                        setIsSyncDrawerOpen(true)
                                    }
                                }, 100)
                            }}
                            variant="faded"
                        >
                            <DropdownItem
                                key="import"
                                description="Edit using the CLI or UI"
                                startContent={<PlusIcon />}
                            >
                                Import Config
                            </DropdownItem>
                            <DropdownItem
                                key="sync"
                                description="Update using Git or similar"
                                startContent={<ImportIcon />}
                            >
                                Sync Config
                            </DropdownItem>
                        </DropdownMenu>
                    </Dropdown>
                ),
            }}
        >
            <div className="flex flex-col gap-2.5 px-4">
                {configFiles.map((configFile, configFileIndex) => (
                    <ConfigCard
                        key={configFile.id}
                        configFile={configFile}
                        index={configFileIndex}
                        activeConfigFile={activeConfigFile}
                        switchConfigMutation={switchConfigMutation}
                        setPasswordMutation={setPasswordMutation}
                        removePasswordMutation={removePasswordMutation}
                        savePasswordMutation={savePasswordMutation}
                        savePasswordCommandMutation={savePasswordCommandMutation}
                        removeSavedPasswordMutation={removeSavedPasswordMutation}
                        setFocusedConfigId={setFocusedConfigId}
                        setIsEditDrawerOpen={setIsEditDrawerOpen}
                        locateConfigMutation={locateConfigMutation}
                        exportConfigMutation={exportConfigMutation}
                    />
                ))}
            </div>

            <ConfigCreateDrawer
                isOpen={isCreateDrawerOpen}
                onClose={() => {
                    setIsCreateDrawerOpen(false)
                }}
            />

            <ConfigEditDrawer
                isOpen={isEditDrawerOpen}
                onClose={() => {
                    setIsEditDrawerOpen(false)
                    setFocusedConfigId(null)
                }}
                id={focusedConfigId}
            />

            <ConfigSyncDrawer
                isOpen={isSyncDrawerOpen}
                onClose={() => {
                    setIsSyncDrawerOpen(false)
                }}
            />
        </BaseSection>
    )
}

function ConfigCard({
    configFile,
    index,
    activeConfigFile,
    switchConfigMutation,
    setPasswordMutation,
    removePasswordMutation,
    savePasswordMutation,
    savePasswordCommandMutation,
    removeSavedPasswordMutation,
    setFocusedConfigId,
    setIsEditDrawerOpen,
    locateConfigMutation,
    exportConfigMutation,
}: {
    configFile: ConfigFile
    index: number
    activeConfigFile: ConfigFile | null | undefined
    switchConfigMutation: any
    setPasswordMutation: any
    removePasswordMutation: any
    savePasswordMutation: any
    savePasswordCommandMutation: any
    removeSavedPasswordMutation: any
    setFocusedConfigId: (id: string) => void
    setIsEditDrawerOpen: (open: boolean) => void
    locateConfigMutation: any
    exportConfigMutation: any
}) {
    const disabledKeys = useMemo(() => {
        if (configFile.id !== activeConfigFile?.id) {
            return [
                'enable',
                'disable',
                'update',
                'save-password',
                'save-password-command',
                'remove-password',
            ]
        }

        if (!configFile.isEncrypted) {
            return [
                'disable',
                'update',
                'save-password',
                'save-password-command',
                'remove-password',
            ]
        }

        const disabled = ['enable']

        if (configFile.passCommand) {
            disabled.push('save-password', 'save-password-command')
        } else if (configFile.pass) {
            disabled.push('save-password', 'save-password-command')
        } else {
            disabled.push('remove-password')
        }

        return disabled
    }, [configFile, activeConfigFile])

    return (
        <Card
            isPressable={true}
            shadow="sm"
            className={`group/card h-24 gap-2 bg-content2 ${configFile.id === activeConfigFile?.id ? 'border-2 border-primary' : ''}`}
            onPress={() => {
                setTimeout(() => {
                    switchConfigMutation.mutate(configFile)
                }, 100)
            }}
        >
            <CardBody className="flex flex-row items-center justify-start w-full gap-2.5">
                <Avatar
                    fallback={`#${index + 1}`}
                    className="text-large"
                    size="lg"
                    color={'default'}
                />
                <div className="flex flex-col gap-1 ml-0.5">
                    <p className="text-large">{configFile.label}</p>
                    <div className="flex flex-row gap-2">
                        {configFile.id === activeConfigFile?.id && (
                            <Chip color="primary" size="sm">
                                ACTIVE
                            </Chip>
                        )}
                        {!!configFile.sync && <Chip size="sm">SYNCED</Chip>}
                        {configFile.isEncrypted && (
                            <Chip color="success" size="sm">
                                ENCRYPTED
                            </Chip>
                        )}
                        {!configFile.isEncrypted && (
                            <Chip color="warning" size="sm">
                                UNENCRYPTED
                            </Chip>
                        )}
                    </div>
                </div>
                <div className="flex-1" />
                <div className="flex flex-row items-center transition-opacity duration-150 opacity-0 group-hover/card:opacity-100">
                    <Tooltip content="Encryption Settings" color="foreground" size="lg">
                        <div>
                            <Dropdown shadow={platform() === 'windows' ? 'none' : undefined}>
                                <DropdownTrigger>
                                    <Button
                                        isIconOnly={true}
                                        variant="light"
                                        size="lg"
                                        isLoading={
                                            (setPasswordMutation.isPending &&
                                                setPasswordMutation.variables === configFile.id) ||
                                            (removePasswordMutation.isPending &&
                                                removePasswordMutation.variables ===
                                                    configFile.id) ||
                                            (savePasswordMutation.isPending &&
                                                savePasswordMutation.variables === configFile.id) ||
                                            (savePasswordCommandMutation.isPending &&
                                                savePasswordCommandMutation.variables ===
                                                    configFile.id) ||
                                            (removeSavedPasswordMutation.isPending &&
                                                removeSavedPasswordMutation.variables ===
                                                    configFile.id)
                                        }
                                    >
                                        <LockIcon className="w-5 h-5" />
                                    </Button>
                                </DropdownTrigger>
                                <DropdownMenu
                                    disabledKeys={disabledKeys}
                                    onAction={(key) => {
                                        setTimeout(() => {
                                            if (!configFile.id) {
                                                return
                                            }

                                            const targetId = configFile.id

                                            switch (key) {
                                                case 'enable':
                                                    setPasswordMutation.mutate(targetId)
                                                    break
                                                case 'disable':
                                                    removePasswordMutation.mutate(targetId)
                                                    break
                                                case 'update':
                                                    setPasswordMutation.mutate(targetId)
                                                    break
                                                case 'save-password':
                                                    savePasswordMutation.mutate(targetId)
                                                    break
                                                case 'save-password-command':
                                                    savePasswordCommandMutation.mutate(targetId)
                                                    break
                                                case 'remove-password':
                                                    removeSavedPasswordMutation.mutate(targetId)
                                                    break
                                                default:
                                                    break
                                            }
                                        }, 100)
                                    }}
                                >
                                    <DropdownItem
                                        key="enable"
                                        startContent={<LockIcon className="size-4" />}
                                    >
                                        Enable Encryption
                                    </DropdownItem>
                                    <DropdownItem
                                        key="disable"
                                        startContent={<LockIcon className="size-4" />}
                                    >
                                        Disable Encryption
                                    </DropdownItem>
                                    <DropdownItem
                                        key="update"
                                        startContent={<LockIcon className="size-4" />}
                                    >
                                        Update Password
                                    </DropdownItem>
                                    {configFile.isEncrypted &&
                                    !configFile.pass &&
                                    !configFile.passCommand ? (
                                        <DropdownItem
                                            key="save-password"
                                            startContent={<LockIcon className="size-4" />}
                                        >
                                            Save Password
                                        </DropdownItem>
                                    ) : null}
                                    {configFile.isEncrypted && !configFile.passCommand ? (
                                        <DropdownItem
                                            key="save-password-command"
                                            startContent={<LockIcon className="size-4" />}
                                        >
                                            Save Password Command
                                        </DropdownItem>
                                    ) : null}
                                    {configFile.isEncrypted &&
                                    (configFile.pass || configFile.passCommand) ? (
                                        <DropdownItem
                                            key="remove-password"
                                            startContent={<LockIcon className="size-4" />}
                                        >
                                            Remove Saved Password
                                        </DropdownItem>
                                    ) : null}
                                </DropdownMenu>
                            </Dropdown>
                        </div>
                    </Tooltip>
                    <Tooltip content="Edit Config" color="foreground" size="lg">
                        <div>
                            <Button
                                isIconOnly={true}
                                variant="light"
                                size="lg"
                                onPress={() => {
                                    setFocusedConfigId(configFile.id!)
                                    setIsEditDrawerOpen(true)
                                }}
                                isDisabled={
                                    configFile.id === 'default' ||
                                    configFile.id === activeConfigFile?.id ||
                                    Boolean(configFile.sync)
                                }
                            >
                                <PencilIcon className="w-5 h-5" />
                            </Button>
                        </div>
                    </Tooltip>
                    <Tooltip content="Delete Config" color="danger" size="lg">
                        <div>
                            <Button
                                isIconOnly={true}
                                variant="light"
                                size="lg"
                                onPress={() => {
                                    setTimeout(async () => {
                                        const confirmed = await ask(
                                            `Are you sure you want to delete config ${configFile.label}?`,
                                            {
                                                title: 'Delete Config',
                                                kind: 'warning',
                                                okLabel: 'Delete',
                                                cancelLabel: 'Cancel',
                                            }
                                        )

                                        if (!confirmed) {
                                            return
                                        }

                                        if (configFile.id === 'default') {
                                            await message('Default config cannot be deleted', {
                                                title: 'Error',
                                                kind: 'warning',
                                                okLabel: 'OK',
                                            })
                                            return
                                        }

                                        if (!configFile.sync) {
                                            const path = await getConfigPath({
                                                id: configFile.id!,
                                                validate: true,
                                            })

                                            await remove(path.replace('rclone.conf', ''), {
                                                recursive: true,
                                            })
                                        }

                                        if (activeConfigFile?.id === configFile.id) {
                                            useHostStore.getState().setActiveConfigFile('default')
                                        }

                                        useHostStore.getState().removeConfigFile(configFile.id!)
                                    }, 100)
                                }}
                                isDisabled={configFile.id === 'default'}
                            >
                                <Trash2Icon className="w-5 h-5" />
                            </Button>
                        </div>
                    </Tooltip>
                    <Tooltip content="Locate Config" color="foreground" size="lg">
                        <div>
                            <Button
                                isIconOnly={true}
                                variant="light"
                                size="lg"
                                onPress={() => {
                                    locateConfigMutation.mutate(configFile.id!)
                                }}
                                isLoading={
                                    locateConfigMutation.isPending &&
                                    locateConfigMutation.variables === configFile.id
                                }
                            >
                                <FolderOpenIcon className="w-5 h-5" />
                            </Button>
                        </div>
                    </Tooltip>
                    <Tooltip content="Export Config" color="foreground" size="lg">
                        <div>
                            <Button
                                isIconOnly={true}
                                variant="light"
                                size="lg"
                                onPress={() => {
                                    exportConfigMutation.mutate({
                                        id: configFile.id!,
                                        label: configFile.label,
                                    })
                                }}
                                isLoading={
                                    exportConfigMutation.isPending &&
                                    exportConfigMutation.variables?.id === configFile.id
                                }
                            >
                                <DownloadIcon className="w-5 h-5" />
                            </Button>
                        </div>
                    </Tooltip>
                </div>
            </CardBody>
        </Card>
    )
}
