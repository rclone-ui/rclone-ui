import { Accordion, AccordionItem, Avatar, Button, Switch } from '@heroui/react'
import { message } from '@tauri-apps/plugin-dialog'
import { exists, readDir } from '@tauri-apps/plugin-fs'
import { fetch } from '@tauri-apps/plugin-http'
import cronstrue from 'cronstrue'
import {
    AlertOctagonIcon,
    ClockIcon,
    FilterIcon,
    FoldersIcon,
    MoveIcon,
    PlayIcon,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { getRemoteName } from '../../lib/format'
import { isRemotePath } from '../../lib/fs'
import { getCopyFlags, getFilterFlags, getGlobalFlags, startMove } from '../../lib/rclone/api'
import { usePersistedStore } from '../../lib/store'
import { openWindow } from '../../lib/window'
import CronEditor from '../components/CronEditor'
import OptionsSection from '../components/OptionsSection'
import { MultiPathFinder } from '../components/PathFinder'

export default function Move() {
    const [searchParams] = useSearchParams()

    const [sources, setSources] = useState<string[] | undefined>(
        searchParams.get('initialSource') ? [searchParams.get('initialSource')!] : undefined
    )
    const [dest, setDest] = useState<string | undefined>(undefined)
    const [createEmptySrcDirs, setCreateEmptySrcDirs] = useState(false)
    const [deleteEmptyDstDirs, setDeleteEmptyDstDirs] = useState(false)

    const [isStarted, setIsStarted] = useState(false)
    const [isLoading, setIsLoading] = useState(false)
    const [jsonError, setJsonError] = useState<'move' | 'filter' | null>(null)

    const [moveOptionsLocked, setMoveOptionsLocked] = useState(false)
    const [moveOptions, setMoveOptions] = useState<Record<string, string>>({})
    const [moveOptionsJson, setMoveOptionsJson] = useState<string>('{}')

    const [filterOptionsLocked, setFilterOptionsLocked] = useState(false)
    const [filterOptions, setFilterOptions] = useState<Record<string, string>>({})
    const [filterOptionsJson, setFilterOptionsJson] = useState<string>('{}')

    const [cronExpression, setCronExpression] = useState<string | null>(null)

    const [globalOptions, setGlobalOptions] = useState<any[]>([])

    // biome-ignore lint/correctness/useExhaustiveDependencies: when unlocking, we don't want to re-run the effect
    useEffect(() => {
        const storeData = usePersistedStore.getState()

        const sourceRemote = getRemoteName(sources?.[0])
        const destRemote = getRemoteName(dest)

        let mergedMoveDefaults = {}
        let mergedFilterDefaults = {}

        // Helper function to merge defaults from a remote
        const mergeRemoteDefaults = (remote: string | null) => {
            if (!remote || !(remote in storeData.remoteConfigList)) return

            const remoteConfig = storeData.remoteConfigList[remote]

            if (remoteConfig.moveDefaults) {
                mergedMoveDefaults = {
                    ...mergedMoveDefaults,
                    ...remoteConfig.moveDefaults,
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

        if (Object.keys(mergedMoveDefaults).length > 0 && !moveOptionsLocked) {
            setMoveOptionsJson(JSON.stringify(mergedMoveDefaults, null, 2))
        }

        if (Object.keys(mergedFilterDefaults).length > 0 && !filterOptionsLocked) {
            setFilterOptionsJson(JSON.stringify(mergedFilterDefaults, null, 2))
        }
    }, [sources, dest])

    useEffect(() => {
        getGlobalFlags().then((flags) => setGlobalOptions(flags))
    }, [])

    useEffect(() => {
        let step: 'move' | 'filter' = 'move'
        try {
            setMoveOptions(JSON.parse(moveOptionsJson))

            step = 'filter'
            setFilterOptions(JSON.parse(filterOptionsJson))

            setJsonError(null)
        } catch (error) {
            setJsonError(step)
            console.error(`Error parsing ${step} options:`, error)
        }
    }, [moveOptionsJson, filterOptionsJson])

    const handleStartMove = useCallback(async () => {
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
                'type': 'move',
                'cron': cronExpression,
                'args': {
                    'srcFs': sources[0],
                    'dstFs': dest,
                    'createEmptySrcDirs': createEmptySrcDirs,
                    'deleteEmptyDstDirs': deleteEmptyDstDirs,
                    '_config': moveOptions,
                    '_filter': filterOptions,
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

                const jobId = await startMove({
                    srcFs: customSource,
                    dstFs: dest,
                    createEmptySrcDirs,
                    deleteEmptyDstDirs,
                    _config: moveOptions,
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
    }, [
        sources,
        dest,
        moveOptions,
        filterOptions,
        cronExpression,
        createEmptySrcDirs,
        deleteEmptyDstDirs,
    ])

    const buttonText = useMemo(() => {
        if (isLoading) return 'STARTING...'
        if (!sources || sources.length === 0) return 'Please select a source path'
        if (!dest) return 'Please select a destination path'
        if (sources[0] === dest) return 'Source and destination cannot be the same'
        if (jsonError) return 'Invalid JSON for ' + jsonError.toUpperCase() + ' options'
        return 'START MOVE'
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

                <div className="flex flex-col gap-2 pt-2 -mb-5">
                    <Switch isSelected={createEmptySrcDirs} onValueChange={setCreateEmptySrcDirs}>
                        Create empty source directories on destination after move
                    </Switch>

                    <Switch isSelected={deleteEmptyDstDirs} onValueChange={setDeleteEmptyDstDirs}>
                        Delete empty source directories after move
                    </Switch>
                </div>

                <Accordion>
                    <AccordionItem
                        key="move"
                        startContent={
                            <Avatar color="primary" radius="lg" fallback={<MoveIcon />} />
                        }
                        indicator={<MoveIcon />}
                        subtitle="Tap to toggle move options for this operation"
                        title="Move"
                    >
                        <OptionsSection
                            globalOptions={globalOptions['main' as keyof typeof globalOptions]}
                            optionsJson={moveOptionsJson}
                            setOptionsJson={setMoveOptionsJson}
                            optionsFetcher={getCopyFlags}
                            rows={18}
                            isLocked={moveOptionsLocked}
                            setIsLocked={setMoveOptionsLocked}
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
                                setMoveOptionsJson('{}')
                                setFilterOptionsJson('{}')
                                setSources(undefined)
                                setDest(undefined)
                                setIsStarted(false)
                            }}
                            data-focus-visible="false"
                        >
                            New Move
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
                        onPress={handleStartMove}
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
