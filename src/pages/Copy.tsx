import { Accordion, AccordionItem, Avatar, Button } from '@nextui-org/react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { message } from '@tauri-apps/plugin-dialog'
import { AlertOctagonIcon, CopyIcon, FilterIcon, FoldersIcon, PlayIcon } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { getCopyFlags, getFilterFlags, getGlobalFlags, startCopy } from '../../lib/rclone/api'
import { usePersistedStore } from '../../lib/store'
import { getLoadingTray, getMainTray } from '../../lib/tray'
import { openTrayWindow } from '../../lib/window'
import OptionsSection from '../components/OptionsSection'
import PathFinder from '../components/PathFinder'

export default function Copy() {
    const [searchParams] = useSearchParams()

    const [source, setSource] = useState<string | undefined>(
        searchParams.get('initialSource') || undefined
    )
    const [dest, setDest] = useState<string | undefined>(undefined)

    const [isLoading, setIsLoading] = useState(false)
    const [jsonError, setJsonError] = useState<'copy' | 'filter' | null>(null)

    const [copyOptions, setCopyOptions] = useState<Record<string, string>>({})
    const [copyOptionsJson, setCopyOptionsJson] = useState<string>('{}')

    const [filterOptions, setFilterOptions] = useState<Record<string, string>>({})
    const [filterOptionsJson, setFilterOptionsJson] = useState<string>('{}')

    const [globalOptions, setGlobalOptions] = useState<any[]>([])

    useEffect(() => {
        const storeData = usePersistedStore.getState()

        const remote = source?.split(':')[0]

        if (!remote) return

        if (!(remote in storeData.remoteConfigList)) return

        if (
            storeData.remoteConfigList[remote].copyDefaults &&
            Object.keys(storeData.remoteConfigList[remote].copyDefaults).length > 0
        ) {
            setCopyOptionsJson(
                JSON.stringify(storeData.remoteConfigList[remote].copyDefaults, null, 2)
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
        let step: 'copy' | 'filter' = 'copy'
        try {
            setCopyOptions(JSON.parse(copyOptionsJson))

            step = 'filter'
            setFilterOptions(JSON.parse(filterOptionsJson))

            setJsonError(null)
        } catch (error) {
            setJsonError(step)
            console.error(`Error parsing ${step} options:`, error)
        }
    }, [copyOptionsJson, filterOptionsJson])

    const handleStartCopy = useCallback(async () => {
        setIsLoading(true)

        try {
            await getMainTray().then((tray) => tray?.setVisible(false))
            await getLoadingTray().then((tray) => tray?.setVisible(true))

            await startCopy({
                source: source!,
                dest: dest!,
                copyOptions,
                filterOptions,
            })

            // delay for the job to appear in the API
            await new Promise((resolve) => setTimeout(resolve, 2500))

            await openTrayWindow({ name: 'Jobs', url: '/jobs' })
            await getCurrentWindow().hide()

            await getMainTray().then((tray) => tray?.setVisible(true))
            await getLoadingTray().then((tray) => tray?.setVisible(false))

            await getCurrentWindow().destroy()
        } catch (err) {
            await getMainTray().then((tray) => tray?.setVisible(true))
            await getLoadingTray().then((tray) => tray?.setVisible(false))

            console.error('Failed to start copy:', err)
            const errorMessage =
                err instanceof Error ? err.message : 'Failed to start copy operation'
            await message(errorMessage, {
                title: 'Error',
                kind: 'error',
            })
        } finally {
            setIsLoading(false)
        }
    }, [source, dest, copyOptions, filterOptions])

    const buttonText = useMemo(() => {
        if (isLoading) return 'STARTING...'
        if (!source) return 'Please select a source path'
        if (!dest) return 'Please select a destination path'
        if (source === dest) return 'Source and destination cannot be the same'
        if (jsonError) return 'Invalid JSON for ' + jsonError.toUpperCase() + ' options'
        return 'START COPY'
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
                        key="copy"
                        startContent={
                            <Avatar color="primary" radius="lg" fallback={<CopyIcon />} />
                        }
                        indicator={<CopyIcon />}
                        subtitle="Tap to toggle copy options for this operation"
                        title="Copy"
                    >
                        <OptionsSection
                            globalOptions={globalOptions['main' as keyof typeof globalOptions]}
                            optionsJson={copyOptionsJson}
                            setOptionsJson={setCopyOptionsJson}
                            optionsFetcher={getCopyFlags}
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
                    onPress={handleStartCopy}
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
