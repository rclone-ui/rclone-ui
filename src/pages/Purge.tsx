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
import { message } from '@tauri-apps/plugin-dialog'
import { platform } from '@tauri-apps/plugin-os'
import cronstrue from 'cronstrue'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertOctagonIcon, ClockIcon, FoldersIcon, PlayIcon, WrenchIcon } from 'lucide-react'
import { startTransition, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { getOptionsSubtitle } from '../../lib/flags'
import { useFlags } from '../../lib/hooks'
import notify from '../../lib/notify'
import { startPurge } from '../../lib/rclone/api'
import { RCLONE_CONFIG_DEFAULTS } from '../../lib/rclone/constants'
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

export default function Purge() {
    const [searchParams] = useSearchParams()
    const { globalFlags, configFlags } = useFlags()

    const [source, setSource] = useState<string | undefined>(
        searchParams.get('initialSource') ? searchParams.get('initialSource')! : undefined
    )

    const [cronExpression, setCronExpression] = useState<string | null>(null)

    const [jsonError, setJsonError] = useState<'config' | null>(null)

    const [configOptionsLocked, setConfigOptionsLocked] = useState(false)
    const [configOptions, setConfigOptions] = useState<Record<string, FlagValue>>({})
    const [configOptionsJsonString, setConfigOptionsJsonString] = useState<string>('{}')

    const startPurgeMutation = useMutation({
        mutationFn: async () => {
            if (!source) {
                throw new Error('Please select a source path')
            }

            return startPurge({
                sources: [source],
                options: {
                    config: configOptions,
                },
            })
        },
        onSuccess: async () => {
            if (cronExpression) {
                scheduleTaskMutation.mutate()
            }
        },
        onError: async (error) => {
            console.error('[Purge] Failed to start purge:', error)
            Sentry.captureException(error)
            await message(error instanceof Error ? error.message : 'Failed to start purge', {
                title: 'Purge',
                kind: 'error',
            })
        },
    })

    const scheduleTaskMutation = useMutation({
        mutationFn: async () => {
            if (!source) {
                throw new Error('Please select a source path to purge')
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
                operation: 'purge',
                cron: cronExpression,
                args: {
                    sources: [source],
                    options: {
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
        if (startPurgeMutation.isPending) return 'STARTING...'
        if (!source) return 'Please select a source path'
        if (jsonError) return 'Invalid JSON for ' + jsonError.toUpperCase() + ' options'
        return 'START PURGE'
    }, [startPurgeMutation.isPending, source, jsonError])

    const buttonIcon = useMemo(() => {
        if (startPurgeMutation.isPending) return
        if (!source) return <FoldersIcon className="w-5 h-5" />
        if (jsonError) return <AlertOctagonIcon className="w-5 h-5" />
        return <PlayIcon className="w-5 h-5 fill-current" />
    }, [startPurgeMutation.isPending, source, jsonError])

    useEffect(() => {
        startTransition(() => {
            setConfigOptionsJsonString(JSON.stringify(RCLONE_CONFIG_DEFAULTS.config, null, 2))
        })
    }, [])

    useEffect(() => {
        const step = 'config'
        try {
            const parsedConfig = JSON.parse(configOptionsJsonString) as Record<string, FlagValue>

            startTransition(() => {
                setConfigOptions(parsedConfig)
                setJsonError(null)
            })
        } catch (error) {
            setJsonError(step)
            console.error(`Error parsing ${step} options:`, error)
        }
    }, [configOptionsJsonString])

    return (
        <div className="flex flex-col h-screen gap-10">
            {/* Main Content */}
            <OperationWindowContent>
                {/* Path Display */}
                <PathField
                    path={source || ''}
                    setPath={setSource}
                    label="Path"
                    placeholder="Enter a remote:/path to purge"
                    showPicker={true}
                    allowedKeys={['REMOTES', 'FAVORITES']}
                    showFiles={false}
                />

                <Accordion
                    keepContentMounted={true}
                    dividerProps={{
                        className: 'opacity-50',
                    }}
                    defaultExpandedKeys={['config', 'cron']}
                >
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
                    operation="purge"
                    onSelect={(groupedOptions, shouldMerge) => {
                        startTransition(() => {
                            if (shouldMerge) {
                                if (groupedOptions.config)
                                    setConfigOptions({ ...configOptions, ...groupedOptions.config })
                            } else if (groupedOptions.config)
                                setConfigOptions(groupedOptions.config)
                        })
                    }}
                    getOptions={() => ({
                        ...configOptions,
                    })}
                />
                <AnimatePresence mode="wait" initial={false}>
                    {startPurgeMutation.isSuccess ? (
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
                                        NEW PURGE
                                    </Button>
                                </DropdownTrigger>
                                <DropdownMenu>
                                    <DropdownItem
                                        key="reset-paths"
                                        onPress={() => {
                                            startTransition(() => {
                                                setSource(undefined)
                                                setJsonError(null)
                                                startPurgeMutation.reset()
                                            })
                                        }}
                                    >
                                        Reset Path
                                    </DropdownItem>
                                    <DropdownItem
                                        key="reset-options"
                                        onPress={() => {
                                            startTransition(() => {
                                                setConfigOptionsJsonString(
                                                    JSON.stringify(
                                                        RCLONE_CONFIG_DEFAULTS.config,
                                                        null,
                                                        2
                                                    )
                                                )
                                                setCronExpression(null)
                                                setJsonError(null)
                                                startPurgeMutation.reset()
                                            })
                                        }}
                                    >
                                        Reset Options
                                    </DropdownItem>
                                    <DropdownItem
                                        key="reset-all"
                                        onPress={() => {
                                            startTransition(() => {
                                                setConfigOptionsJsonString(
                                                    JSON.stringify(
                                                        RCLONE_CONFIG_DEFAULTS.config,
                                                        null,
                                                        2
                                                    )
                                                )
                                                setConfigOptionsLocked(false)
                                                setCronExpression(null)
                                                setJsonError(null)
                                                setSource(undefined)
                                                startPurgeMutation.reset()
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
                                onPress={() => setTimeout(() => startPurgeMutation.mutate(), 100)}
                                size="lg"
                                fullWidth={true}
                                type="button"
                                color="primary"
                                isDisabled={startPurgeMutation.isPending || !!jsonError || !source}
                                isLoading={startPurgeMutation.isPending}
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
                        content={`Removes a path and ALL of its contents.

Purge completely deletes the specified directory and everything inside it — files, subdirectories, everything. This is a destructive operation that cannot be undone.

Important: Purge does NOT obey include/exclude filters. Everything in the path will be removed regardless of any filter settings. If you need to selectively delete specific files while keeping others, use the "Delete" command instead.

Many cloud storage backends (like Google Drive, Dropbox, OneDrive, S3) support server-side purge, which is much faster than deleting files one by one. Rclone will automatically use this when available.

Here's a quick guide to using the Purge command:

1. SELECT PATH
Use the path selector at the top to choose which path to purge. You can select from configured remotes or favorites. Tap the folder icon to browse, or type a path directly. Double-check that you've selected the correct path — purge will delete everything inside it.

2. CONFIGURE OPTIONS (Optional)
Expand the accordion sections to customize your purge operation. Tap any chip on the right to add it to the JSON editor. Hover over chips to see what each option does.

• Config — The "checkers" option controls concurrency for backends that don't support server-side purge. Other global rclone settings are also available here.

• Cron — Schedule this purge to run automatically at set intervals. Useful for automated cleanup of temporary folders. The schedule only triggers while the app is running.

3. USE TEMPLATES (Optional)
Tap the folder icon in the bottom bar to load or save option presets.

4. START THE PURGE
Once a path is selected, tap "START PURGE" to begin. The entire directory and all its contents will be permanently deleted.`}
                    />
                    <CommandsDropdown currentCommand="purge" />
                </ButtonGroup>
            </OperationWindowFooter>
        </div>
    )
}
