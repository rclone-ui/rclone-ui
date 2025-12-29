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
import { useMutation } from '@tanstack/react-query'
import { invoke } from '@tauri-apps/api/core'
import { message } from '@tauri-apps/plugin-dialog'
import { platform } from '@tauri-apps/plugin-os'
import cronstrue from 'cronstrue'
import { AnimatePresence, motion } from 'framer-motion'
import {
    AlertOctagonIcon,
    ClockIcon,
    CopyIcon,
    FilterIcon,
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
import { startCopy } from '../../lib/rclone/api'
import { RCLONE_CONFIG_DEFAULTS } from '../../lib/rclone/constants'
import { openWindow } from '../../lib/window'
import { useHostStore } from '../../store/host'
import { usePersistedStore } from '../../store/persisted'
import type { FlagValue } from '../../types/rclone'
import CommandInfoButton from '../components/CommandInfoButton'
import CommandsDropdown from '../components/CommandsDropdown'
import CronEditor from '../components/CronEditor'
import OperationWindowContent from '../components/OperationWindowContent'
import OperationWindowFooter from '../components/OperationWindowFooter'
import OptionsSection from '../components/OptionsSection'
import { MultiPathFinder } from '../components/PathFinder'
import RemoteOptionsSection from '../components/RemoteOptionsSection'
import ShowMoreOptionsBanner from '../components/ShowMoreOptionsBanner'
import TemplatesDropdown from '../components/TemplatesDropdown'

export default function Copy() {
    const [searchParams] = useSearchParams()
    const { globalFlags, filterFlags, configFlags, copyFlags } = useFlags()

    const [sources, setSources] = useState<string[] | undefined>(
        searchParams.get('initialSource') ? [searchParams.get('initialSource')!] : undefined
    )
    const [dest, setDest] = useState<string | undefined>(
        searchParams.get('initialDest') ? searchParams.get('initialDest')! : undefined
    )

    const [jsonError, setJsonError] = useState<'copy' | 'filter' | 'config' | 'remote' | null>(null)

    const [copyOptionsLocked, setCopyOptionsLocked] = useState(false)
    const [copyOptions, setCopyOptions] = useState<Record<string, FlagValue>>({})
    const [copyOptionsJsonString, setCopyOptionsJsonString] = useState<string>('{}')

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

    const selectedRemotes = useMemo(
        () => [...(sources || []), dest].filter(Boolean),
        [sources, dest]
    )

    const startCopyMutation = useMutation({
        mutationFn: async () => {
            if (!sources || sources.length === 0 || !dest) {
                throw new Error('Please select both a source and destination path')
            }

            return startCopy({
                sources,
                destination: dest,
                options: {
                    config: configOptions,
                    copy: copyOptions,
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
            console.error('Error starting copy:', error)
            await message(error instanceof Error ? error.message : 'Failed to start copy', {
                title: 'Copy',
                kind: 'error',
            })
        },
    })

    const scheduleTaskMutation = useMutation({
        mutationFn: async () => {
            if (!sources || sources.length === 0 || !dest) {
                throw new Error('Please select both a source and destination path')
            }

            if (sources.length > 1 && !usePersistedStore.getState().licenseValid) {
                throw new Error('You need a valid license to schedule multiple tasks at once')
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
                operation: 'copy',
                cron: cronExpression,
                args: {
                    sources,
                    destination: dest,
                    options: {
                        config: configOptions,
                        copy: copyOptions,
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

    useEffect(() => {
        startTransition(() => {
            setConfigOptionsJsonString(JSON.stringify(RCLONE_CONFIG_DEFAULTS.config, null, 2))
            setCopyOptionsJsonString(JSON.stringify(RCLONE_CONFIG_DEFAULTS.copy, null, 2))
        })
    }, [])

    useEffect(() => {
        let step: 'copy' | 'filter' | 'config' | 'remote' = 'copy'
        try {
            const parsedCopy = JSON.parse(copyOptionsJsonString) as Record<string, FlagValue>

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
                setCopyOptions(parsedCopy)
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
        copyOptionsJsonString,
        filterOptionsJsonString,
        configOptionsJsonString,
        remoteOptionsJsonString,
    ])

    const buttonText = useMemo(() => {
        if (startCopyMutation.isPending) return 'STARTING...'
        if (!sources || sources.length === 0) return 'Please select a source path'
        if (!dest) return 'Please select a destination path'
        if (sources[0] === dest) return 'Source and destination cannot be the same'
        if (jsonError) return 'Invalid JSON for ' + jsonError.toUpperCase() + ' options'
        return 'START COPY'
    }, [startCopyMutation.isPending, sources, dest, jsonError])

    const buttonIcon = useMemo(() => {
        if (startCopyMutation.isPending) return
        if (!sources || sources.length === 0 || !dest || sources[0] === dest)
            return <FoldersIcon className="w-5 h-5" />
        if (jsonError) return <AlertOctagonIcon className="w-5 h-5" />
        return <PlayIcon className="w-5 h-5 fill-current" />
    }, [startCopyMutation.isPending, sources, dest, jsonError])

    useEffect(() => {
        console.log('[Copy] remoteOptions', remoteOptions)
        console.log('[Copy] remoteOptionsJsonString', remoteOptionsJsonString)
    }, [remoteOptionsJsonString, remoteOptions])

    return (
        <div className="flex flex-col h-screen gap-10">
            {/* Main Content */}
            <OperationWindowContent>
                {/* Paths Display */}
                <MultiPathFinder
                    sourcePaths={sources}
                    setSourcePaths={setSources}
                    destPath={dest}
                    setDestPath={setDest}
                />

                <div className="relative flex flex-col">
                    <Accordion
                        keepContentMounted={true}
                        dividerProps={{
                            className: 'opacity-50',
                        }}
                    >
                        <AccordionItem
                            key="copy"
                            startContent={
                                <Avatar color="primary" radius="lg" fallback={<CopyIcon />} />
                            }
                            indicator={<CopyIcon />}
                            title="Copy"
                            subtitle={getOptionsSubtitle(Object.keys(copyOptions).length)}
                        >
                            <OptionsSection
                                globalOptions={globalFlags?.main || {}}
                                optionsJson={copyOptionsJsonString}
                                setOptionsJson={setCopyOptionsJsonString}
                                availableOptions={copyFlags || []}
                                isLocked={copyOptionsLocked}
                                setIsLocked={setCopyOptionsLocked}
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
                    operation="copy"
                    onSelect={(groupedOptions, shouldMerge) => {
                        startTransition(() => {
                            if (shouldMerge) {
                                if (groupedOptions.copy)
                                    setCopyOptions({ ...copyOptions, ...groupedOptions.copy })
                                if (groupedOptions.filter)
                                    setFilterOptions({ ...filterOptions, ...groupedOptions.filter })
                                if (groupedOptions.config)
                                    setConfigOptions({ ...configOptions, ...groupedOptions.config })
                            } else {
                                if (groupedOptions.copy) setCopyOptions(groupedOptions.copy)
                                if (groupedOptions.filter) setFilterOptions(groupedOptions.filter)
                                if (groupedOptions.config) setConfigOptions(groupedOptions.config)
                            }
                        })
                    }}
                    getOptions={() => ({
                        ...copyOptions,
                        ...filterOptions,
                        ...configOptions,
                    })}
                />
                <AnimatePresence mode="wait" initial={false}>
                    {startCopyMutation.isSuccess ? (
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
                                        size="lg"
                                        color="primary"
                                        data-focus-visible="false"
                                    >
                                        NEW COPY
                                    </Button>
                                </DropdownTrigger>
                                <DropdownMenu>
                                    <DropdownItem
                                        key="reset-paths"
                                        onPress={() => {
                                            startTransition(() => {
                                                setSources(undefined)
                                                setDest(undefined)
                                                setJsonError(null)
                                                startCopyMutation.reset()
                                            })
                                        }}
                                    >
                                        Reset Paths
                                    </DropdownItem>
                                    <DropdownItem
                                        key="reset-options"
                                        onPress={() => {
                                            startTransition(() => {
                                                setCopyOptionsJsonString(
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
                                                startCopyMutation.reset()
                                            })
                                        }}
                                    >
                                        Reset Options
                                    </DropdownItem>
                                    <DropdownItem
                                        key="reset-all"
                                        onPress={() => {
                                            startTransition(() => {
                                                setCopyOptionsJsonString(
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
                                                setCopyOptionsLocked(false)
                                                setFilterOptionsLocked(false)
                                                setConfigOptionsLocked(false)
                                                setRemoteOptionsLocked(false)
                                                setCronExpression(null)
                                                setJsonError(null)
                                                setSources(undefined)
                                                setDest(undefined)
                                                startCopyMutation.reset()
                                            })
                                        }}
                                    >
                                        Reset All
                                    </DropdownItem>
                                </DropdownMenu>
                            </Dropdown>

                            <Button
                                fullWidth={true}
                                size="lg"
                                color="secondary"
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
                                onPress={() => setTimeout(() => startCopyMutation.mutate(), 100)}
                                size="lg"
                                fullWidth={true}
                                type="button"
                                color="primary"
                                isDisabled={
                                    startCopyMutation.isPending ||
                                    !!jsonError ||
                                    !sources ||
                                    sources.length === 0 ||
                                    !dest ||
                                    sources[0] === dest
                                }
                                isLoading={startCopyMutation.isPending}
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
                        content={`Copies the source(s) to the destination.

Does not transfer files that are identical on source and destination (testing by size and modification time or MD5SUM). Does not delete files from the destination. If the destination path doesn't exist, it will be created automatically.

If you want to also delete files from the destination to make it match the source exactly, use the SYNC command instead.

Here's a quick guide to using the Copy command:

1. SELECT PATHS
Use the path selectors at the top to choose your source(s) and destination. You can select from local filesystem, configured remotes, or favorites. Tap the folder icon to browse, or type a path directly. Use the swap button to quickly switch source and destination.

2. CONFIGURE OPTIONS (Optional)
Expand the accordion sections to customize your copy operation. Tap any chip on the right to add it to the JSON editor. Hover over chips to see what each option does.

• Copy — Multi-threading settings (multi_thread_cutoff, streams, chunk_size), checksum verification, how to handle existing files (ignore_existing), and metadata preservation.

• Filters — Include or exclude files by pattern, limit by size (max_size, min_size) or age (max_age, min_age).

• Cron — Schedule this copy to run automatically at set intervals. The schedule only triggers while the app is running.

• Config — Performance tuning: parallel transfers, checkers, buffer_size, bandwidth limits (bwlimit), and fast_list for faster directory listings on supported remotes.

• Remotes — Override backend-specific settings for remotes involved in this operation.

3. USE TEMPLATES (Optional)
Tap the folder icon in the bottom bar to load or save option presets. Templates let you quickly apply common configurations without manually setting each option.

4. START THE COPY
Once paths are selected, tap "START COPY" to begin. You can monitor progress on the Transfers page.`}
                    />
                    <CommandsDropdown currentCommand="copy" />
                </ButtonGroup>
            </OperationWindowFooter>
        </div>
    )
}
