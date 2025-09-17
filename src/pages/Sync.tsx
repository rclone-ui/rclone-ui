import { useAutoAnimate } from '@formkit/auto-animate/react'
import { Accordion, AccordionItem, Avatar, Button, Divider, cn } from '@heroui/react'
import { message } from '@tauri-apps/plugin-dialog'
import { exists } from '@tauri-apps/plugin-fs'
import cronstrue from 'cronstrue'
import {
    AlertOctagonIcon,
    ChevronDownIcon,
    ClockIcon,
    CopyIcon,
    FilterIcon,
    FolderSyncIcon,
    FoldersIcon,
    PlayIcon,
    WrenchIcon,
} from 'lucide-react'
import { startTransition, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { getRemoteName } from '../../lib/format'
import { isRemotePath } from '../../lib/fs'
import {
    getConfigFlags,
    getCurrentGlobalFlags,
    getFilterFlags,
    getSyncFlags,
    startSync,
} from '../../lib/rclone/api'
import { RCLONE_CONFIG_DEFAULTS } from '../../lib/rclone/constants'
import { usePersistedStore } from '../../lib/store'
import { openWindow } from '../../lib/window'
import CronEditor from '../components/CronEditor'
import OptionsSection from '../components/OptionsSection'
import { PathFinder } from '../components/PathFinder'
import RemoteOptionsSection from '../components/RemoteOptionsSection'

export default function Sync() {
    const [searchParams] = useSearchParams()

    const [source, setSource] = useState<string | undefined>(
        searchParams.get('initialSource') || undefined
    )
    const [dest, setDest] = useState<string | undefined>(undefined)

    const [isStarted, setIsStarted] = useState(false)
    const [isLoading, setIsLoading] = useState(false)
    const [jsonError, setJsonError] = useState<'sync' | 'filter' | 'config' | 'remote' | null>(null)

    const [syncOptionsLocked, setSyncOptionsLocked] = useState(false)
    const [syncOptions, setSyncOptions] = useState<Record<string, string>>({})
    const [syncOptionsJson, setSyncOptionsJson] = useState<string>('{}')

    const [filterOptionsLocked, setFilterOptionsLocked] = useState(false)
    const [filterOptions, setFilterOptions] = useState<Record<string, string>>({})
    const [filterOptionsJson, setFilterOptionsJson] = useState<string>('{}')

    const [configOptionsLocked, setConfigOptionsLocked] = useState(false)
    const [configOptions, setConfigOptions] = useState<Record<string, string>>({})
    const [configOptionsJson, setConfigOptionsJson] = useState<string>('{}')

    const [remoteOptionsLocked, setRemoteOptionsLocked] = useState(false)
    const [remoteOptions, setRemoteOptions] = useState<Record<string, string>>({})
    const [remoteOptionsJson, setRemoteOptionsJson] = useState<string>('{}')

    const [cronExpression, setCronExpression] = useState<string | null>(null)

    const [currentGlobalOptions, setCurrentGlobalOptions] = useState<any[]>([])

    const [showMore, setShowMore] = useState(false)
    const [animationParent] = useAutoAnimate()

    const selectedRemotes = (() => {
        return [source, dest].filter(Boolean) as string[]
    })()

    const buttonText = (() => {
        if (isLoading) return 'STARTING...'
        if (!source) return 'Please select a source path'
        if (!dest) return 'Please select a destination path'
        if (source === dest) return 'Source and destination cannot be the same'
        if (jsonError) return 'Invalid JSON for ' + jsonError.toUpperCase() + ' options'
        return 'START SYNC'
    })()

    const buttonIcon = (() => {
        if (isLoading) return
        if (!source || !dest || source === dest) return <FoldersIcon className="w-5 h-5" />
        if (jsonError) return <AlertOctagonIcon className="w-5 h-5" />
        return <PlayIcon className="w-5 h-5" />
    })()

    async function handleStartSync() {
        setIsLoading(true)

        if (!source || !dest) {
            await message('Please select both a source and destination path', {
                title: 'Error',
                kind: 'error',
            })
            return
        }

        let sourceExists = false
        let destExists = false

        try {
            // check local paths exists
            if (isRemotePath(source)) {
                sourceExists = true
            } else {
                sourceExists = await exists(source)
            }

            if (isRemotePath(dest)) {
                destExists = true
            } else {
                destExists = await exists(dest)
            }
        } catch {}

        if (!sourceExists) {
            await message('Source path does not exist', {
                title: 'Error',
                kind: 'error',
            })
            setIsLoading(false)
            return
        }

        if (!destExists) {
            await message('Destination path does not exist', {
                title: 'Error',
                kind: 'error',
            })
            setIsLoading(false)
            return
        }

        const mergedConfig = {
            ...configOptions,
            ...syncOptions,
        }

        if (cronExpression) {
            try {
                cronstrue.toString(cronExpression)
            } catch {
                await message('Invalid cron expression', {
                    title: 'Error',
                    kind: 'error',
                })
                setIsLoading(false)
                return
            }
            usePersistedStore.getState().addScheduledTask({
                type: 'sync',
                cron: cronExpression,
                args: {
                    source: source,
                    dest: dest,
                    syncOptions: mergedConfig,
                    filterOptions: filterOptions,
                },
            })
        }

        try {
            await startSync({
                srcFs: source,
                dstFs: dest,
                _config: mergedConfig,
                _filter: filterOptions,
                remoteOptions,
            })

            // dummy delay to avoid waiting when opening the Jobs page
            await new Promise((resolve) => setTimeout(resolve, 1000))

            setIsStarted(true)
        } catch (err) {
            console.error('Failed to start sync:', err)
            const errorMessage =
                err instanceof Error ? err.message : 'Failed to start sync operation'
            await message(errorMessage, {
                title: 'Error',
                kind: 'error',
            })
        }
        setIsLoading(false)
    }

    useEffect(() => {
        setConfigOptionsJson(JSON.stringify(RCLONE_CONFIG_DEFAULTS, null, 2))

        return () => {
            setConfigOptionsJson('{}')
        }
    }, [])

    useEffect(() => {
        getCurrentGlobalFlags().then((flags) =>
            startTransition(() => setCurrentGlobalOptions(flags))
        )
    }, [])

    // biome-ignore lint/correctness/useExhaustiveDependencies: when unlocking, we don't want to re-run the effect
    useEffect(() => {
        const storeData = usePersistedStore.getState()

        const sourceRemote = getRemoteName(source)
        const destRemote = getRemoteName(dest)

        let mergedSyncDefaults = {}
        let mergedFilterDefaults = {}
        let mergedConfigDefaults = {}

        // Helper function to merge defaults from a remote
        const mergeRemoteDefaults = (remote: string | null) => {
            if (!remote) return

            const remoteConfig = storeData.remoteConfigList?.[remote] || {}

            if (remoteConfig.syncDefaults) {
                mergedSyncDefaults = {
                    ...mergedSyncDefaults,
                    ...remoteConfig.syncDefaults,
                }
            }

            if (remoteConfig.filterDefaults) {
                mergedFilterDefaults = {
                    ...mergedFilterDefaults,
                    ...remoteConfig.filterDefaults,
                }
            }

            if (remoteConfig.configDefaults) {
                mergedConfigDefaults = {
                    ...mergedConfigDefaults,
                    ...remoteConfig.configDefaults,
                }
            }
        }

        // Only merge defaults for remote paths
        if (sourceRemote) mergeRemoteDefaults(sourceRemote)
        if (destRemote) mergeRemoteDefaults(destRemote)

        if (Object.keys(mergedSyncDefaults).length > 0 && !syncOptionsLocked) {
            setSyncOptionsJson(JSON.stringify(mergedSyncDefaults, null, 2))
        }

        if (Object.keys(mergedFilterDefaults).length > 0 && !filterOptionsLocked) {
            setFilterOptionsJson(JSON.stringify(mergedFilterDefaults, null, 2))
        }

        if (Object.keys(mergedConfigDefaults).length > 0 && !configOptionsLocked) {
            setConfigOptionsJson(JSON.stringify(mergedConfigDefaults, null, 2))
        }
    }, [source, dest])

    useEffect(() => {
        let step: 'sync' | 'filter' | 'config' | 'remote' = 'sync'
        try {
            setSyncOptions(JSON.parse(syncOptionsJson))

            step = 'filter'
            setFilterOptions(JSON.parse(filterOptionsJson))

            step = 'config'
            setConfigOptions(JSON.parse(configOptionsJson))

            step = 'remote'
            setRemoteOptions(JSON.parse(remoteOptionsJson))

            setJsonError(null)
        } catch (error) {
            setJsonError(step)
            console.error(`Error parsing ${step} options:`, error)
        }
    }, [syncOptionsJson, filterOptionsJson, configOptionsJson, remoteOptionsJson])

    return (
        <div className="flex flex-col h-screen gap-10 pt-10">
            {/* Main Content */}
            <div className="flex flex-col flex-1 w-full max-w-3xl gap-6 mx-auto">
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
                        showSuggestions: true,
                        clearable: true,
                        showFiles: true,
                        allowedKeys: ['LOCAL_FS', 'REMOTES', 'FAVORITES'],
                    }}
                    destOptions={{
                        label: 'Destination',
                        showPicker: true,
                        placeholder: 'Enter a remote:/path or local path',
                        showSuggestions: true,
                        clearable: true,
                        showFiles: false,
                        allowedKeys: ['LOCAL_FS', 'REMOTES', 'FAVORITES'],
                    }}
                />

                <div
                    className={cn('flex flex-col pb-10', showMore && 'pb-0')}
                    ref={animationParent}
                >
                    <Accordion>
                        <AccordionItem
                            key="sync"
                            startContent={
                                <Avatar color="success" radius="lg" fallback={<FolderSyncIcon />} />
                            }
                            indicator={<FolderSyncIcon />}
                            subtitle="Tap to toggle sync options for this operation"
                            title="Sync"
                        >
                            <OptionsSection
                                optionsJson={syncOptionsJson}
                                setOptionsJson={setSyncOptionsJson}
                                globalOptions={
                                    currentGlobalOptions[
                                        'main' as keyof typeof currentGlobalOptions
                                    ]
                                }
                                getAvailableOptions={getSyncFlags}
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
                            subtitle="Tap to toggle filtering options for this operation"
                            title="Filters"
                        >
                            <OptionsSection
                                globalOptions={
                                    currentGlobalOptions[
                                        'filter' as keyof typeof currentGlobalOptions
                                    ]
                                }
                                optionsJson={filterOptionsJson}
                                setOptionsJson={setFilterOptionsJson}
                                getAvailableOptions={getFilterFlags}
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
                            subtitle="Tap to toggle cron options for this operation"
                            title="Cron"
                        >
                            <CronEditor expression={cronExpression} onChange={setCronExpression} />
                        </AccordionItem>
                    </Accordion>

                    {showMore ? (
                        <Divider />
                    ) : (
                        <div
                            key="show-more-options"
                            className="absolute flex flex-col items-center justify-center w-full gap-1 -bottom-8 group "
                            onClick={() => {
                                startTransition(() => {
                                    setShowMore(true)
                                })
                                requestAnimationFrame(() => {
                                    setTimeout(() => {
                                        scrollTo({
                                            top: document.body.scrollHeight,
                                            behavior: 'smooth',
                                        })
                                    }, 400)
                                })
                            }}
                        >
                            <p className="text-small animate-show-more-title group-hover:text-foreground-500 text-foreground-400">
                                Show more options
                            </p>
                            <ChevronDownIcon className="size-5 stroke-foreground-400 animate-show-more group-hover:stroke-foreground-500" />
                        </div>
                    )}

                    {showMore && (
                        // @ts-expect-error
                        <Accordion>
                            <AccordionItem
                                key="config"
                                startContent={
                                    <Avatar color="default" radius="lg" fallback={<WrenchIcon />} />
                                }
                                indicator={<WrenchIcon />}
                                subtitle="Tap to toggle config options for this operation"
                                title="Config"
                            >
                                <OptionsSection
                                    globalOptions={
                                        currentGlobalOptions[
                                            'main' as keyof typeof currentGlobalOptions
                                        ]
                                    }
                                    optionsJson={configOptionsJson}
                                    setOptionsJson={setConfigOptionsJson}
                                    getAvailableOptions={getConfigFlags}
                                    isLocked={configOptionsLocked}
                                    setIsLocked={setConfigOptionsLocked}
                                />
                            </AccordionItem>

                            {selectedRemotes.length > 0 && (
                                <AccordionItem
                                    key={'remotes'}
                                    startContent={
                                        <Avatar
                                            className="bg-fuchsia-500"
                                            radius="lg"
                                            fallback={<CopyIcon />}
                                        />
                                    }
                                    indicator={<CopyIcon />}
                                    subtitle="Tap to toggle remote options for this operation"
                                    title={'Remotes'}
                                >
                                    <RemoteOptionsSection
                                        selectedRemotes={selectedRemotes}
                                        remoteOptionsJson={remoteOptionsJson}
                                        setRemoteOptionsJson={setRemoteOptionsJson}
                                        setRemoteOptionsLocked={setRemoteOptionsLocked}
                                        remoteOptionsLocked={remoteOptionsLocked}
                                    />
                                </AccordionItem>
                            )}
                        </Accordion>
                    )}
                </div>
            </div>

            <div className="sticky bottom-0 z-50 flex items-center justify-center flex-none gap-2 p-4 border-t border-neutral-500/20 bg-neutral-900/50 backdrop-blur-lg">
                {isStarted ? (
                    <>
                        <Button
                            fullWidth={true}
                            size="lg"
                            onPress={() => {
                                setSyncOptionsJson('{}')
                                setFilterOptionsJson('{}')
                                setDest(undefined)
                                setSource(undefined)
                                setIsStarted(false)
                            }}
                            data-focus-visible="false"
                        >
                            New Sync
                        </Button>

                        <Button
                            fullWidth={true}
                            size="lg"
                            color="primary"
                            onPress={async () => {
                                await openWindow({ name: 'Jobs', url: '/jobs' })
                                // await getCurrentWindow().hide()

                                // await getCurrentWindow().destroy()
                            }}
                            data-focus-visible="false"
                        >
                            Show Jobs
                        </Button>
                    </>
                ) : (
                    <Button
                        onPress={handleStartSync}
                        size="lg"
                        fullWidth={true}
                        type="button"
                        color="primary"
                        isDisabled={isLoading || !!jsonError || !source || !dest || source === dest}
                        isLoading={isLoading}
                        endContent={buttonIcon}
                        className="max-w-2xl gap-2"
                        data-focus-visible="false"
                    >
                        {buttonText}
                    </Button>
                )}
            </div>
        </div>
    )
}
