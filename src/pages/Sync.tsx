import { Accordion, AccordionItem, Avatar, Button } from '@nextui-org/react'
import { Window } from '@tauri-apps/api/window'
import { message } from '@tauri-apps/plugin-dialog'
import { AlertOctagonIcon, FilterIcon, FolderSyncIcon, FoldersIcon, PlayIcon } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { getFilterFlags, getGlobalFlags, getSyncFlags, startSync } from '../../lib/rclone'
import { usePersistedStore } from '../../lib/store'
import OptionsSection from '../components/OptionsSection'
import PathFinder from '../components/PathFinder'

export default function Sync() {
    const navigate = useNavigate()
    const [searchParams] = useSearchParams()

    const [source, setSource] = useState<string | undefined>(
        searchParams.get('initialSource') || undefined
    )
    const [dest, setDest] = useState<string | undefined>(undefined)

    const [isLoading, setIsLoading] = useState(false)
    const [jsonError, setJsonError] = useState<'sync' | 'filter' | null>(null)

    const [syncOptions, setSyncOptions] = useState<Record<string, string>>({})
    const [syncOptionsJson, setSyncOptionsJson] = useState<string>('{}')

    const [filterOptions, setFilterOptions] = useState<Record<string, string>>({})
    const [filterOptionsJson, setFilterOptionsJson] = useState<string>('{}')

    const [globalOptions, setGlobalOptions] = useState<any[]>([])

    useEffect(() => {
        const storeData = usePersistedStore.getState()

        const remote = source?.split(':')[0]

        if (!remote) return

        if (!(remote in storeData.remoteConfigList)) return

        if (
            storeData.remoteConfigList[remote].syncDefaults &&
            Object.keys(storeData.remoteConfigList[remote].syncDefaults).length > 0
        ) {
            setSyncOptionsJson(
                JSON.stringify(storeData.remoteConfigList[remote].syncDefaults, null, 2)
            )
        }

        if (
            storeData.remoteConfigList[remote].filterDefaults &&
            Object.keys(storeData.remoteConfigList[remote].filterDefaults).length > 0
        ) {
            setFilterOptionsJson(
                JSON.stringify(storeData.remoteConfigList[remote].filterDefaults, null, 2)
            )
        }
    }, [source])

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

        try {
            await startSync({
                source: source!,
                dest: dest!,
                syncOptions,
                filterOptions,
            })
            await new Promise((resolve) => setTimeout(resolve, 1000))
            navigate('/jobs')
            await Window.getCurrent().setTitle('Jobs')
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
    }, [source, dest, syncOptions, filterOptions, navigate])

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
        <div className="flex flex-col min-h-screen gap-10 pt-10">
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
                        />
                    </AccordionItem>
                </Accordion>
            </div>

            <div className="sticky bottom-0 z-50 flex items-center justify-center flex-none p-4 border-t border-neutral-500/20 bg-neutral-900/50 backdrop-blur-lg">
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
            </div>
        </div>
    )
}
