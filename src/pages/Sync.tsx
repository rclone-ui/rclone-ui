import { Accordion, AccordionItem, Avatar, Button } from '@nextui-org/react'
import { message } from '@tauri-apps/plugin-dialog'
import { exists } from '@tauri-apps/plugin-fs'
import { AlertOctagonIcon, FilterIcon, FolderSyncIcon, FoldersIcon, PlayIcon } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { getRemoteName } from '../../lib/format'
import { isRemotePath } from '../../lib/fs'
import { getFilterFlags, getGlobalFlags, getSyncFlags, startSync } from '../../lib/rclone/api'
import { usePersistedStore } from '../../lib/store'
import { openWindow } from '../../lib/window'
import OptionsSection from '../components/OptionsSection'
import PathFinder from '../components/PathFinder'

export default function Sync() {
    const [searchParams] = useSearchParams()

    const [source, setSource] = useState<string | undefined>(
        searchParams.get('initialSource') || undefined
    )
    const [dest, setDest] = useState<string | undefined>(undefined)

    const [isStarted, setIsStarted] = useState(false)
    const [isLoading, setIsLoading] = useState(false)
    const [jsonError, setJsonError] = useState<'sync' | 'filter' | null>(null)

    const [syncOptionsLocked, setSyncOptionsLocked] = useState(false)
    const [syncOptions, setSyncOptions] = useState<Record<string, string>>({})
    const [syncOptionsJson, setSyncOptionsJson] = useState<string>('{}')

    const [filterOptionsLocked, setFilterOptionsLocked] = useState(false)
    const [filterOptions, setFilterOptions] = useState<Record<string, string>>({})
    const [filterOptionsJson, setFilterOptionsJson] = useState<string>('{}')

    const [globalOptions, setGlobalOptions] = useState<any[]>([])

    // biome-ignore lint/correctness/useExhaustiveDependencies: when unlocking, we don't want to re-run the effect
    useEffect(() => {
        const storeData = usePersistedStore.getState()

        const sourceRemote = getRemoteName(source)
        const destRemote = getRemoteName(dest)

        let mergedSyncDefaults = {}
        let mergedFilterDefaults = {}

        // Helper function to merge defaults from a remote
        const mergeRemoteDefaults = (remote: string | null) => {
            if (!remote || !(remote in storeData.remoteConfigList)) return

            const remoteConfig = storeData.remoteConfigList[remote]

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
    }, [source, dest])

    useEffect(() => {
        getGlobalFlags().then((flags) => setGlobalOptions(flags))
    }, [])

    useEffect(() => {
        let step: 'sync' | 'filter' = 'sync'
        try {
            setSyncOptions(JSON.parse(syncOptionsJson))

            step = 'filter'
            setFilterOptions(JSON.parse(filterOptionsJson))

            setJsonError(null)
        } catch (error) {
            setJsonError(step)
            console.error(`Error parsing ${step} options:`, error)
        }
    }, [syncOptionsJson, filterOptionsJson])

    const handleStartSync = useCallback(async () => {
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

        try {
            await startSync({
                source,
                dest,
                syncOptions,
                filterOptions,
            })

            // dummy delay to avoid waiting when opening the Jobs page
            await new Promise((resolve) => setTimeout(resolve, 1500))

            setIsStarted(true)
        } catch (err) {
            console.error('Failed to start sync:', err)
            const errorMessage =
                err instanceof Error ? err.message : 'Failed to start sync operation'
            await message(errorMessage, {
                title: 'Error',
                kind: 'error',
            })
        } finally {
            setIsLoading(false)
        }
    }, [source, dest, syncOptions, filterOptions])

    const buttonText = useMemo(() => {
        if (isLoading) return 'STARTING...'
        if (!source) return 'Please select a source path'
        if (!dest) return 'Please select a destination path'
        if (source === dest) return 'Source and destination cannot be the same'
        if (jsonError) return 'Invalid JSON for ' + jsonError.toUpperCase() + ' options'
        return 'START SYNC'
    }, [isLoading, jsonError, source, dest])

    const buttonIcon = useMemo(() => {
        if (isLoading) return
        if (!source || !dest || source === dest) return <FoldersIcon className="w-5 h-5" />
        if (jsonError) return <AlertOctagonIcon className="w-5 h-5" />
        return <PlayIcon className="w-5 h-5" />
    }, [isLoading, jsonError, source, dest])

    return (
        <div className="flex flex-col h-screen gap-10 pt-10">
            {/* Main Content */}
            <div className="flex flex-col flex-1 w-full max-w-xl gap-6 mx-auto">
                {/* Paths Display */}
                <PathFinder
                    sourcePath={source}
                    setSourcePath={setSource}
                    destPath={dest}
                    setDestPath={setDest}
                />

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
                            globalOptions={globalOptions['main' as keyof typeof globalOptions]}
                            optionsFetcher={getSyncFlags}
                            rows={20}
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
                            globalOptions={globalOptions['filter' as keyof typeof globalOptions]}
                            optionsJson={filterOptionsJson}
                            setOptionsJson={setFilterOptionsJson}
                            optionsFetcher={getFilterFlags}
                            rows={4}
                            isLocked={filterOptionsLocked}
                            setIsLocked={setFilterOptionsLocked}
                        />
                    </AccordionItem>
                </Accordion>
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
                        className="max-w-2xl"
                        data-focus-visible="false"
                    >
                        {buttonText}
                    </Button>
                )}
            </div>
        </div>
    )
}
