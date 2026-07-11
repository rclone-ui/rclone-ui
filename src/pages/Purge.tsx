import { useMutation } from '@tanstack/react-query'
import { AlertOctagonIcon, FoldersIcon, PlayIcon } from 'lucide-react'
import { startTransition, useCallback, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { onErrorDialog } from '../../lib/errors'
import { getOptionsSubtitle } from '../../lib/flags'
import { useFlags } from '../../lib/hooks'
import { startPurge } from '../../lib/rclone/api'
import { RCLONE_CONFIG_DEFAULTS } from '../../lib/rclone/constants'
import OperationWindowContent from '../components/OperationWindowContent'
import OperationWindowFooter from '../components/OperationWindowFooter'
import OptionsSection from '../components/OptionsSection'
import { PathField } from '../components/PathFinder'
import AdvancedScheduleSection, {
    useAdvancedSchedule,
} from '../components/operation/AdvancedScheduleSection'
import OperationFooter from '../components/operation/OperationFooter'
import OptionsAccordion, {
    type OptionsAccordionItemDef,
} from '../components/operation/OptionsAccordion'
import { useOptionGroups } from '../components/operation/useOptionGroups'
import { useScheduleTask } from '../components/operation/useScheduleTask'

const PATH_ALLOWED_KEYS: ('LOCAL_FS' | 'FAVORITES' | 'REMOTES')[] = ['REMOTES', 'FAVORITES']

const DEFAULT_EXPANDED_KEYS = ['config']

const HELP_CONTENT = `Removes a path and ALL of its contents.

Purge completely deletes the specified directory and everything inside it — files, subdirectories, everything. This is a destructive operation that cannot be undone.

Important: Purge does NOT obey include/exclude filters. Everything in the path will be removed regardless of any filter settings. If you need to selectively delete specific files while keeping others, use the "Delete" command instead.

Many cloud storage backends (like Google Drive, Dropbox, OneDrive, S3) support server-side purge, which is much faster than deleting files one by one. Rclone will automatically use this when available.

Here's a quick guide to using the Purge command:

1. SELECT PATH
Use the path selector at the top to choose which path to purge. You can select from configured remotes or favorites. Tap the folder icon to browse, or type a path directly. Double-check that you've selected the correct path — purge will delete everything inside it.

2. CONFIGURE OPTIONS (Optional)
Expand the accordion sections to customize your purge operation. Tap any chip on the right to add it to the JSON editor. Hover over chips to see what each option does.

• Config — The "checkers" option controls concurrency for backends that don't support server-side purge. Other global rclone settings are also available here.

• Cron — Schedule this purge to run automatically at set intervals. Useful for automated cleanup of temporary folders. It runs on a system schedule, even when the app is closed.

3. USE TEMPLATES (Optional)
Tap the folder icon in the bottom bar to load or save option presets.

4. START THE PURGE
Once a path is selected, tap "START PURGE" to begin. The entire directory and all its contents will be permanently deleted.`

export default function Purge() {
    const [searchParams] = useSearchParams()
    const { globalFlags, configFlags } = useFlags()

    const [source, setSource] = useState<string | undefined>(
        searchParams.get('initialSource') ? searchParams.get('initialSource')! : undefined
    )

    const advanced = useAdvancedSchedule()

    const {
        jsonError,
        setJsonError,
        groups: optionGroups,
        applyTemplate,
        getMergedOptions,
        resetJson,
        resetLocks,
    } = useOptionGroups({
        groups: [{ key: 'config', defaults: RCLONE_CONFIG_DEFAULTS.config }],
    })
    const configGroup = optionGroups.config

    const buildArgs = () => ({
        sources: [source!],
        options: {
            config: configGroup.options,
        },
    })

    const startPurgeMutation = useMutation({
        mutationFn: async () => {
            if (!source) {
                throw new Error('Please select a source path')
            }

            return startPurge(buildArgs())
        },
        onSuccess: async () => {
            if (advanced.cronExpression) {
                scheduleTaskMutation.mutate()
            }
        },
        onError: onErrorDialog('Purge', 'Failed to start purge', {
            log: ['[Purge] Failed to start purge:'],
        }),
    })

    const scheduleTaskMutation = useScheduleTask({
        operation: 'purge',
        cronExpression: advanced.cronExpression,
        configId: advanced.configId,
        binaryPath: advanced.binaryPath,
        validate: () => {
            if (!source) {
                throw new Error('Please select a source path to purge')
            }
        },
        buildArgs,
    })

    const buttonText = useMemo(() => {
        if (startPurgeMutation.isPending) return 'STARTING...'
        if (!source) return 'Please select a source path'
        if (jsonError) return 'Invalid JSON for ' + jsonError.toUpperCase() + ' options'
        if (advanced.cronExpression) return 'START AND SCHEDULE PURGE'
        return 'START PURGE'
    }, [startPurgeMutation.isPending, source, jsonError, advanced.cronExpression])

    const buttonIcon = useMemo(() => {
        if (startPurgeMutation.isPending) return
        if (!source) return <FoldersIcon className="w-5 h-5" />
        if (jsonError) return <AlertOctagonIcon className="w-5 h-5" />
        return <PlayIcon className="w-5 h-5 fill-current" />
    }, [startPurgeMutation.isPending, source, jsonError])

    const accordionItems = useMemo<OptionsAccordionItemDef[]>(
        () => [
            {
                key: 'config',
                category: 'config',
                subtitle: getOptionsSubtitle(Object.keys(configGroup.options).length),
                children: (
                    <OptionsSection
                        globalOptions={globalFlags?.main || {}}
                        optionsJson={configGroup.jsonString}
                        setOptionsJson={configGroup.setJsonString}
                        availableOptions={configFlags || []}
                        isLocked={configGroup.locked}
                        setIsLocked={configGroup.setLocked}
                    />
                ),
            },
        ],
        [configGroup, globalFlags, configFlags]
    )

    const handleStart = useCallback(() => startPurgeMutation.mutate(), [startPurgeMutation.mutate])

    const handleSchedule = useCallback(
        () => scheduleTaskMutation.mutate(),
        [scheduleTaskMutation.mutate]
    )

    const handleResetPaths = useCallback(() => {
        startTransition(() => {
            setSource(undefined)
            setJsonError(null)
            startPurgeMutation.reset()
        })
    }, [setJsonError, startPurgeMutation.reset])

    const handleResetOptions = useCallback(() => {
        startTransition(() => {
            resetJson()
            advanced.reset()
            startPurgeMutation.reset()
        })
    }, [advanced.reset, resetJson, startPurgeMutation.reset])

    const handleResetAll = useCallback(() => {
        startTransition(() => {
            resetJson()
            resetLocks()
            advanced.reset()
            setSource(undefined)
            startPurgeMutation.reset()
        })
    }, [advanced.reset, resetJson, resetLocks, startPurgeMutation.reset])

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
                    allowedKeys={PATH_ALLOWED_KEYS}
                    showFiles={false}
                />

                <AdvancedScheduleSection advanced={advanced} />

                <OptionsAccordion
                    defaultExpandedKeys={DEFAULT_EXPANDED_KEYS}
                    items={accordionItems}
                />
            </OperationWindowContent>

            <OperationWindowFooter>
                <OperationFooter
                    operation="purge"
                    templatesDisabled={!!jsonError}
                    onTemplateSelect={applyTemplate}
                    getTemplateOptions={getMergedOptions}
                    startIsSuccess={startPurgeMutation.isSuccess}
                    startIsPending={startPurgeMutation.isPending}
                    onStart={handleStart}
                    onSchedule={handleSchedule}
                    startBlocked={!!jsonError || !source}
                    buttonText={buttonText}
                    buttonIcon={buttonIcon}
                    newLabel="NEW PURGE"
                    showViewTransfers={false}
                    resetPathsLabel="Reset Path"
                    onResetPaths={handleResetPaths}
                    onResetOptions={handleResetOptions}
                    onResetAll={handleResetAll}
                    helpContent={HELP_CONTENT}
                />
            </OperationWindowFooter>
        </div>
    )
}
