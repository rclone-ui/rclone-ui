import { useAutoAnimate } from '@formkit/auto-animate/react'
import { Accordion, AccordionItem, Avatar, Button, Divider, cn } from '@heroui/react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { message } from '@tauri-apps/plugin-dialog'
import { exists } from '@tauri-apps/plugin-fs'
import cronstrue from 'cronstrue'
import {
    AlertOctagonIcon,
    ChevronDownIcon,
    ClockIcon,
    CopyIcon,
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
    startCopy,
} from '../../lib/rclone/api'
import { RCLONE_CONFIG_DEFAULTS } from '../../lib/rclone/constants'
import { usePersistedStore } from '../../lib/store'
import { openWindow } from '../../lib/window'
import CommandInfo from '../components/CommandInfo'
import CronEditor from '../components/CronEditor'
import OptionsSection from '../components/OptionsSection'
import { MultiPathFinder } from '../components/PathFinder'
import RemoteOptionsSection from '../components/RemoteOptionsSection'
import TemplatesDropdown from '../components/TemplatesDropdown'

export default function Copy() {
    const [searchParams] = useSearchParams()

    const [sources, setSources] = useState<string[] | undefined>(
        searchParams.get('initialSource') ? [searchParams.get('initialSource')!] : undefined
    )
    const [dest, setDest] = useState<string | undefined>(undefined)

    const [isStarted, setIsStarted] = useState(false)
    const [isLoading, setIsLoading] = useState(false)
    const [jsonError, setJsonError] = useState<'copy' | 'filter' | 'config' | 'remote' | null>(null)

    const [copyOptionsLocked, setCopyOptionsLocked] = useState(false)
    const [copyOptions, setCopyOptions] = useState<Record<string, string>>({})
    const [copyOptionsJson, setCopyOptionsJson] = useState<string>('{}')

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
        return [...(sources || []), dest].filter(Boolean) as string[]
    })()

    console.log('[Copy] selectedRemotes', selectedRemotes)

    // console.log('sources', sources)
    // console.log('dest', dest)

    useEffect(() => {
        getCurrentGlobalFlags().then((flags) => {
            startTransition(() => {
                setCurrentGlobalOptions(flags)
            })
        })
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
            if (!remote) return

            const remoteConfig = storeData.remoteConfigList?.[remote] || {}

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
        startTransition(() => {
            let step: 'copy' | 'filter' | 'config' | 'remote' = 'copy'
            try {
                setCopyOptions(JSON.parse(copyOptionsJson))

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
        })
    }, [copyOptionsJson, filterOptionsJson, configOptionsJson, remoteOptionsJson])

    const buttonText = (() => {
        if (isLoading) return 'STARTING...'
        if (!sources || sources.length === 0) return 'Please select a source path'
        if (!dest) return 'Please select a destination path'
        if (sources[0] === dest) return 'Source and destination cannot be the same'
        if (jsonError) return 'Invalid JSON for ' + jsonError.toUpperCase() + ' options'
        return 'START COPY'
    })()

    const buttonIcon = (() => {
        if (isLoading) return
        if (!sources || sources.length === 0 || !dest || sources[0] === dest)
            return <FoldersIcon className="w-5 h-5" />
        if (jsonError) return <AlertOctagonIcon className="w-5 h-5" />
        return <PlayIcon className="w-5 h-5 fill-current" />
    })()

    async function handleStartCopy() {
        setIsLoading(true)

        if (!sources || sources.length === 0 || !dest) {
            await message('Please select both a source and destination path', {
                title: 'Error',
                kind: 'error',
            })
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
                    await message(`Source does not exist, ${source} is missing`, {
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

        // Start copy for each file group (per parent folder)
        for (const [parentFolder, fileNames] of fileGroups) {
            const customFilterOptions = {
                ...filterOptions,
                IncludeRule: fileNames,
            }
            console.log('[Copy] customFilterOptions for group', parentFolder, customFilterOptions)

            const customSource = parentFolder
            console.log('[Copy] customSource for group', parentFolder, customSource)

            const destination = dest
            console.log('[Copy] destination for group', parentFolder, destination)

            try {
                // await new Promise((resolve) => setTimeout(resolve, 1000))
                const jobId = await startCopy({
                    srcFs: customSource,
                    dstFs: destination,
                    _config: mergedConfig,
                    _filter: customFilterOptions,
                    remoteOptions,
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
                console.log('[Copy] error', error)
                console.error('Failed to start copy for group:', parentFolder, error)
                if (!failedPaths[`[group] ${parentFolder}`]) {
                    if (error instanceof Error) {
                        failedPaths[`[group] ${parentFolder}`] = error.message
                    } else {
                        failedPaths[`[group] ${parentFolder}`] = 'Unknown error'
                    }
                }
            }
        }

        // Start copy for each full folder source (preserve existing behavior)
        for (const source of folderSources) {
            const isFolder = true
            const customFilterOptions = filterOptions
            console.log('[Copy] customFilterOptions for', source, customFilterOptions)
            const customSource = source
            console.log('[Copy] customSource for', source, customSource)

            const destination =
                isFolder && sources.length > 1
                    ? `${dest}/${source.split('/').filter(Boolean).pop()!}`
                    : dest
            console.log('[Copy] destination for', source, destination)

            try {
                // await new Promise((resolve) => setTimeout(resolve, 1000))
                const jobId = await startCopy({
                    srcFs: customSource,
                    dstFs: destination,
                    _config: mergedConfig,
                    _filter: customFilterOptions,
                    remoteOptions,
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
                console.log('[Copy] error', error)
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

        console.log('[Copy] failedPaths', failedPaths)

        // dummy delay to avoid waiting when opening the Jobs page
        await new Promise((resolve) => setTimeout(resolve, 1000))

        const failedPathsKeys = Object.keys(failedPaths)
        console.log('[Copy] failedPathsKeys', failedPathsKeys)

        const expectedJobsFinal = (() => {
            // Recompute to be safe in case of future changes
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
    }

    async function handleAddToTemplates(name: string) {
        if (!!jsonError || !sources || sources.length === 0 || !dest || sources[0] === dest) {
            await message('Your config for this operation is incomplete or has errors.', {
                title: 'Error',
                kind: 'error',
            })
            return
        }
        const templates = usePersistedStore.getState().templates

        const mergedOptions = {
            copyOptions,
            filterOptions,
            configOptions,
            remoteOptions,
            sources,
            dest,
        }

        const newTemplates = [
            ...templates,
            {
                id: Math.floor(Date.now() / 1000).toString(),
                name,
                operation: 'copy',
                options: mergedOptions,
            } as const,
        ]

        usePersistedStore.setState({ templates: newTemplates })
    }

    async function handleSelectTemplate(templateId: string) {
        const template = usePersistedStore
            .getState()
            .templates.find((template) => template.id === templateId)

        if (!template) {
            await message('Template not found', {
                title: 'Error',
                kind: 'error',
            })
            return
        }

        setCopyOptions(template.options.copyOptions)
        setFilterOptions(template.options.filterOptions)
        setConfigOptions(template.options.configOptions)
        setRemoteOptions(template.options.remoteOptions)
        setSources(template.options.sources)
        setDest(template.options.dest)
    }

    return (
        <div className="flex flex-col h-screen gap-10">
            <CommandInfo
                content={`Copy the source to the destination. Does not transfer files that are identical on source and destination, testing by size and modification time or MD5SUM. Doesn't delete files from the destination. If you want to also delete files from destination, to make it match source, use the SYNC command instead.

Note that it is always the contents of the directory that is synced, not the directory itself. So when source:path is a directory, it's the contents of source:path that are copied, not the directory name and contents.`}
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

                <div
                    className={cn('flex flex-col pb-10 relative', showMore && 'pb-0')}
                    ref={animationParent}
                >
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
                                    currentGlobalOptions[
                                        'main' as keyof typeof currentGlobalOptions
                                    ]
                                }
                                optionsJson={copyOptionsJson}
                                setOptionsJson={setCopyOptionsJson}
                                getAvailableOptions={getCopyFlags}
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

                    {showMore ? (
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
                            )}
                        </Accordion>
                    ) : undefined}
                </div>
            </div>

            <div className="sticky bottom-0 z-50 flex items-center justify-center flex-none gap-2 p-4 border-t border-neutral-500/20 bg-neutral-900/50 backdrop-blur-lg">
                <TemplatesDropdown
                    operation="copy"
                    onSelect={handleSelectTemplate}
                    onAdd={handleAddToTemplates}
                />
                {isStarted ? (
                    <>
                        <Button
                            fullWidth={true}
                            size="lg"
                            color="primary"
                            onPress={() => {
                                setCopyOptionsJson('{}')
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
                                // const createdWindow =
                                await openWindow({
                                    name: 'Jobs',
                                    url: '/jobs',
                                })
                                // await createdWindow.setFocus()
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
