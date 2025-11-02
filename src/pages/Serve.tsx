import { Accordion, AccordionItem, Avatar, Button, Select, SelectItem } from '@heroui/react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { message } from '@tauri-apps/plugin-dialog'
import {
    AlertOctagonIcon,
    FilterIcon,
    FoldersIcon,
    PlayIcon,
    ServerCrashIcon,
    WavesLadderIcon,
    WrenchIcon,
    XIcon,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { getRemoteName } from '../../lib/format'
import {
    getConfigFlags,
    getCurrentGlobalFlags,
    getFilterFlags,
    getServeFlags,
    getVfsFlags,
    startServe,
} from '../../lib/rclone/api'
import { RCLONE_CONFIG_DEFAULTS, SERVE_TYPES } from '../../lib/rclone/constants'
import { usePersistedStore } from '../../lib/store'
import { triggerTrayRebuild } from '../../lib/tray'
import type { FlagValue } from '../../types/rclone'
import CommandInfo from '../components/CommandInfo'
import OptionsSection from '../components/OptionsSection'
import { PathField } from '../components/PathFinder'

function serializeOptions(
    dictionary: { Name: string; FieldName: string }[],
    input: Record<string, FlagValue>
) {
    const params = {} as Record<string, FlagValue>
    for (const [key, value] of Object.entries(input) as [string, FlagValue][]) {
        const flag = dictionary.find((flag) => flag.FieldName === key)
        if (flag) {
            params[flag.Name] = value
        }
    }
    return params
}

export default function Serve() {
    const [searchParams] = useSearchParams()

    const [source, setSource] = useState<string | undefined>(
        searchParams.get('initialSource') || undefined
    )
    const [type, setType] = useState<(typeof SERVE_TYPES)[number] | undefined>(undefined)

    const [isServing, setIsServing] = useState(false)
    const [isLoading, setIsLoading] = useState(false)
    const [jsonError, setJsonError] = useState<'serve' | 'vfs' | 'filter' | 'config' | null>(null)

    const [serveOptionsLocked, setServeOptionsLocked] = useState(false)
    const [serveOptions, setServeOptions] = useState<Record<string, FlagValue>>({})
    const [serveOptionsJson, setServeOptionsJson] = useState<string>('{}')

    const [vfsOptionsLocked, setVfsOptionsLocked] = useState(false)
    const [vfsOptions, setVfsOptions] = useState<Record<string, FlagValue>>({})
    const [vfsOptionsJson, setVfsOptionsJson] = useState<string>('{}')
    const [vfsFlags, setVfsFlags] = useState<Awaited<ReturnType<typeof getVfsFlags>>>([])

    const [filterOptionsLocked, setFilterOptionsLocked] = useState(false)
    const [filterOptions, setFilterOptions] = useState<Record<string, FlagValue>>({})
    const [filterOptionsJson, setFilterOptionsJson] = useState<string>('{}')

    const [configOptionsLocked, setConfigOptionsLocked] = useState(false)
    const [configOptions, setConfigOptions] = useState<Record<string, string>>({})
    const [configOptionsJson, setConfigOptionsJson] = useState<string>('{}')

    useEffect(() => {
        console.log('serializeOptions', serializeOptions(vfsFlags, vfsOptions))
    }, [vfsFlags, vfsOptions])

    const [currentGlobalOptions, setCurrentGlobalOptions] = useState<any[]>([])

    const getAvailableOptions = async () => {
        if (!type) return []
        return getServeFlags(type)
    }

    // biome-ignore lint/correctness/useExhaustiveDependencies: when unlocking, we don't want to re-run the effect
    useEffect(() => {
        const storeData = usePersistedStore.getState()

        const sourceRemoteName = getRemoteName(source)

        let mergedFilterDefaults = {}
        let mergedConfigDefaults = {}
        let mergedVfsDefaults = {}

        // Helper function to merge defaults from a remote
        const mergeRemoteDefaults = (remote: string | null) => {
            if (!remote) return

            const remoteConfig = storeData.remoteConfigList?.[remote] || {}

            if (remoteConfig.vfsDefaults) {
                mergedVfsDefaults = {
                    ...mergedVfsDefaults,
                    ...remoteConfig.vfsDefaults,
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
        if (sourceRemoteName) mergeRemoteDefaults(sourceRemoteName)

        if (Object.keys(mergedVfsDefaults).length > 0 && !vfsOptionsLocked) {
            setVfsOptionsJson(JSON.stringify(mergedVfsDefaults, null, 2))
        }

        if (Object.keys(mergedFilterDefaults).length > 0 && !filterOptionsLocked) {
            setFilterOptionsJson(JSON.stringify(mergedFilterDefaults, null, 2))
        }

        if (Object.keys(mergedConfigDefaults).length > 0 && !configOptionsLocked) {
            setConfigOptionsJson(JSON.stringify(mergedConfigDefaults, null, 2))
        }
    }, [source])

    // biome-ignore lint/correctness/useExhaustiveDependencies: when unlocking, we don't want to re-run the effect
    useEffect(() => {
        const storeData = usePersistedStore.getState()

        const sourceRemoteName = getRemoteName(source)

        let mergedServeDefaults = {}

        // Helper function to merge defaults from a remote
        const mergeRemoteDefaults = (remote: string | null) => {
            if (!remote) return
            if (!type) return

            const remoteConfig = storeData.remoteConfigList?.[remote] || {}

            if (remoteConfig.serveDefaults?.[type]) {
                mergedServeDefaults = {
                    ...mergedServeDefaults,
                    ...remoteConfig.serveDefaults?.[type],
                }
            }
        }

        // Only merge defaults for remote paths
        if (sourceRemoteName) mergeRemoteDefaults(sourceRemoteName)

        if (Object.keys(mergedServeDefaults).length > 0 && !serveOptionsLocked) {
            setServeOptionsJson(JSON.stringify(mergedServeDefaults, null, 2))
        }
    }, [source, type])

    useEffect(() => {
        getCurrentGlobalFlags().then((flags) => setCurrentGlobalOptions(flags))
        getVfsFlags().then((flags) => setVfsFlags(flags))
    }, [])

    useEffect(() => {
        let step: 'serve' | 'vfs' | 'filter' | 'config' = 'serve'
        try {
            setServeOptions(JSON.parse(serveOptionsJson))

            step = 'vfs'
            setVfsOptions(JSON.parse(vfsOptionsJson))

            step = 'filter'
            setFilterOptions(JSON.parse(filterOptionsJson))

            step = 'config'
            setConfigOptions(JSON.parse(configOptionsJson))

            setJsonError(null)
        } catch (error) {
            setJsonError(step)
            console.error(`[Serve] Error parsing ${step} options:`, error)
        }
    }, [serveOptionsJson, vfsOptionsJson, filterOptionsJson, configOptionsJson])

    async function handleStartServe() {
        if (!source || !type) return

        setIsLoading(true)

        try {
            const vfsParams = serializeOptions(vfsFlags, vfsOptions)

            await startServe({
                type,
                // fs: `${remote}:/`,
                fs: source,
                _filter: filterOptions as any,
                _config: configOptions as any,
                ...serveOptions,
                ...vfsParams,
            })

            setIsServing(true)

            await triggerTrayRebuild()
            setIsLoading(false)
        } catch (err) {
            console.error('[Serve] Failed to start serve:', err)
            const errorMessage =
                err instanceof Error ? err.message : 'Failed to start serve operation'
            await message(errorMessage, {
                title: 'Error',
                kind: 'error',
            })
            setIsLoading(false)
        }
    }

    const buttonText = (() => {
        if (isLoading) return 'STARTING...'
        if (isServing) return 'STARTED'
        if (!source) return 'Please select a source'
        if (!type) return 'Please select a serve type'
        if (jsonError) return 'Invalid JSON for ' + jsonError.toUpperCase() + ' options'
        if (!('addr' in serveOptions)) return 'Specify a listen address in the Serve options'
        return 'START SERVE'
    })()

    const buttonIcon = (() => {
        if (isLoading || isServing) return
        if (!source || !type) return <FoldersIcon className="w-5 h-5" />
        if (jsonError) return <AlertOctagonIcon className="w-4 h-4 mt-0.5" />
        if (!('addr' in serveOptions)) return <AlertOctagonIcon className="w-4 h-4 mt-0.5" />
        return <PlayIcon className="w-4 h-4 fill-current" />
    })()

    return (
        <div className="flex flex-col h-screen gap-10">
            <CommandInfo
                content={
                    'Serve allows you to serve the contents of a remote as a file server of a specific protocol/type.'
                }
            />
            <div className="flex flex-col flex-1 w-full max-w-3xl gap-6 mx-auto">
                <PathField
                    path={source || ''}
                    setPath={setSource}
                    label="Source"
                    description="Select the source remote or manually enter a path"
                    placeholder="Enter a remote:/path as source"
                    showPicker={true}
                    showFiles={false}
                />

                <Select
                    selectedKeys={type ? [type] : []}
                    onSelectionChange={(keys) => {
                        setType(keys.currentKey as (typeof SERVE_TYPES)[number])
                    }}
                    size="lg"
                    placeholder="Select a serve type"
                    label="Serve Type"
                    labelPlacement="outside"
                >
                    {SERVE_TYPES.map((type) => (
                        <SelectItem key={type} textValue={type.toUpperCase()}>
                            {type.toUpperCase()}
                        </SelectItem>
                    ))}
                </Select>

                <Accordion>
                    {type ? (
                        <AccordionItem
                            key="serve"
                            startContent={
                                <Avatar
                                    radius="lg"
                                    fallback={
                                        <ServerCrashIcon className="text-success-foreground" />
                                    }
                                    className="bg-cyan-500"
                                />
                            }
                            indicator={<ServerCrashIcon />}
                            subtitle="Tap to see Serve options for the current operation"
                            title="Serve"
                        >
                            <OptionsSection
                                optionsJson={serveOptionsJson}
                                setOptionsJson={setServeOptionsJson}
                                globalOptions={
                                    currentGlobalOptions[type as keyof typeof currentGlobalOptions]
                                }
                                getAvailableOptions={getAvailableOptions}
                                isLocked={serveOptionsLocked}
                                setIsLocked={setServeOptionsLocked}
                            />
                        </AccordionItem>
                    ) : null}
                    <AccordionItem
                        key="vfs"
                        startContent={
                            <Avatar color="warning" radius="lg" fallback={<WavesLadderIcon />} />
                        }
                        indicator={<WavesLadderIcon />}
                        subtitle="Tap to see VFS options for the current operation"
                        title="VFS"
                    >
                        <OptionsSection
                            optionsJson={vfsOptionsJson}
                            setOptionsJson={setVfsOptionsJson}
                            globalOptions={
                                currentGlobalOptions['vfs' as keyof typeof currentGlobalOptions]
                            }
                            getAvailableOptions={async () => vfsFlags}
                            isLocked={vfsOptionsLocked}
                            setIsLocked={setVfsOptionsLocked}
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
                </Accordion>
            </div>

            <div className="sticky bottom-0 z-50 flex items-center justify-center flex-none gap-5 p-4 border-t border-neutral-500/20 bg-neutral-900/50 backdrop-blur-lg">
                {isServing ? (
                    <>
                        <Button
                            fullWidth={true}
                            size="lg"
                            color="primary"
                            onPress={() => {
                                setSource(undefined)
                                setType(undefined)
                                setIsServing(false)
                            }}
                            data-focus-visible="false"
                        >
                            RESET
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
                        onPress={handleStartServe}
                        size="lg"
                        fullWidth={true}
                        color="primary"
                        isDisabled={
                            isLoading ||
                            !!jsonError ||
                            !source ||
                            !type ||
                            isServing ||
                            !('addr' in serveOptions)
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
