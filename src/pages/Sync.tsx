import {
    Accordion,
    AccordionItem,
    Avatar,
    Button,
    ButtonGroup,
    Dropdown,
    DropdownItem,
    DropdownMenu,
    DropdownTrigger,
    Tooltip,
} from '@heroui/react'
import * as Sentry from '@sentry/browser'
import { useMutation } from '@tanstack/react-query'
import { invoke } from '@tauri-apps/api/core'
import { ask, message } from '@tauri-apps/plugin-dialog'
import { platform } from '@tauri-apps/plugin-os'
import cronstrue from 'cronstrue'
import { AnimatePresence, motion } from 'framer-motion'
import {
    AlertOctagonIcon,
    ClockIcon,
    EyeIcon,
    FilterIcon,
    FolderSyncIcon,
    FoldersIcon,
    PlayIcon,
    ServerIcon,
    WrenchIcon,
} from 'lucide-react'
import { startTransition, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { getOptionsSubtitle } from '../../lib/flags'
import { useFlags } from '../../lib/hooks'
import notify from '../../lib/notify'
import { startDryRun, startSync } from '../../lib/rclone/api'
import { RCLONE_CONFIG_DEFAULTS } from '../../lib/rclone/constants'
import { openWindow } from '../../lib/window'
import { useHostStore } from '../../store/host'
import type { FlagValue } from '../../types/rclone'
import CommandInfoButton from '../components/CommandInfoButton'
import CommandsDropdown from '../components/CommandsDropdown'
import CronEditor from '../components/CronEditor'
import OperationWindowContent from '../components/OperationWindowContent'
import OperationWindowFooter from '../components/OperationWindowFooter'
import OptionsSection from '../components/OptionsSection'
import { PathFinder } from '../components/PathFinder'
import RemoteOptionsSection from '../components/RemoteOptionsSection'
import ShowMoreOptionsBanner from '../components/ShowMoreOptionsBanner'
import TemplatesDropdown from '../components/TemplatesDropdown'

export default function Sync() {
    const [searchParams] = useSearchParams()
    const { globalFlags, filterFlags, configFlags, syncFlags } = useFlags()

    const [source, setSource] = useState<string | undefined>(
        searchParams.get('initialSource') ? searchParams.get('initialSource')! : undefined
    )
    const [dest, setDest] = useState<string | undefined>(
        searchParams.get('initialDestination') ? searchParams.get('initialDestination')! : undefined
    )

    const [jsonError, setJsonError] = useState<'sync' | 'filter' | 'config' | 'remote' | null>(null)

    const [syncOptionsLocked, setSyncOptionsLocked] = useState(false)
    const [syncOptions, setSyncOptions] = useState<Record<string, FlagValue>>({})
    const [syncOptionsJsonString, setSyncOptionsJsonString] = useState<string>('{}')

    const [filterOptionsLocked, setFilterOptionsLocked] = useState(false)
    const [filterOptions, setFilterOptions] = useState<Record<string, FlagValue>>({})
    const [filterOptionsJsonString, setFilterOptionsJsonString] = useState<string>('{}')

    const [configOptionsLocked, setConfigOptionsLocked] = useState(false)
    const [configOptions, setConfigOptions] = useState<Record<string, FlagValue>>({})
    const [configOptionsJsonString, setConfigOptionsJsonString] = useState<string>('{}')

    const [remoteOptionsLocked, setRemoteOptionsLocked] = useState(false)
    const [remoteOptions, setRemoteOptions] = useState<Record<string, Record<string, FlagValue>>>(
        {}
    )
    const [remoteOptionsJsonString, setRemoteOptionsJsonString] = useState<string>('{}')

    const [cronExpression, setCronExpression] = useState<string | null>(null)

    const selectedRemotes = useMemo(() => [source, dest].filter(Boolean), [source, dest])

    const startSyncMutation = useMutation({
        mutationFn: async () => {
            if (!source || !dest) {
                throw new Error('Please select both a source and destination path')
            }

            return startSync({
                source: source,
                destination: dest,
                options: {
                    config: configOptions,
                    sync: syncOptions,
                    filter: filterOptions,
                    remotes: remoteOptions,
                },
            })
        },
        onSuccess: () => {
            if (cronExpression) {
                scheduleTaskMutation.mutate()
            }
        },
        onError: async (error) => {
            console.error('Error starting sync:', error)
            Sentry.captureException(error)
            await message(error instanceof Error ? error.message : 'Failed to start sync', {
                title: 'Sync',
                kind: 'error',
            })
        },
    })

    const scheduleTaskMutation = useMutation({
        mutationFn: async () => {
            if (!source || !dest) {
                throw new Error('Please select both a source and destination path')
            }

            if (!cronExpression) {
                throw new Error('Please enter a cron expression')
            }

            try {
                cronstrue.toString(cronExpression)
            } catch {
                throw new Error('Invalid cron expression')
            }

            const name = await invoke<string | null>('prompt', {
                title: 'Schedule Name',
                message: 'Enter a name for this schedule',
                default: `New Schedule ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: '2-digit' })}`,
            })

            if (!name) {
                throw new Error('Schedule name is required')
            }

            useHostStore.getState().addScheduledTask({
                name,
                operation: 'sync',
                cron: cronExpression,
                args: {
                    source,
                    destination: dest,
                    options: {
                        config: configOptions,
                        sync: syncOptions,
                        filter: filterOptions,
                        remotes: remoteOptions,
                    },
                },
            })
        },
        onSuccess: async () => {
            await notify({
                title: 'Success',
                body: 'New schedule has been created',
            })
        },
        onError: async (error) => {
            console.error('Error scheduling task:', error)
            await message(error instanceof Error ? error.message : 'Failed to schedule task', {
                title: 'Schedule',
                kind: 'error',
            })
        },
    })

    const dryRunMutation = useMutation({
        mutationFn: async () => {
            if (!source || !dest) {
                throw new Error('Please select both a source and destination path')
            }
            return startDryRun(() =>
                startSync({
                    source,
                    destination: dest,
                    options: {
                        config: configOptions,
                        sync: syncOptions,
                        filter: filterOptions,
                        remotes: remoteOptions,
                    },
                })
            )
        },
        onSuccess: async () => {
            const result = await ask(
                'Dry run started, you can check the results in the Transfers screen',
                {
                    title: 'Preview (Dry Run)',
                    kind: 'info',
                    okLabel: 'Open Transfers',
                    cancelLabel: 'OK',
                }
            )
            if (result) {
                await openWindow({ name: 'Transfers', url: '/transfers' })
            }
        },
        onError: async (error) => {
            console.error('Error starting dry run:', error)
            await message(error instanceof Error ? error.message : 'Failed to start dry run', {
                title: 'Dry Run',
                kind: 'error',
            })
        },
    })

    const buttonText = useMemo(() => {
        if (startSyncMutation.isPending) return 'STARTING...'
        if (!source) return 'Please select a source path'
        if (!dest) return 'Please select a destination path'
        if (source === dest) return 'Source and destination cannot be the same'
        if (jsonError) return 'Invalid JSON for ' + jsonError.toUpperCase() + ' options'
        if (cronExpression) return 'START AND SCHEDULE SYNC'
        return 'START SYNC'
    }, [startSyncMutation.isPending, source, dest, jsonError, cronExpression])

    const buttonIcon = useMemo(() => {
        if (startSyncMutation.isPending) return
        if (!source || !dest || source === dest) return <FoldersIcon className="w-5 h-5" />
        if (jsonError) return <AlertOctagonIcon className="w-5 h-5" />
        return <PlayIcon className="w-5 h-5 fill-current" />
    }, [startSyncMutation.isPending, source, dest, jsonError])

    useEffect(() => {
        startTransition(() => {
            setConfigOptionsJsonString(JSON.stringify(RCLONE_CONFIG_DEFAULTS.config, null, 2))
            setSyncOptionsJsonString(JSON.stringify(RCLONE_CONFIG_DEFAULTS.copy, null, 2))
        })
    }, [])

    useEffect(() => {
        let step: 'sync' | 'filter' | 'config' | 'remote' = 'sync'
        try {
            const parsedSync = JSON.parse(syncOptionsJsonString) as Record<string, FlagValue>

            step = 'filter'
            const parsedFilter = JSON.parse(filterOptionsJsonString) as Record<string, FlagValue>

            step = 'config'
            const parsedConfig = JSON.parse(configOptionsJsonString) as Record<string, FlagValue>

            step = 'remote'
            const parsedRemote = JSON.parse(remoteOptionsJsonString) as Record<
                string,
                Record<string, FlagValue>
            >

            startTransition(() => {
                setSyncOptions(parsedSync)
                setFilterOptions(parsedFilter)
                setConfigOptions(parsedConfig)
                setRemoteOptions(parsedRemote)
                setJsonError(null)
            })
        } catch (error) {
            setJsonError(step)
            console.error(`Error parsing ${step} options:`, error)
        }
    }, [
        syncOptionsJsonString,
        filterOptionsJsonString,
        configOptionsJsonString,
        remoteOptionsJsonString,
    ])

    return (
        <div className="flex flex-col h-screen gap-10">
            {/* Main Content */}
            <OperationWindowContent>
                {/* Paths Display */}
                <PathFinder
                    sourcePath={source}
                    setSourcePath={setSource}
                    destPath={dest}
                    setDestPath={setDest}
                    sourceOptions={{
                        label: 'Source',
                        showPicker: true,
                        placeholder:
                            'Enter a remote:/path or local path, or tap to select a folder',
                        clearable: true,
                        showFiles: true,
                        allowedKeys: ['LOCAL_FS', 'REMOTES', 'FAVORITES'],
                    }}
                    destOptions={{
                        label: 'Destination',
                        showPicker: true,
                        placeholder: 'Enter a remote:/path or local path',
                        clearable: true,
                        showFiles: false,
                        allowedKeys: ['LOCAL_FS', 'REMOTES', 'FAVORITES'],
                    }}
                />

                <div className="relative flex flex-col">
                    <Accordion
                        keepContentMounted={true}
                        dividerProps={{
                            className: 'opacity-50',
                        }}
                    >
                        <AccordionItem
                            key="sync"
                            startContent={
                                <Avatar color="success" radius="lg" fallback={<FolderSyncIcon />} />
                            }
                            indicator={<FolderSyncIcon />}
                            title="Sync"
                            subtitle={getOptionsSubtitle(Object.keys(syncOptions).length)}
                        >
                            <OptionsSection
                                optionsJson={syncOptionsJsonString}
                                setOptionsJson={setSyncOptionsJsonString}
                                globalOptions={globalFlags?.main || {}}
                                availableOptions={syncFlags || []}
                                isLocked={syncOptionsLocked}
                                setIsLocked={setSyncOptionsLocked}
                            />
                        </AccordionItem>
                        <AccordionItem
                            key="filters"
                            startContent={
                                <Avatar color="danger" radius="lg" fallback={<FilterIcon />} />
                            }
                            indicator={<FilterIcon />}
                            title="Filters"
                            subtitle={getOptionsSubtitle(Object.keys(filterOptions).length)}
                        >
                            <OptionsSection
                                globalOptions={globalFlags?.filter || {}}
                                optionsJson={filterOptionsJsonString}
                                setOptionsJson={setFilterOptionsJsonString}
                                availableOptions={filterFlags || []}
                                isLocked={filterOptionsLocked}
                                setIsLocked={setFilterOptionsLocked}
                            />
                        </AccordionItem>
                        <AccordionItem
                            key="cron"
                            startContent={
                                <Avatar color="warning" radius="lg" fallback={<ClockIcon />} />
                            }
                            indicator={<ClockIcon />}
                            title="Cron"
                        >
                            <CronEditor expression={cronExpression} onChange={setCronExpression} />
                        </AccordionItem>
                        <AccordionItem
                            key="config"
                            startContent={
                                <Avatar color="default" radius="lg" fallback={<WrenchIcon />} />
                            }
                            indicator={<WrenchIcon />}
                            title="Config"
                            subtitle={getOptionsSubtitle(Object.keys(configOptions).length)}
                        >
                            <OptionsSection
                                globalOptions={globalFlags?.main || {}}
                                optionsJson={configOptionsJsonString}
                                setOptionsJson={setConfigOptionsJsonString}
                                availableOptions={configFlags || []}
                                isLocked={configOptionsLocked}
                                setIsLocked={setConfigOptionsLocked}
                            />
                        </AccordionItem>

                        {selectedRemotes.length > 0 ? (
                            <AccordionItem
                                key={'remotes'}
                                startContent={
                                    <Avatar
                                        className="bg-fuchsia-500"
                                        radius="lg"
                                        fallback={<ServerIcon />}
                                    />
                                }
                                indicator={<ServerIcon />}
                                title={'Remotes'}
                                subtitle={getOptionsSubtitle(
                                    Object.values(remoteOptions).reduce(
                                        (acc, opts) => acc + Object.keys(opts).length,
                                        0
                                    )
                                )}
                            >
                                <RemoteOptionsSection
                                    selectedRemotes={selectedRemotes}
                                    remoteOptionsJsonString={remoteOptionsJsonString}
                                    setRemoteOptionsJsonString={setRemoteOptionsJsonString}
                                    setRemoteOptionsLocked={setRemoteOptionsLocked}
                                    remoteOptionsLocked={remoteOptionsLocked}
                                />
                            </AccordionItem>
                        ) : null}
                    </Accordion>

                    <ShowMoreOptionsBanner />
                </div>
            </OperationWindowContent>

            <OperationWindowFooter>
                <TemplatesDropdown
                    isDisabled={!!jsonError}
                    operation="sync"
                    onSelect={(groupedOptions, shouldMerge) => {
                        startTransition(() => {
                            if (shouldMerge) {
                                if (groupedOptions.sync)
                                    setSyncOptions({ ...syncOptions, ...groupedOptions.sync })
                                if (groupedOptions.filter)
                                    setFilterOptions({ ...filterOptions, ...groupedOptions.filter })
                                if (groupedOptions.config)
                                    setConfigOptions({ ...configOptions, ...groupedOptions.config })
                            } else {
                                if (groupedOptions.sync) setSyncOptions(groupedOptions.sync)
                                if (groupedOptions.filter) setFilterOptions(groupedOptions.filter)
                                if (groupedOptions.config) setConfigOptions(groupedOptions.config)
                            }
                        })
                    }}
                    getOptions={() => ({
                        ...syncOptions,
                        ...filterOptions,
                        ...configOptions,
                    })}
                />
                <AnimatePresence mode="wait" initial={false}>
                    {startSyncMutation.isSuccess ? (
                        <motion.div
                            key="started-buttons"
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            transition={{ duration: 0.2, ease: 'easeOut' }}
                            className="flex flex-1 gap-2"
                        >
                            <Dropdown shadow={platform() === 'windows' ? 'none' : undefined}>
                                <DropdownTrigger>
                                    <Button
                                        fullWidth={true}
                                        color="primary"
                                        size="lg"
                                        data-focus-visible="false"
                                    >
                                        NEW SYNC
                                    </Button>
                                </DropdownTrigger>
                                <DropdownMenu>
                                    <DropdownItem
                                        key="reset-paths"
                                        onPress={() => {
                                            startTransition(() => {
                                                setSource(undefined)
                                                setDest(undefined)
                                                setJsonError(null)
                                                startSyncMutation.reset()
                                            })
                                        }}
                                    >
                                        Reset Paths
                                    </DropdownItem>
                                    <DropdownItem
                                        key="reset-options"
                                        onPress={() => {
                                            startTransition(() => {
                                                setSyncOptionsJsonString(
                                                    JSON.stringify(
                                                        RCLONE_CONFIG_DEFAULTS.copy,
                                                        null,
                                                        2
                                                    )
                                                )
                                                setFilterOptionsJsonString('{}')
                                                setConfigOptionsJsonString(
                                                    JSON.stringify(
                                                        RCLONE_CONFIG_DEFAULTS.config,
                                                        null,
                                                        2
                                                    )
                                                )
                                                setRemoteOptionsJsonString('{}')
                                                setCronExpression(null)
                                                setJsonError(null)
                                                startSyncMutation.reset()
                                            })
                                        }}
                                    >
                                        Reset Options
                                    </DropdownItem>
                                    <DropdownItem
                                        key="reset-all"
                                        onPress={() => {
                                            startTransition(() => {
                                                setSyncOptionsJsonString(
                                                    JSON.stringify(
                                                        RCLONE_CONFIG_DEFAULTS.copy,
                                                        null,
                                                        2
                                                    )
                                                )
                                                setFilterOptionsJsonString('{}')
                                                setConfigOptionsJsonString(
                                                    JSON.stringify(
                                                        RCLONE_CONFIG_DEFAULTS.config,
                                                        null,
                                                        2
                                                    )
                                                )
                                                setRemoteOptionsJsonString('{}')
                                                setSyncOptionsLocked(false)
                                                setFilterOptionsLocked(false)
                                                setConfigOptionsLocked(false)
                                                setRemoteOptionsLocked(false)
                                                setCronExpression(null)
                                                setJsonError(null)
                                                setDest(undefined)
                                                setSource(undefined)
                                                startSyncMutation.reset()
                                            })
                                        }}
                                    >
                                        Reset All
                                    </DropdownItem>
                                </DropdownMenu>
                            </Dropdown>

                            <Button
                                size="lg"
                                color="secondary"
                                fullWidth={true}
                                onPress={async () => {
                                    await openWindow({
                                        name: 'Transfers',
                                        url: '/transfers',
                                    })
                                }}
                                data-focus-visible="false"
                            >
                                VIEW TRANSFERS
                            </Button>
                        </motion.div>
                    ) : (
                        <motion.div
                            key="start-button"
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            transition={{ duration: 0.2, ease: 'easeOut' }}
                            className="flex flex-1"
                        >
                            <Button
                                onPress={() => setTimeout(() => startSyncMutation.mutate(), 100)}
                                size="lg"
                                fullWidth={true}
                                type="button"
                                color="primary"
                                isDisabled={
                                    startSyncMutation.isPending ||
                                    !!jsonError ||
                                    !source ||
                                    !dest ||
                                    source === dest
                                }
                                isLoading={startSyncMutation.isPending}
                                endContent={buttonIcon}
                                className="max-w-2xl gap-2"
                                data-focus-visible="false"
                            >
                                {buttonText}
                            </Button>
                        </motion.div>
                    )}
                </AnimatePresence>
                <ButtonGroup variant="flat">
                    <Tooltip
                        content="Preview (Dry Run)"
                        placement="top"
                        size="lg"
                        color="foreground"
                    >
                        <Button
                            size="lg"
                            type="button"
                            color="primary"
                            isIconOnly={true}
                            isLoading={dryRunMutation.isPending}
                            onPress={() => {
                                if (
                                    dryRunMutation.isPending ||
                                    !!jsonError ||
                                    !source ||
                                    !dest ||
                                    source === dest
                                ) {
                                    return
                                }
                                setTimeout(() => dryRunMutation.mutate(), 100)
                            }}
                        >
                            <EyeIcon className="size-6" />
                        </Button>
                    </Tooltip>
                    <Tooltip content="Schedule task" placement="top" size="lg" color="foreground">
                        <Button
                            size="lg"
                            type="button"
                            color="primary"
                            isIconOnly={true}
                            onPress={() => {
                                setTimeout(() => scheduleTaskMutation.mutate(), 100)
                            }}
                        >
                            <ClockIcon className="size-6" />
                        </Button>
                    </Tooltip>
                    <CommandInfoButton
                        content={`Sync the source to the destination, changing the destination only. Doesn't transfer files that are identical on source and destination, testing by size and modification time or MD5SUM. Destination is updated to match source, including deleting files if necessary (except duplicate objects, see below). If you don't want to delete files from destination, use the COPY command instead.
					
Files in the destination won't be deleted if there were any errors at any point. Duplicate objects (files with the same name, on those providers that support it) are not yet handled.

It is always the contents of the directory that is synced, not the directory itself. So when source:path is a directory, it's the contents of source:path that are copied, not the directory name and contents.

If dest:path doesn't exist, it is created and the source:path contents go there.

It is not possible to sync overlapping remotes. However, you may exclude the destination from the sync with a filter rule or by putting an exclude-if-present file inside the destination directory and sync to a destination that is inside the source directory.

Rclone will sync the modification times of files and directories if the backend supports it.

Here's a quick guide to using the Sync command:

1. SELECT PATHS
Use the path selectors at the top to choose your source and destination. You can select from local filesystem, configured remotes, or favorites. Tap the folder icon to browse, or type a path directly. Use the swap button to quickly switch source and destination.

2. CONFIGURE OPTIONS (Optional)
Expand the accordion sections to customize your sync operation. Tap any chip on the right to add it to the JSON editor. Hover over chips to see what each option does.

• Sync — Multi-threading settings (multi_thread_cutoff, streams, chunk_size), checksum verification, how to handle existing files (ignore_existing), and metadata preservation.

• Filters — Include or exclude files by pattern, limit by size (max_size, min_size) or age (max_age, min_age).

• Cron — Schedule this sync to run automatically at set intervals. The schedule only triggers while the app is running.

• Config — Performance tuning: parallel transfers, checkers, buffer_size, bandwidth limits (bwlimit), and fast_list for faster directory listings on supported remotes.

• Remotes — Override backend-specific settings for remotes involved in this operation.

3. USE TEMPLATES (Optional)
Tap the folder icon in the bottom bar to load or save option presets. Templates let you quickly apply common configurations without manually setting each option.

4. START THE SYNC
Once paths are selected, tap "START SYNC" to begin. You can monitor progress on the Transfers page.`}
                    />
                    <CommandsDropdown currentCommand="sync" />
                </ButtonGroup>
            </OperationWindowFooter>
        </div>
    )
}
