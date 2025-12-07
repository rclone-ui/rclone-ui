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
    Switch,
    Tooltip,
} from '@heroui/react'
import { useMutation } from '@tanstack/react-query'
import { message } from '@tauri-apps/plugin-dialog'
import { platform } from '@tauri-apps/plugin-os'
import cronstrue from 'cronstrue'
import { AnimatePresence, motion } from 'framer-motion'
import {
    AlertOctagonIcon,
    ClockIcon,
    DiamondPercentIcon,
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
import { startBisync } from '../../lib/rclone/api'
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
import TemplatesDropdown from '../components/TemplatesDropdown'

export default function Bisync() {
    const [searchParams] = useSearchParams()
    const { globalFlags, filterFlags, configFlags, copyFlags } = useFlags()

    const [source, setSource] = useState<string | undefined>(
        searchParams.get('initialSource') ? searchParams.get('initialSource')! : undefined
    )
    const [dest, setDest] = useState<string | undefined>(
        searchParams.get('initialDestination') ? searchParams.get('initialDestination')! : undefined
    )

    const [jsonError, setJsonError] = useState<'bisync' | 'filter' | 'config' | 'remote' | null>(
        null
    )

    const [bisyncOptionsLocked, setBisyncOptionsLocked] = useState(false)
    const [bisyncOptions, setBisyncOptions] = useState<Record<string, FlagValue>>({})
    const [bisyncOptionsJsonString, setBisyncOptionsJsonString] = useState<string>('{}')
    const [outerBisyncOptions, setOuterBisyncOptions] = useState<Record<string, boolean>>({})

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

    const startBisyncMutation = useMutation({
        mutationFn: async () => {
            if (!source || !dest) {
                throw new Error('Please select both a source and destination path')
            }

            return startBisync({
                source: source,
                destination: dest,
                options: {
                    config: configOptions,
                    bisync: bisyncOptions,
                    filter: filterOptions,
                    remotes: remoteOptions,
                    outer: outerBisyncOptions,
                },
            })
        },
        onSuccess: () => {
            if (cronExpression) {
                scheduleTaskMutation.mutate()
            }
        },
        onError: async (error) => {
            console.error('Error starting bisync:', error)
            const errorMessage =
                error instanceof Error ? error.message : 'Failed to start bisync operation'
            await message(errorMessage, {
                title: 'Bisync',
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

            useHostStore.getState().addScheduledTask({
                operation: 'bisync',
                cron: cronExpression,
                args: {
                    source,
                    destination: dest,
                    options: {
                        config: configOptions,
                        bisync: bisyncOptions,
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
            setBisyncOptionsJsonString(JSON.stringify(RCLONE_CONFIG_DEFAULTS.copy, null, 2))
        })
    }, [])

    useEffect(() => {
        let step: 'bisync' | 'filter' | 'config' | 'remote' = 'bisync'
        try {
            const parsedBisync = JSON.parse(bisyncOptionsJsonString) as Record<string, FlagValue>

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
                setBisyncOptions(parsedBisync)
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
        bisyncOptionsJsonString,
        filterOptionsJsonString,
        configOptionsJsonString,
        remoteOptionsJsonString,
    ])

    const buttonText = useMemo(() => {
        if (startBisyncMutation.isPending) return 'STARTING...'
        if (!source) return 'Please select a source path'
        if (!dest) return 'Please select a destination path'
        if (source === dest) return 'Source and destination cannot be the same'
        if (jsonError) return 'Invalid JSON for ' + jsonError.toUpperCase() + ' options'
        return 'START BISYNC'
    }, [startBisyncMutation.isPending, source, dest, jsonError])

    const buttonIcon = useMemo(() => {
        if (startBisyncMutation.isPending) return
        if (!source || !dest || source === dest) return <FoldersIcon className="w-5 h-5" />
        if (jsonError) return <AlertOctagonIcon className="w-5 h-5" />
        return <PlayIcon className="w-5 h-5 fill-current" />
    }, [startBisyncMutation.isPending, source, dest, jsonError])

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
                />

                <Accordion
                    keepContentMounted={true}
                    dividerProps={{
                        className: 'opacity-50',
                    }}
                >
                    <AccordionItem
                        key="bisync"
                        startContent={
                            <Avatar
                                className="bg-lime-500"
                                radius="lg"
                                fallback={
                                    <DiamondPercentIcon className="text-success-foreground" />
                                }
                            />
                        }
                        indicator={<DiamondPercentIcon />}
                        title="Bisync"
                        subtitle={getOptionsSubtitle(Object.keys(bisyncOptions).length)}
                    >
                        <div className="flex flex-row flex-wrap gap-2 pb-5">
                            <Switch
                                isSelected={outerBisyncOptions?.resync}
                                onValueChange={(value) =>
                                    setOuterBisyncOptions({
                                        ...outerBisyncOptions,
                                        resync: value,
                                    })
                                }
                                size="sm"
                            >
                                resync
                            </Switch>

                            <Switch
                                isSelected={outerBisyncOptions?.checkAccess}
                                onValueChange={(value) =>
                                    setOuterBisyncOptions({
                                        ...outerBisyncOptions,
                                        checkAccess: value,
                                    })
                                }
                                size="sm"
                            >
                                checkAccess
                            </Switch>

                            <Switch
                                isSelected={outerBisyncOptions?.force}
                                onValueChange={(value) =>
                                    setOuterBisyncOptions({
                                        ...outerBisyncOptions,
                                        force: value,
                                    })
                                }
                                size="sm"
                            >
                                force
                            </Switch>

                            <Switch
                                isSelected={outerBisyncOptions?.createEmptySrcDirs}
                                onValueChange={(value) =>
                                    setOuterBisyncOptions({
                                        ...outerBisyncOptions,
                                        createEmptySrcDirs: value,
                                    })
                                }
                                size="sm"
                            >
                                createEmptySrcDirs
                            </Switch>

                            <Switch
                                isSelected={outerBisyncOptions?.removeEmptyDirs}
                                onValueChange={(value) =>
                                    setOuterBisyncOptions({
                                        ...outerBisyncOptions,
                                        removeEmptyDirs: value,
                                    })
                                }
                                size="sm"
                            >
                                removeEmptyDirs
                            </Switch>

                            <Switch
                                isSelected={outerBisyncOptions?.ignoreListingChecksum}
                                onValueChange={(value) =>
                                    setOuterBisyncOptions({
                                        ...outerBisyncOptions,
                                        ignoreListingChecksum: value,
                                    })
                                }
                                size="sm"
                            >
                                ignoreListingChecksum
                            </Switch>

                            <Switch
                                isSelected={outerBisyncOptions?.resilient}
                                onValueChange={(value) =>
                                    setOuterBisyncOptions({
                                        ...outerBisyncOptions,
                                        resilient: value,
                                    })
                                }
                                size="sm"
                            >
                                resilient
                            </Switch>

                            <Switch
                                isSelected={outerBisyncOptions?.noCleanup}
                                onValueChange={(value) =>
                                    setOuterBisyncOptions({
                                        ...outerBisyncOptions,
                                        noCleanup: value,
                                    })
                                }
                                size="sm"
                            >
                                noCleanup
                            </Switch>
                        </div>
                        <OptionsSection
                            globalOptions={globalFlags?.main || {}}
                            optionsJson={bisyncOptionsJsonString}
                            setOptionsJson={setBisyncOptionsJsonString}
                            availableOptions={copyFlags || []}
                            isLocked={bisyncOptionsLocked}
                            setIsLocked={setBisyncOptionsLocked}
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
            </OperationWindowContent>

            <OperationWindowFooter>
                <TemplatesDropdown
                    isDisabled={!!jsonError}
                    operation="bisync"
                    onSelect={(groupedOptions, shouldMerge) => {
                        startTransition(() => {
                            if (shouldMerge) {
                                if (groupedOptions.copy)
                                    setBisyncOptions({ ...bisyncOptions, ...groupedOptions.copy })
                                if (groupedOptions.filter)
                                    setFilterOptions({ ...filterOptions, ...groupedOptions.filter })
                                if (groupedOptions.config)
                                    setConfigOptions({ ...configOptions, ...groupedOptions.config })
                            } else {
                                if (groupedOptions.copy) setBisyncOptions(groupedOptions.copy)
                                if (groupedOptions.filter) setFilterOptions(groupedOptions.filter)
                                if (groupedOptions.config) setConfigOptions(groupedOptions.config)
                            }
                        })
                    }}
                    getOptions={() => ({
                        ...bisyncOptions,
                        ...filterOptions,
                        ...configOptions,
                    })}
                />
                <AnimatePresence mode="wait" initial={false}>
                    {startBisyncMutation.isSuccess ? (
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
                                        NEW BISYNC
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
                                                startBisyncMutation.reset()
                                            })
                                        }}
                                    >
                                        Reset Paths
                                    </DropdownItem>
                                    <DropdownItem
                                        key="reset-options"
                                        onPress={() => {
                                            startTransition(() => {
                                                setBisyncOptionsJsonString(
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
                                                setOuterBisyncOptions({})
                                                setJsonError(null)
                                                startBisyncMutation.reset()
                                            })
                                        }}
                                    >
                                        Reset Options
                                    </DropdownItem>
                                    <DropdownItem
                                        key="reset-all"
                                        onPress={() => {
                                            startTransition(() => {
                                                setBisyncOptionsJsonString(
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
                                                setOuterBisyncOptions({})
                                                setBisyncOptionsLocked(false)
                                                setFilterOptionsLocked(false)
                                                setConfigOptionsLocked(false)
                                                setRemoteOptionsLocked(false)
                                                setJsonError(null)
                                                setSource(undefined)
                                                setDest(undefined)
                                                startBisyncMutation.reset()
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
                                onPress={() => setTimeout(() => startBisyncMutation.mutate(), 100)}
                                size="lg"
                                fullWidth={true}
                                type="button"
                                color="primary"
                                isDisabled={
                                    startBisyncMutation.isPending ||
                                    !!jsonError ||
                                    !source ||
                                    !dest ||
                                    source === dest
                                }
                                isLoading={startBisyncMutation.isPending}
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
                    <Tooltip content={'Schedule task'} placement="top" size="lg" color="foreground">
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
                        content={`Performs bidirectional synchronization between two paths.

Bisync keeps both Path1 and Path2 in sync by propagating changes in both directions. On each run, it compares the current state to the previous run and detects New, Newer, Older, and Deleted files on each side, then propagates those changes to the other path.

Bisync retains the filesystem listings from the prior run. This history allows it to determine what has changed since the last sync. If something evil happens, bisync goes into a safe state to block damage by later runs — you may need to run with resync to recover.

This is an advanced command — use with care. Unlike Copy or Sync which have a clear "source of truth", Bisync must resolve conflicts when both sides have changed. When a file changes on both sides and the versions differ, bisync will rename both versions as conflicts (e.g., file.conflict1, file.conflict2) so nothing is lost. Make sure you understand the behavior before using on important data.

If you only need one-way synchronization (making destination match source), use the SYNC command instead.

Here's a quick guide to using the Bisync command:

1. SELECT PATHS
Use the path selectors at the top to choose Path1 and Path2. Both paths will be kept in sync with each other — there is no "source" or "destination", changes flow both ways.

2. CONFIGURE OPTIONS (Optional)
Expand the accordion sections to customize your bisync operation. The Bisync section has important switches at the top:

• resync — Required for the first run, or to reset bisync after an error. This makes both paths contain a matching superset of all files by copying Path2 to Path1, then Path1 to Path2. Only use resync when starting fresh, after changing filter settings, or recovering from an error — using it routinely would prevent deletions from syncing (deleted files would keep reappearing from the other side).

• checkAccess — Safety check that looks for matching RCLONE_TEST files on both paths before syncing. You must first create these files yourself in both paths. This prevents data loss if a path is temporarily unavailable or mounted incorrectly.

• force — Override safety checks like max-delete protection. Use with caution, as this bypasses safeguards designed to prevent accidental mass deletions.

• createEmptySrcDirs — Sync empty directories as well as files. Without this, only files are synced and empty directories are ignored.

• removeEmptyDirs — Remove directories that become empty after syncing. Not compatible with createEmptySrcDirs — use one or the other.

• ignoreListingChecksum — Skip checksum retrieval when creating file listings, which can speed things up considerably on backends where hashes must be computed on the fly (like local). Note this only affects listing comparisons, not the actual sync operations.

• resilient — Allow bisync to retry on the next run after certain errors, instead of requiring a resync. Useful for running bisync as a scheduled background process. Combine with --recover and --max-lock for a robust "set-it-and-forget-it" setup.

• noCleanup — Don't delete temporary working files after the operation. Useful for debugging issues, but normally you should leave this off.

3. OTHER OPTIONS
Tap any chip on the right to add it to the JSON editor. Hover over chips to see what each option does.

• Filters — Include or exclude files by pattern, limit by size (max_size, min_size) or age (max_age, min_age).

• Config — Performance tuning: parallel transfers, checkers, buffer_size, bandwidth limits (bwlimit), and fast_list for faster directory listings on supported remotes.

• Remotes — Override backend-specific settings for remotes involved in this operation.

4. START BISYNC
Once paths are selected, tap "START BISYNC" to begin. For your first run, make sure "resync" is enabled to establish the initial baseline. You can monitor progress on the Transfers page.`}
                    />
                    <CommandsDropdown currentCommand="bisync" />
                </ButtonGroup>
            </OperationWindowFooter>
        </div>
    )
}
