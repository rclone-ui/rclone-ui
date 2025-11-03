import { Accordion, AccordionItem, Avatar, Button, Switch } from '@heroui/react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { message } from '@tauri-apps/plugin-dialog'
import { exists } from '@tauri-apps/plugin-fs'
import { fetch } from '@tauri-apps/plugin-http'
import {
    AlertOctagonIcon,
    DiamondPercentIcon,
    FilterIcon,
    FoldersIcon,
    PlayIcon,
    ServerIcon,
    WrenchIcon,
    XIcon,
} from 'lucide-react'
import { startTransition, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { getRemoteName } from '../../lib/format'
import { isRemotePath } from '../../lib/fs'
import {
    getConfigFlags,
    getCopyFlags,
    getCurrentGlobalFlags,
    getFilterFlags,
    startBisync,
} from '../../lib/rclone/api'
import { RCLONE_CONFIG_DEFAULTS } from '../../lib/rclone/constants'
import { usePersistedStore } from '../../lib/store'
import { openWindow } from '../../lib/window'
import type { FlagValue } from '../../types/rclone'
import CommandInfo from '../components/CommandInfo'
import OptionsSection from '../components/OptionsSection'
import { MultiPathFinder } from '../components/PathFinder'
import RemoteOptionsSection from '../components/RemoteOptionsSection'

export default function Bisync() {
    const [searchParams] = useSearchParams()

    const [sources, setSources] = useState<string[] | undefined>(
        searchParams.get('initialSource') ? [searchParams.get('initialSource')!] : undefined
    )
    const [dest, setDest] = useState<string | undefined>(undefined)

    const [isStarted, setIsStarted] = useState(false)
    const [isLoading, setIsLoading] = useState(false)
    const [jsonError, setJsonError] = useState<'bisync' | 'filter' | 'config' | 'remote' | null>(
        null
    )

    const [bisyncOptionsLocked, setBisyncOptionsLocked] = useState(false)
    const [bisyncOptions, setBisyncOptions] = useState<Record<string, FlagValue>>({})
    const [bisyncOptionsJson, setBisyncOptionsJson] = useState<string>('{}')
    const [outerBisyncOptions, setOuterBisyncOptions] = useState<Record<string, boolean>>({})

    const [filterOptionsLocked, setFilterOptionsLocked] = useState(false)
    const [filterOptions, setFilterOptions] = useState<Record<string, FlagValue>>({})
    const [filterOptionsJson, setFilterOptionsJson] = useState<string>('{}')

    const [configOptionsLocked, setConfigOptionsLocked] = useState(false)
    const [configOptions, setConfigOptions] = useState<Record<string, FlagValue>>({})
    const [configOptionsJson, setConfigOptionsJson] = useState<string>('{}')

    const [remoteOptionsLocked, setRemoteOptionsLocked] = useState(false)
    const [remoteOptions, setRemoteOptions] = useState<Record<string, FlagValue>>({})
    const [remoteOptionsJson, setRemoteOptionsJson] = useState<string>('{}')

    const [currentGlobalOptions, setCurrentGlobalOptions] = useState<any[]>([])

    const selectedRemotes = (() => {
        return [...(sources || []), dest].filter(Boolean) as string[]
    })()

    useEffect(() => {
        getCurrentGlobalFlags().then((flags) => {
            startTransition(() => {
                setCurrentGlobalOptions(flags)
            })
        })
    }, [])

    useEffect(() => {
        getCurrentGlobalFlags().then((flags) =>
            startTransition(() => setCurrentGlobalOptions(flags))
        )
    }, [])

    // biome-ignore lint/correctness/useExhaustiveDependencies: when unlocking, we don't want to re-run the effect
    useEffect(() => {
        const storeData = usePersistedStore.getState()

        const sourceRemote = getRemoteName(sources?.[0])
        const destRemote = getRemoteName(dest)

        let mergedBisyncDefaults = {}
        let mergedFilterDefaults = {}
        let mergedConfigDefaults = {}

        // Helper function to merge defaults from a remote
        const mergeRemoteDefaults = (remote: string | null) => {
            if (!remote) return

            const remoteConfig = storeData.remoteConfigList?.[remote] || {}

            if (remoteConfig.bisyncDefaults) {
                mergedBisyncDefaults = {
                    ...mergedBisyncDefaults,
                    ...remoteConfig.bisyncDefaults,
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

        if (Object.keys(mergedBisyncDefaults).length > 0 && !bisyncOptionsLocked) {
            setBisyncOptionsJson(JSON.stringify(mergedBisyncDefaults, null, 2))
        }

        if (Object.keys(mergedFilterDefaults).length > 0 && !filterOptionsLocked) {
            setFilterOptionsJson(JSON.stringify(mergedFilterDefaults, null, 2))
        }

        if (Object.keys(mergedConfigDefaults).length > 0 && !configOptionsLocked) {
            setConfigOptionsJson(JSON.stringify(mergedConfigDefaults, null, 2))
        }
    }, [sources, dest])

    useEffect(() => {
        let step: 'bisync' | 'filter' | 'config' | 'remote' = 'bisync'
        try {
            setBisyncOptions(JSON.parse(bisyncOptionsJson))

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
    }, [bisyncOptionsJson, filterOptionsJson, configOptionsJson, remoteOptionsJson])

    async function handleStartBisync() {
        setIsLoading(true)

        if (!sources || sources.length === 0 || !dest) {
            await message('Please select both a source and destination path', {
                title: 'Error',
                kind: 'error',
            })
            setIsLoading(false)
            return
        }

        // check local paths exists
        for (const source of sources) {
            try {
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
            } catch {}
        }

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

        if (
            sources.length > 1 &&
            filterOptions &&
            ('IncludeRule' in filterOptions || 'IncludeFrom' in filterOptions)
        ) {
            await message('Include rules are not supported with multiple sources', {
                title: 'Error',
                kind: 'error',
            })
            setIsLoading(false)
            return
        }

        const mergedConfig = {
            ...configOptions,
            ...bisyncOptions,
        }

        const failedPaths: Record<string, string> = {}

        // Group files by their parent folder to build a single IncludeRule per group
        const folderSources = sources.filter((path) => path.endsWith('/'))
        const fileSources = sources.filter((path) => !path.endsWith('/'))

        const parentToFilesMap: Record<string, string[]> = {}
        for (const fileSource of fileSources) {
            const parentFolder = fileSource.split('/').slice(0, -1).join('/')
            const fileName = fileSource.split('/').pop()!
            if (!parentToFilesMap[parentFolder]) parentToFilesMap[parentFolder] = []
            parentToFilesMap[parentFolder].push(fileName)
        }

        const fileGroups = Object.entries(parentToFilesMap)

        // Start move for each file group (per parent folder)
        for (const [parentFolder, fileNames] of fileGroups) {
            const customFilterOptions = {
                ...filterOptions,
                IncludeRule: fileNames,
            }
            console.log('[Bisync] customFilterOptions for group', parentFolder, customFilterOptions)

            const customSource = parentFolder
            console.log('[Bisync] customSource for group', parentFolder, customSource)

            const destination = dest
            console.log('[Bisync] destination for group', parentFolder, destination)

            try {
                const jobId = await startBisync({
                    path1: customSource,
                    path2: destination,
                    _config: mergedConfig,
                    _filter: customFilterOptions,
                    remoteOptions,
                    outerOptions: outerBisyncOptions,
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
                    failedPaths[`[group] ${parentFolder}`] = statusRes.error
                }
            } catch (error) {
                console.log('error', error)
                console.error('Failed to start move for group:', parentFolder, error)
                if (!failedPaths[`[group] ${parentFolder}`]) {
                    if (error instanceof Error) {
                        failedPaths[`[group] ${parentFolder}`] = error.message
                    } else {
                        failedPaths[`[group] ${parentFolder}`] = 'Unknown error'
                    }
                }
            }
        }

        // Start move for each full folder source (preserve existing behavior)
        for (const source of folderSources) {
            const isFolder = true
            const customFilterOptions = filterOptions
            console.log('[Bisync] customFilterOptions for', source, customFilterOptions)
            const customSource = source
            console.log('[Bisync] customSource for', source, customSource)

            const destination =
                isFolder && sources.length > 1
                    ? `${dest}/${source.split('/').filter(Boolean).pop()!}`
                    : dest
            console.log('[Bisync] destination for', source, destination)

            try {
                const jobId = await startBisync({
                    path1: customSource,
                    path2: destination,
                    _config: mergedConfig,
                    _filter: customFilterOptions,
                    remoteOptions,
                    outerOptions: outerBisyncOptions,
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
                console.error('Failed to start move for path:', source, error)
                if (!failedPaths[source]) {
                    if (error instanceof Error) {
                        failedPaths[source] = error.message
                    } else {
                        failedPaths[source] = 'Unknown error'
                    }
                }
            }
        }

        console.log('[Bisync] failedPaths', failedPaths)

        // dummy delay to avoid waiting when opening the Jobs page
        await new Promise((resolve) => setTimeout(resolve, 1000))

        const failedPathsKeys = Object.keys(failedPaths)
        console.log('[Bisync] failedPathsKeys', failedPathsKeys)

        const expectedJobsFinal = (() => {
            const folderSourcesFinal = (sources || []).filter((path) => path.endsWith('/'))
            const fileSourcesFinal = (sources || []).filter((path) => !path.endsWith('/'))
            const parentToFilesMapFinal: Record<string, true> = {}
            for (const fileSource of fileSourcesFinal) {
                const parentFolder = fileSource.split('/').slice(0, -1).join('/')
                parentToFilesMapFinal[parentFolder] = true
            }
            return folderSourcesFinal.length + Object.keys(parentToFilesMapFinal).length
        })()

        if (expectedJobsFinal !== failedPathsKeys.length) {
            setIsStarted(true)
        }

        if (failedPathsKeys.length > 0) {
            if (expectedJobsFinal === failedPathsKeys.length) {
                await message(`${failedPathsKeys[0]} ${failedPaths[failedPathsKeys[0]]}`, {
                    title: 'Failed to start move',
                    kind: 'error',
                })
            } else {
                await message(
                    `${failedPathsKeys.map((source) => `${source} ${failedPaths[source]}`).join(',')}`,
                    {
                        title: 'Failed to start move',
                        kind: 'error',
                    }
                )
            }
        }

        setIsLoading(false)
    }

    const buttonText = (() => {
        if (isLoading) return 'STARTING...'
        if (!sources || sources.length === 0) return 'Please select a source path'
        if (!dest) return 'Please select a destination path'
        if (sources[0] === dest) return 'Source and destination cannot be the same'
        if (jsonError) return 'Invalid JSON for ' + jsonError.toUpperCase() + ' options'
        return 'START BISYNC'
    })()

    const buttonIcon = (() => {
        if (isLoading) return
        if (!sources || sources.length === 0 || !dest || sources[0] === dest)
            return <FoldersIcon className="w-5 h-5" />
        if (jsonError) return <AlertOctagonIcon className="w-5 h-5" />
        return <PlayIcon className="w-5 h-5 fill-current" />
    })()

    return (
        <div className="flex flex-col h-screen gap-10">
            <CommandInfo
                content={`Bisync provides a bidirectional cloud sync solution in rclone. 
					
It retains the Path1 and Path2 filesystem listings from the prior run. On each successive run it will:
- List files on Path1 and Path2, and check for changes on each side (new, newer, older, and deleted files).
- Propagate changes on Path1 to Path2, and vice-versa.
					
Bisync is considered an advanced command, so use with care. Make sure you have read and understood the entire manual (especially the Limitations section) before using, or data loss can result.`}
            />

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
                        subtitle="Tap to toggle bisync options for this operation"
                        title="Bisync"
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
                            globalOptions={
                                currentGlobalOptions['main' as keyof typeof currentGlobalOptions]
                            }
                            optionsJson={bisyncOptionsJson}
                            setOptionsJson={setBisyncOptionsJson}
                            getAvailableOptions={getCopyFlags}
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
                    ) : null}
                </Accordion>
            </div>

            <div className="sticky bottom-0 z-50 flex items-center justify-center flex-none gap-2 p-4 border-t border-neutral-500/20 bg-neutral-900/50 backdrop-blur-lg">
                {isStarted ? (
                    <>
                        <Button
                            fullWidth={true}
                            color="primary"
                            size="lg"
                            onPress={() => {
                                setBisyncOptionsJson('{}')
                                setFilterOptionsJson('{}')
                                setSources(undefined)
                                setDest(undefined)
                                setIsStarted(false)
                            }}
                            data-focus-visible="false"
                        >
                            RESET
                        </Button>

                        <Button
                            fullWidth={true}
                            size="lg"
                            color="secondary"
                            onPress={async () => {
                                const createdWindow = await openWindow({
                                    name: 'Jobs',
                                    url: '/jobs',
                                })
                                await createdWindow.setFocus()
                            }}
                            data-focus-visible="false"
                        >
                            JOBS
                        </Button>

                        <Button
                            size="lg"
                            isIconOnly={true}
                            onPress={async () => {
                                await getCurrentWindow().hide()
                                await getCurrentWindow().destroy()
                            }}
                            data-focus-visible="false"
                        >
                            <XIcon />
                        </Button>
                    </>
                ) : (
                    <Button
                        onPress={handleStartBisync}
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
