import {
    Accordion,
    AccordionItem,
    Alert,
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
import { useMutation, useQuery } from '@tanstack/react-query'
import { invoke } from '@tauri-apps/api/core'
import { message } from '@tauri-apps/plugin-dialog'
import { platform } from '@tauri-apps/plugin-os'
import cronstrue from 'cronstrue'
import { AnimatePresence, motion } from 'framer-motion'
import {
    AlertOctagonIcon,
    ClockIcon,
    FilterIcon,
    FoldersIcon,
    PlayIcon,
    WrenchIcon,
} from 'lucide-react'
import { startTransition, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { getOptionsSubtitle } from '../../lib/flags'
import { getRemoteName } from '../../lib/format'
import { useFlags } from '../../lib/hooks'
import notify from '../../lib/notify'
import { startDelete } from '../../lib/rclone/api'
import rclone from '../../lib/rclone/client'
import { RCLONE_CONFIG_DEFAULTS, SUPPORTS_PURGE } from '../../lib/rclone/constants'
import { useHostStore } from '../../store/host'
import type { FlagValue } from '../../types/rclone'
import CommandInfoButton from '../components/CommandInfoButton'
import CommandsDropdown from '../components/CommandsDropdown'
import CronEditor from '../components/CronEditor'
import OperationWindowContent from '../components/OperationWindowContent'
import OperationWindowFooter from '../components/OperationWindowFooter'
import OptionsSection from '../components/OptionsSection'
import { PathField } from '../components/PathFinder'
import TemplatesDropdown from '../components/TemplatesDropdown'

export default function Delete() {
    const [searchParams] = useSearchParams()
    const { globalFlags, filterFlags, configFlags } = useFlags()

    const [sourceFs, setSourceFs] = useState<string | undefined>(
        searchParams.get('initialSource') ? searchParams.get('initialSource')! : undefined
    )

    const [cronExpression, setCronExpression] = useState<string | null>(null)

    const [jsonError, setJsonError] = useState<'filter' | 'config' | null>(null)

    const [filterOptionsLocked, setFilterOptionsLocked] = useState(false)
    const [filterOptions, setFilterOptions] = useState<Record<string, FlagValue>>({})
    const [filterOptionsJsonString, setFilterOptionsJsonString] = useState<string>('{}')

    const [configOptionsLocked, setConfigOptionsLocked] = useState(false)
    const [configOptions, setConfigOptions] = useState<Record<string, FlagValue>>({})
    const [configOptionsJsonString, setConfigOptionsJsonString] = useState<string>('{}')

    const sourceRemoteName = useMemo(() => getRemoteName(sourceFs), [sourceFs])

    const sourceRemoteConfigQuery = useQuery({
        queryKey: ['remote', sourceRemoteName, 'config'],
        queryFn: async () => {
            return await rclone('/config/get', {
                params: {
                    query: {
                        name: sourceRemoteName!,
                    },
                },
            })
        },
        enabled: !!sourceRemoteName,
    })

    const supportsPurge = useMemo(
        () =>
            sourceRemoteConfigQuery.data
                ? SUPPORTS_PURGE.includes(sourceRemoteConfigQuery.data.type)
                : false,
        [sourceRemoteConfigQuery.data]
    )

    useEffect(() => {
        startTransition(() => {
            setConfigOptionsJsonString(JSON.stringify(RCLONE_CONFIG_DEFAULTS.config, null, 2))
        })
    }, [])

    useEffect(() => {
        let step: 'filter' | 'config' = 'filter'
        try {
            const parsedFilter = JSON.parse(filterOptionsJsonString) as Record<string, FlagValue>

            step = 'config'
            const parsedConfig = JSON.parse(configOptionsJsonString) as Record<string, FlagValue>

            startTransition(() => {
                setFilterOptions(parsedFilter)
                setConfigOptions(parsedConfig)
                setJsonError(null)
            })
        } catch (error) {
            setJsonError(step)
            console.error(`Error parsing ${step} options:`, error)
        }
    }, [filterOptionsJsonString, configOptionsJsonString])

    const startDeleteMutation = useMutation({
        mutationFn: async () => {
            if (!sourceFs) {
                throw new Error('Please select a source path to delete')
            }

            return startDelete({
                sources: [sourceFs],
                options: {
                    filter: filterOptions,
                    config: configOptions,
                },
            })
        },
        onSuccess: async () => {
            await notify({
                title: 'Success',
                body: 'Delete task started',
            })
            if (cronExpression) {
                scheduleTaskMutation.mutate()
            }
        },
        onError: (error) => {
            console.error('Error starting delete:', error)
            Sentry.captureException(error)
        },
    })

    const scheduleTaskMutation = useMutation({
        mutationFn: async () => {
            if (!sourceFs) {
                throw new Error('Please select a source path to delete')
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
                operation: 'delete',
                cron: cronExpression,
                args: {
                    sources: [sourceFs],
                    options: {
                        filter: filterOptions,
                        config: configOptions,
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

    const buttonText = useMemo(() => {
        if (startDeleteMutation.isPending) return 'STARTING...'
        if (!sourceFs || sourceFs.length === 0) return 'Please select a source path'
        if (jsonError) return 'Invalid JSON for ' + jsonError.toUpperCase() + ' options'
        return 'START DELETE'
    }, [startDeleteMutation.isPending, sourceFs, jsonError])

    const buttonIcon = useMemo(() => {
        if (startDeleteMutation.isPending) return
        if (!sourceFs || sourceFs.length === 0) return <FoldersIcon className="w-5 h-5" />
        if (jsonError) return <AlertOctagonIcon className="w-5 h-5" />
        return <PlayIcon className="w-5 h-5 fill-current" />
    }, [startDeleteMutation.isPending, sourceFs, jsonError])

    return (
        <div className="flex flex-col h-screen gap-10">
            {/* Main Content */}
            <OperationWindowContent>
                {/* Path Display */}
                <PathField
                    path={sourceFs || ''}
                    setPath={setSourceFs}
                    label="Path"
                    placeholder="Enter a remote:/path to delete"
                    showPicker={true}
                    allowedKeys={['REMOTES', 'FAVORITES']}
                    showFiles={true}
                />

                {supportsPurge && (
                    <Alert
                        color="primary"
                        title="LET ME SHARE A TIP"
                        variant="faded"
                        className="min-h-none h-fit max-h-fit"
                    >
                        If you're deleting a entire folder, "{sourceRemoteName}" supports Purge
                        which is more efficient!
                    </Alert>
                )}

                <Accordion
                    keepContentMounted={true}
                    dividerProps={{
                        className: 'opacity-50',
                    }}
                >
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
                            globalOptions={globalFlags?.filter ?? {}}
                            optionsJson={filterOptionsJsonString}
                            setOptionsJson={setFilterOptionsJsonString}
                            availableOptions={filterFlags || []}
                            isLocked={filterOptionsLocked}
                            setIsLocked={setFilterOptionsLocked}
                        />
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
                            globalOptions={globalFlags?.main ?? {}}
                            optionsJson={configOptionsJsonString}
                            setOptionsJson={setConfigOptionsJsonString}
                            availableOptions={configFlags || []}
                            isLocked={configOptionsLocked}
                            setIsLocked={setConfigOptionsLocked}
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
                </Accordion>
            </OperationWindowContent>

            <OperationWindowFooter>
                <TemplatesDropdown
                    isDisabled={!!jsonError}
                    operation="delete"
                    onSelect={(groupedOptions, shouldMerge) => {
                        startTransition(() => {
                            if (shouldMerge) {
                                if (groupedOptions.filter)
                                    setFilterOptions({ ...filterOptions, ...groupedOptions.filter })
                                if (groupedOptions.config)
                                    setConfigOptions({ ...configOptions, ...groupedOptions.config })
                            } else {
                                if (groupedOptions.filter) setFilterOptions(groupedOptions.filter)
                                if (groupedOptions.config) setConfigOptions(groupedOptions.config)
                            }
                        })
                    }}
                    getOptions={() => ({
                        ...filterOptions,
                        ...configOptions,
                    })}
                />
                <AnimatePresence mode="wait" initial={false}>
                    {startDeleteMutation.isSuccess ? (
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
                                    <Button fullWidth={true} size="lg" data-focus-visible="false">
                                        NEW DELETE
                                    </Button>
                                </DropdownTrigger>
                                <DropdownMenu>
                                    <DropdownItem
                                        key="reset-paths"
                                        onPress={() => {
                                            startTransition(() => {
                                                setSourceFs(undefined)
                                                setJsonError(null)
                                                startDeleteMutation.reset()
                                            })
                                        }}
                                    >
                                        Reset Path
                                    </DropdownItem>
                                    <DropdownItem
                                        key="reset-options"
                                        onPress={() => {
                                            startTransition(() => {
                                                setFilterOptionsJsonString('{}')
                                                setConfigOptionsJsonString(
                                                    JSON.stringify(
                                                        RCLONE_CONFIG_DEFAULTS.config,
                                                        null,
                                                        2
                                                    )
                                                )
                                                setCronExpression(null)
                                                setJsonError(null)
                                                startDeleteMutation.reset()
                                            })
                                        }}
                                    >
                                        Reset Options
                                    </DropdownItem>
                                    <DropdownItem
                                        key="reset-all"
                                        onPress={() => {
                                            startTransition(() => {
                                                setFilterOptionsJsonString('{}')
                                                setConfigOptionsJsonString(
                                                    JSON.stringify(
                                                        RCLONE_CONFIG_DEFAULTS.config,
                                                        null,
                                                        2
                                                    )
                                                )
                                                setFilterOptionsLocked(false)
                                                setConfigOptionsLocked(false)
                                                setCronExpression(null)
                                                setJsonError(null)
                                                setSourceFs(undefined)
                                                startDeleteMutation.reset()
                                            })
                                        }}
                                    >
                                        Reset All
                                    </DropdownItem>
                                </DropdownMenu>
                            </Dropdown>
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
                                onPress={() => setTimeout(() => startDeleteMutation.mutate(), 100)}
                                size="lg"
                                fullWidth={true}
                                type="button"
                                color="primary"
                                isDisabled={
                                    startDeleteMutation.isPending ||
                                    !!jsonError ||
                                    !sourceFs ||
                                    sourceFs.length === 0
                                }
                                isLoading={startDeleteMutation.isPending}
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
                        content={`Removes files from the specified path.

Unlike "Purge", Delete obeys include/exclude filters, so you can use it to selectively delete specific files. Delete only removes files but leaves the directory structure intact — empty folders will remain after the files are deleted.

If you want to delete an entire directory and all of its contents (ignoring filters), use the Purge command instead. Purge is also more efficient for deleting entire folders on remotes that support server-side deletion.

Here's a quick guide to using the Delete command:

1. SELECT PATH
Use the path selector at the top to choose which path to delete files from. You can select from configured remotes or favorites. Tap the folder icon to browse, or type a path directly.

2. CONFIGURE OPTIONS (Optional)
Expand the accordion sections to customize your delete operation. Tap any chip on the right to add it to the JSON editor. Hover over chips to see what each option does.

• Filters — This is where Delete really shines. Use include/exclude patterns to selectively delete specific files. For example, delete only .tmp files, or only files older than a certain age (max_age), or only files larger than a certain size (min_size).

• Config — Performance tuning: parallel checkers, and other global rclone settings.

• Cron — Schedule this delete to run automatically at set intervals. Useful for automated cleanup tasks. The schedule only triggers while the app is running.

3. USE TEMPLATES (Optional)
Tap the folder icon in the bottom bar to load or save option presets. Templates let you quickly apply common filter configurations for recurring cleanup tasks.

4. START THE DELETE
Once a path is selected, tap "START DELETE" to begin. The operation will delete all files matching your filters (or all files if no filters are set). Empty directories will be left behind unless you use the rmdirs option.`}
                    />
                    <CommandsDropdown currentCommand="delete" />
                </ButtonGroup>
            </OperationWindowFooter>
        </div>
    )
}
