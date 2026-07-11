import { useMutation } from '@tanstack/react-query'
import { AlertOctagonIcon, FoldersIcon, PlayIcon } from 'lucide-react'
import { startTransition, useCallback, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { onErrorDialog } from '../../lib/errors'
import { getOptionsSubtitle } from '../../lib/flags'
import { useFlags } from '../../lib/hooks'
import { startDryRun, startSync } from '../../lib/rclone/api'
import { RCLONE_CONFIG_DEFAULTS } from '../../lib/rclone/constants'
import OperationWindowContent from '../components/OperationWindowContent'
import OperationWindowFooter from '../components/OperationWindowFooter'
import OptionsSection from '../components/OptionsSection'
import { PathFinder } from '../components/PathFinder'
import RemoteOptionsSection from '../components/RemoteOptionsSection'
import AdvancedScheduleSection, {
    useAdvancedSchedule,
} from '../components/operation/AdvancedScheduleSection'
import OperationFooter from '../components/operation/OperationFooter'
import OptionsAccordion, {
    type OptionsAccordionItemDef,
} from '../components/operation/OptionsAccordion'
import { useOperationDryRun } from '../components/operation/useOperationDryRun'
import { useOptionGroups } from '../components/operation/useOptionGroups'
import { useScheduleTask } from '../components/operation/useScheduleTask'

const PATH_ALLOWED_KEYS: ('LOCAL_FS' | 'FAVORITES' | 'REMOTES')[] = [
    'LOCAL_FS',
    'REMOTES',
    'FAVORITES',
]

const SOURCE_OPTIONS = {
    label: 'Source',
    showPicker: true,
    placeholder: 'Enter a remote:/path or local path, or tap to select a folder',
    clearable: true,
    showFiles: true,
    allowedKeys: PATH_ALLOWED_KEYS,
}

const DEST_OPTIONS = {
    label: 'Destination',
    showPicker: true,
    placeholder: 'Enter a remote:/path or local path',
    clearable: true,
    showFiles: false,
    allowedKeys: PATH_ALLOWED_KEYS,
}

const HELP_CONTENT = `Sync the source to the destination, changing the destination only. Doesn't transfer files that are identical on source and destination, testing by size and modification time or MD5SUM. Destination is updated to match source, including deleting files if necessary (except duplicate objects, see below). If you don't want to delete files from destination, use the COPY command instead.
					
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

• Cron — Schedule this sync to run automatically at set intervals. It runs on a system schedule, even when the app is closed.

• Config — Performance tuning: parallel transfers, checkers, buffer_size, bandwidth limits (bwlimit), and fast_list for faster directory listings on supported remotes.

• Remotes — Override backend-specific settings for remotes involved in this operation.

3. USE TEMPLATES (Optional)
Tap the folder icon in the bottom bar to load or save option presets. Templates let you quickly apply common configurations without manually setting each option.

4. START THE SYNC
Once paths are selected, tap "START SYNC" to begin. You can monitor progress on the Transfers page.`

export default function Sync() {
    const [searchParams] = useSearchParams()
    const { globalFlags, filterFlags, configFlags, syncFlags } = useFlags()

    const [source, setSource] = useState<string | undefined>(
        searchParams.get('initialSource') ? searchParams.get('initialSource')! : undefined
    )
    const [dest, setDest] = useState<string | undefined>(
        searchParams.get('initialDestination') ? searchParams.get('initialDestination')! : undefined
    )

    const {
        jsonError,
        setJsonError,
        groups: optionGroups,
        remotes: remotesGroup,
        applyTemplate,
        getMergedOptions,
        resetJson,
        resetLocks,
    } = useOptionGroups({
        groups: [
            { key: 'sync', defaults: RCLONE_CONFIG_DEFAULTS.copy },
            { key: 'filter' },
            { key: 'config', defaults: RCLONE_CONFIG_DEFAULTS.config },
        ],
        withRemotes: true,
    })
    const syncGroup = optionGroups.sync
    const filterGroup = optionGroups.filter
    const configGroup = optionGroups.config

    const advanced = useAdvancedSchedule()

    const selectedRemotes = useMemo(() => [source, dest].filter(Boolean), [source, dest])

    const buildArgs = () => ({
        source: source!,
        destination: dest!,
        options: {
            config: configGroup.options,
            sync: syncGroup.options,
            filter: filterGroup.options,
            remotes: remotesGroup.options,
        },
    })

    const startSyncMutation = useMutation({
        mutationFn: async () => {
            if (!source || !dest) {
                throw new Error('Please select both a source and destination path')
            }

            return startSync(buildArgs())
        },
        onSuccess: () => {
            if (advanced.cronExpression) {
                scheduleTaskMutation.mutate()
            }
        },
        onError: onErrorDialog('Sync', 'Failed to start sync', { log: ['Error starting sync:'] }),
    })

    const scheduleTaskMutation = useScheduleTask({
        operation: 'sync',
        cronExpression: advanced.cronExpression,
        configId: advanced.configId,
        binaryPath: advanced.binaryPath,
        validate: () => {
            if (!source || !dest) {
                throw new Error('Please select both a source and destination path')
            }
        },
        buildArgs,
    })

    const dryRunMutation = useOperationDryRun(async () => {
        if (!source || !dest) {
            throw new Error('Please select both a source and destination path')
        }
        return startDryRun(() =>
            startSync({
                source,
                destination: dest,
                options: {
                    config: { ...configGroup.options, dry_run: true },
                    sync: syncGroup.options,
                    filter: filterGroup.options,
                    remotes: remotesGroup.options,
                },
            })
        )
    })

    const buttonText = useMemo(() => {
        if (startSyncMutation.isPending) return 'STARTING...'
        if (!source) return 'Please select a source path'
        if (!dest) return 'Please select a destination path'
        if (source === dest) return 'Source and destination cannot be the same'
        if (jsonError) return 'Invalid JSON for ' + jsonError.toUpperCase() + ' options'
        if (advanced.cronExpression) return 'START AND SCHEDULE SYNC'
        return 'START SYNC'
    }, [startSyncMutation.isPending, source, dest, jsonError, advanced.cronExpression])

    const buttonIcon = useMemo(() => {
        if (startSyncMutation.isPending) return
        if (!source || !dest || source === dest) return <FoldersIcon className="w-5 h-5" />
        if (jsonError) return <AlertOctagonIcon className="w-5 h-5" />
        return <PlayIcon className="w-5 h-5 fill-current" />
    }, [startSyncMutation.isPending, source, dest, jsonError])

    const accordionItems = useMemo<OptionsAccordionItemDef[]>(
        () => [
            {
                key: 'sync',
                category: 'sync',
                subtitle: getOptionsSubtitle(Object.keys(syncGroup.options).length),
                children: (
                    <OptionsSection
                        optionsJson={syncGroup.jsonString}
                        setOptionsJson={syncGroup.setJsonString}
                        globalOptions={globalFlags?.main || {}}
                        availableOptions={syncFlags || []}
                        isLocked={syncGroup.locked}
                        setIsLocked={syncGroup.setLocked}
                    />
                ),
            },
            {
                key: 'filters',
                category: 'filters',
                subtitle: getOptionsSubtitle(Object.keys(filterGroup.options).length),
                children: (
                    <OptionsSection
                        globalOptions={globalFlags?.filter || {}}
                        optionsJson={filterGroup.jsonString}
                        setOptionsJson={filterGroup.setJsonString}
                        availableOptions={filterFlags || []}
                        isLocked={filterGroup.locked}
                        setIsLocked={filterGroup.setLocked}
                    />
                ),
            },
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
            ...(selectedRemotes.length > 0
                ? [
                      {
                          key: 'remotes',
                          category: 'remotes' as const,
                          subtitle: getOptionsSubtitle(
                              Object.values(remotesGroup.options).reduce(
                                  (acc, opts) => acc + Object.keys(opts).length,
                                  0
                              )
                          ),
                          children: (
                              <RemoteOptionsSection
                                  selectedRemotes={selectedRemotes}
                                  remoteOptionsJson={remotesGroup.json}
                                  setRemoteOptionsJson={remotesGroup.setJson}
                                  reconcileRemotes={remotesGroup.reconcile}
                                  setRemoteOptionsLocked={remotesGroup.setLocked}
                                  remoteOptionsLocked={remotesGroup.locked}
                              />
                          ),
                      },
                  ]
                : []),
        ],
        [
            syncGroup,
            filterGroup,
            configGroup,
            globalFlags,
            syncFlags,
            filterFlags,
            configFlags,
            selectedRemotes,
            remotesGroup,
        ]
    )

    const handleStart = useCallback(() => startSyncMutation.mutate(), [startSyncMutation.mutate])

    const handleSchedule = useCallback(
        () => scheduleTaskMutation.mutate(),
        [scheduleTaskMutation.mutate]
    )

    const handleDryRun = useCallback(() => dryRunMutation.mutate(), [dryRunMutation.mutate])

    const handleResetPaths = useCallback(() => {
        startTransition(() => {
            setSource(undefined)
            setDest(undefined)
            setJsonError(null)
            startSyncMutation.reset()
        })
    }, [setJsonError, startSyncMutation.reset])

    const handleResetOptions = useCallback(() => {
        startTransition(() => {
            resetJson()
            advanced.reset()
            startSyncMutation.reset()
        })
    }, [advanced.reset, resetJson, startSyncMutation.reset])

    const handleResetAll = useCallback(() => {
        startTransition(() => {
            resetJson()
            resetLocks()
            advanced.reset()
            setDest(undefined)
            setSource(undefined)
            startSyncMutation.reset()
        })
    }, [advanced.reset, resetJson, resetLocks, startSyncMutation.reset])

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
                    sourceOptions={SOURCE_OPTIONS}
                    destOptions={DEST_OPTIONS}
                />

                <AdvancedScheduleSection advanced={advanced} />

                <OptionsAccordion banner={true} items={accordionItems} />
            </OperationWindowContent>

            <OperationWindowFooter>
                <OperationFooter
                    operation="sync"
                    templatesDisabled={!!jsonError}
                    onTemplateSelect={applyTemplate}
                    getTemplateOptions={getMergedOptions}
                    startIsSuccess={startSyncMutation.isSuccess}
                    startIsPending={startSyncMutation.isPending}
                    onStart={handleStart}
                    onSchedule={handleSchedule}
                    dryRunIsPending={dryRunMutation.isPending}
                    onDryRun={handleDryRun}
                    startBlocked={!!jsonError || !source || !dest || source === dest}
                    buttonText={buttonText}
                    buttonIcon={buttonIcon}
                    newLabel="NEW SYNC"
                    onResetPaths={handleResetPaths}
                    onResetOptions={handleResetOptions}
                    onResetAll={handleResetAll}
                    helpContent={HELP_CONTENT}
                />
            </OperationWindowFooter>
        </div>
    )
}
