import { Accordion, AccordionItem, Avatar, Button } from '@heroui/react'
import { message } from '@tauri-apps/plugin-dialog'
import { exists, readDir } from '@tauri-apps/plugin-fs'
import { fetch } from '@tauri-apps/plugin-http'
import cronstrue from 'cronstrue'
import {
    AlertOctagonIcon,
    ClockIcon,
    CopyIcon,
    FilterIcon,
    FoldersIcon,
    PlayIcon,
    WrenchIcon,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { getRemoteName } from '../../lib/format'
import { isRemotePath } from '../../lib/fs'
import {
    getConfigFlags,
    getCopyFlags,
    getCurrentGlobalFlags,
    getFilterFlags,
    startCopy,
} from '../../lib/rclone/api'
import { RCLONE_CONFIG_DEFAULTS } from '../../lib/rclone/constants'
import { usePersistedStore } from '../../lib/store'
import { openWindow } from '../../lib/window'
import CronEditor from '../components/CronEditor'
import OptionsSection from '../components/OptionsSection'
import { MultiPathFinder } from '../components/PathFinder'

export default function Copy() {
    const [searchParams] = useSearchParams()

    const [sources, setSources] = useState<string[] | undefined>(
        searchParams.get('initialSource') ? [searchParams.get('initialSource')!] : undefined
    )
    const [dest, setDest] = useState<string | undefined>(undefined)

    const [isStarted, setIsStarted] = useState(false)
    const [isLoading, setIsLoading] = useState(false)
    const [jsonError, setJsonError] = useState<'copy' | 'filter' | 'config' | null>(null)

    const [copyOptionsLocked, setCopyOptionsLocked] = useState(false)
    const [copyOptions, setCopyOptions] = useState<Record<string, string>>({})
    const [copyOptionsJson, setCopyOptionsJson] = useState<string>('{}')

    const [filterOptionsLocked, setFilterOptionsLocked] = useState(false)
    const [filterOptions, setFilterOptions] = useState<Record<string, string>>({})
    const [filterOptionsJson, setFilterOptionsJson] = useState<string>('{}')

    const [configOptionsLocked, setConfigOptionsLocked] = useState(false)
    const [configOptions, setConfigOptions] = useState<Record<string, string>>({})
    const [configOptionsJson, setConfigOptionsJson] = useState<string>('{}')

    // const [remoteOptionsLocked, setRemoteOptionsLocked] = useState(false)
    // const [remoteOptions, setRemoteOptions] = useState<Record<string, string>>({})
    // const [remoteOptionsJson, setRemoteOptionsJson] = useState<string>('{}')

    const [cronExpression, setCronExpression] = useState<string | null>(null)

    const [currentGlobalOptions, setCurrentGlobalOptions] = useState<any[]>([])

    // const [backends, setBackends] = useState<Backend[]>([])
    // useEffect(() => {
    //     getBackends().then((b) => {
    //         setBackends(b)
    //     })
    // }, [])

    // console.log('sources', sources)
    // console.log('dest', dest)

    useEffect(() => {
        getCurrentGlobalFlags().then((flags) => setCurrentGlobalOptions(flags))
    }, [])

    // biome-ignore lint/correctness/useExhaustiveDependencies: when unlocking, we don't want to re-run the effect
    useEffect(() => {
        const storeData = usePersistedStore.getState()

        const sourceRemote = getRemoteName(sources?.[0])
        const destRemote = getRemoteName(dest)

        let mergedCopyDefaults = {}
        let mergedFilterDefaults = {}
        let mergedConfigDefaults = {}

        // Helper function to merge defaults from a remote
        const mergeRemoteDefaults = (remote: string | null) => {
            if (!remote || !(remote in storeData.remoteConfigList)) return

            const remoteConfig = storeData.remoteConfigList[remote]

            if (remoteConfig.copyDefaults) {
                mergedCopyDefaults = {
                    ...mergedCopyDefaults,
                    ...remoteConfig.copyDefaults,
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
            } else {
                mergedConfigDefaults = {
                    ...mergedConfigDefaults,
                    ...RCLONE_CONFIG_DEFAULTS,
                }
            }
        }

        // Only merge defaults for remote paths
        if (sourceRemote) mergeRemoteDefaults(sourceRemote)
        if (destRemote) mergeRemoteDefaults(destRemote)

        if (Object.keys(mergedCopyDefaults).length > 0 && !copyOptionsLocked) {
            setCopyOptionsJson(JSON.stringify(mergedCopyDefaults, null, 2))
        }

        if (Object.keys(mergedFilterDefaults).length > 0 && !filterOptionsLocked) {
            setFilterOptionsJson(JSON.stringify(mergedFilterDefaults, null, 2))
        }

        if (Object.keys(mergedConfigDefaults).length > 0 && !configOptionsLocked) {
            setConfigOptionsJson(JSON.stringify(mergedConfigDefaults, null, 2))
        }
    }, [sources, dest])

    useEffect(() => {
        let step: 'copy' | 'filter' | 'config' = 'copy'
        try {
            setCopyOptions(JSON.parse(copyOptionsJson))

            step = 'filter'
            setFilterOptions(JSON.parse(filterOptionsJson))

            step = 'config'
            setConfigOptions(JSON.parse(configOptionsJson))

            setJsonError(null)
        } catch (error) {
            setJsonError(step)
            console.error(`Error parsing ${step} options:`, error)
        }
    }, [copyOptionsJson, filterOptionsJson, configOptionsJson])

    const handleStartCopy = useCallback(async () => {
        setIsLoading(true)

        if (!sources || sources.length === 0 || !dest) {
            await message('Please select both a source and destination path', {
                title: 'Error',
                kind: 'error',
            })
            return
        }

        try {
            // check local paths exists
            for (const source of sources) {
                if (!isRemotePath(source)) {
                    const sourceExists = await exists(source)
                    if (sourceExists) {
                        continue
                    }
                    await message(`Source path does not exist, ${source} is missing`, {
                        title: 'Error',
                        kind: 'error',
                    })
                    setIsLoading(false)
                    return
                }
            }
        } catch {}

        if (!isRemotePath(dest)) {
            const destExists = await exists(dest)
            if (!destExists) {
                await message('Destination path does not exist', {
                    title: 'Error',
                    kind: 'error',
                })
                setIsLoading(false)
                return
            }
        }

        let isFolder = true

        try {
            await readDir(sources[0])
        } catch {
            console.log('not a folder')
            isFolder = false
        }

        if (
            !isFolder &&
            filterOptions &&
            ('IncludeRule' in filterOptions || 'IncludeFrom' in filterOptions)
        ) {
            throw new Error(
                'Include rules are not supported when the input is one or multiple files'
            )
        }

        const mergedConfig = {
            ...configOptions,
            ...copyOptions,
        }

        if (cronExpression) {
            if (sources.length > 1) {
                await message(
                    'Cron is not supported for multiple sources, please use a single source',
                    {
                        title: 'Error',
                        kind: 'error',
                    }
                )
                setIsLoading(false)
                return
            }
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
                type: 'copy',
                cron: cronExpression,
                args: {
                    srcFs: sources[0],
                    dstFs: dest,
                    _config: mergedConfig,
                    _filter: filterOptions,
                },
            })
        }

        const failedPaths: Record<string, string> = {}

        for (const source of sources) {
            try {
                const customFilterOptions = isFolder
                    ? filterOptions
                    : {
                          ...filterOptions,
                          IncludeRule: [source.split('/').pop()!],
                      }

                // Use parent folder path if the input is a file
                const customSource = isFolder ? source : source.split('/').slice(0, -1).join('/')

                const jobId = await startCopy({
                    srcFs: customSource,
                    dstFs: dest,
                    _config: mergedConfig,
                    _filter: customFilterOptions,
                })

                await new Promise((resolve) => setTimeout(resolve, 500))

                const statusRes = await fetch(`http://localhost:5572/job/status?jobid=${jobId}`, {
                    method: 'POST',
                })
                    .then((res) => {
                        return res.json() as Promise<{
                            duration: number
                            endTime?: string
                            error?: string
                            finished: boolean
                            group: string
                            id: number
                            output?: Record<string, any>
                            startTime: string
                            success: boolean
                        }>
                    })
                    .catch(() => {
                        return { error: null }
                    })

                console.log('statusRes', JSON.stringify(statusRes, null, 2))

                if (statusRes.error) {
                    failedPaths[source] = statusRes.error
                }
            } catch (error) {
                console.log('error', error)
                console.error('Failed to start copy for path:', source, error)
                if (!failedPaths[source]) {
                    if (error instanceof Error) {
                        failedPaths[source] = error.message
                    } else {
                        failedPaths[source] = 'Unknown error'
                    }
                }
            }
        }

        console.log('failedPaths', failedPaths)

        // dummy delay to avoid waiting when opening the Jobs page
        await new Promise((resolve) => setTimeout(resolve, 1500))

        if (sources.length !== Object.keys(failedPaths).length) {
            setIsStarted(true)
        }

        const failedPathsKeys = Object.keys(failedPaths)

        if (failedPathsKeys.length > 0) {
            if (sources.length === failedPathsKeys.length) {
                await message(`${failedPathsKeys[0]} ${failedPaths[failedPathsKeys[0]]}`, {
                    title: 'Failed to start copy',
                    kind: 'error',
                })
            } else {
                await message(
                    `${failedPathsKeys.map((source) => `${source} ${failedPaths[source]}`).join(',')}`,
                    {
                        title: 'Failed to start copy',
                        kind: 'error',
                    }
                )
            }
        }

        setIsLoading(false)
    }, [sources, dest, copyOptions, filterOptions, cronExpression, configOptions])

    const buttonText = useMemo(() => {
        if (isLoading) return 'STARTING...'
        if (!sources || sources.length === 0) return 'Please select a source path'
        if (!dest) return 'Please select a destination path'
        if (sources[0] === dest) return 'Source and destination cannot be the same'
        if (jsonError) return 'Invalid JSON for ' + jsonError.toUpperCase() + ' options'
        return 'START COPY'
    }, [isLoading, jsonError, sources, dest])

    const buttonIcon = useMemo(() => {
        if (isLoading) return
        if (!sources || sources.length === 0 || !dest || sources[0] === dest)
            return <FoldersIcon className="w-5 h-5" />
        if (jsonError) return <AlertOctagonIcon className="w-5 h-5" />
        return <PlayIcon className="w-5 h-5" />
    }, [isLoading, jsonError, sources, dest])

    return (
        <div className="flex flex-col h-screen gap-10 pt-10">
            {/* Main Content */}
            <div className="flex flex-col flex-1 w-full max-w-3xl gap-6 mx-auto">
                {/* Paths Display */}
                <MultiPathFinder
                    sourcePaths={sources}
                    setSourcePaths={setSources}
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
                            globalOptions={
                                currentGlobalOptions['main' as keyof typeof currentGlobalOptions]
                            }
                            optionsJson={copyOptionsJson}
                            setOptionsJson={setCopyOptionsJson}
                            getAvailableOptions={getCopyFlags}
                            rows={18}
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
                        subtitle="Tap to toggle filtering options for this operation"
                        title="Filters"
                    >
                        <OptionsSection
                            globalOptions={
                                currentGlobalOptions['filter' as keyof typeof currentGlobalOptions]
                            }
                            optionsJson={filterOptionsJson}
                            setOptionsJson={setFilterOptionsJson}
                            getAvailableOptions={getFilterFlags}
                            rows={4}
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
                        subtitle="Tap to toggle config options for this operation"
                        title="Config"
                    >
                        <OptionsSection
                            globalOptions={
                                currentGlobalOptions['main' as keyof typeof currentGlobalOptions]
                            }
                            optionsJson={configOptionsJson}
                            setOptionsJson={setConfigOptionsJson}
                            getAvailableOptions={getConfigFlags}
                            rows={10}
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
                        subtitle="Tap to toggle cron options for this operation"
                        title="Cron"
                    >
                        <CronEditor expression={cronExpression} onChange={setCronExpression} />
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
                                setCopyOptionsJson('{}')
                                setFilterOptionsJson('{}')
                                setSources(undefined)
                                setDest(undefined)
                                setIsStarted(false)
                            }}
                            data-focus-visible="false"
                        >
                            New Copy
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
                        onPress={handleStartCopy}
                        size="lg"
                        fullWidth={true}
                        type="button"
                        color="primary"
                        isDisabled={
                            isLoading ||
                            !!jsonError ||
                            !sources ||
                            sources.length === 0 ||
                            !dest ||
                            sources[0] === dest
                        }
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
