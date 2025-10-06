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
    XIcon,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import {
    getCurrentGlobalFlags,
    getFilterFlags,
    getServeFlags,
    getVfsFlags,
    startServe,
} from '../../lib/rclone/api'
import { RCLONE_VFS_DEFAULTS } from '../../lib/rclone/constants'
import { usePersistedStore, useStore } from '../../lib/store'
import { triggerTrayRebuild } from '../../lib/tray'
import type { FlagValue } from '../../types/rclone'
import OptionsSection from '../components/OptionsSection'

const SERVE_TYPES = ['dlna', 'ftp', 'sftp', 'http', 'nfs', 'restic', 's3', 'webdav'] as const

export default function Serve() {
    const remotes = useStore((state) => state.remotes)
    const [remote, setRemote] = useState<string | undefined>(undefined)
    const [type, setType] = useState<(typeof SERVE_TYPES)[number] | undefined>(undefined)

    const [isServing, setIsServing] = useState(false)
    const [isLoading, setIsLoading] = useState(false)
    const [jsonError, setJsonError] = useState<'mount' | 'vfs' | 'filter' | 'config' | null>(null)

    const [serveOptionsLocked, setServeOptionsLocked] = useState(false)
    const [serveOptions, setServeOptions] = useState<Record<string, FlagValue>>({})
    const [serveOptionsJson, setServeOptionsJson] = useState<string>('{}')

    const [vfsOptionsLocked, setVfsOptionsLocked] = useState(false)
    const [_, setVfsOptions] = useState<Record<string, FlagValue>>({})
    const [vfsOptionsJson, setVfsOptionsJson] = useState<string>('{}')

    const [filterOptionsLocked, setFilterOptionsLocked] = useState(false)
    const [filterOptions, setFilterOptions] = useState<Record<string, FlagValue>>({})
    const [filterOptionsJson, setFilterOptionsJson] = useState<string>('{}')

    // const [configOptionsLocked, setConfigOptionsLocked] = useState(false)
    // const [configOptions, setConfigOptions] = useState<Record<string, string>>({})
    // const [configOptionsJson, setConfigOptionsJson] = useState<string>('{}')

    const [currentGlobalOptions, setCurrentGlobalOptions] = useState<any[]>([])

    const getAvailableOptions = async () => {
        if (!type) return []
        return getServeFlags(type)
    }

    // biome-ignore lint/correctness/useExhaustiveDependencies: when unlocking, we don't want to re-run the effect
    useEffect(() => {
        const storeData = usePersistedStore.getState()

        if (!remote) return

        const remoteConfig = storeData.remoteConfigList?.[remote]

        if (!vfsOptionsLocked) {
            if (remoteConfig?.vfsDefaults && Object.keys(remoteConfig.vfsDefaults).length > 0) {
                setVfsOptionsJson(JSON.stringify(remoteConfig.vfsDefaults, null, 2))
            } else {
                setVfsOptionsJson(JSON.stringify(RCLONE_VFS_DEFAULTS, null, 2))
            }
        }

        if (
            remoteConfig?.filterDefaults &&
            Object.keys(remoteConfig.filterDefaults).length > 0 &&
            !filterOptionsLocked
        ) {
            setFilterOptionsJson(JSON.stringify(remoteConfig.filterDefaults, null, 2))
        }

        // if (!configOptionsLocked) {
        //     if (
        //         storeData.remoteConfigList?.[remote]?.configDefaults &&
        //         Object.keys(storeData.remoteConfigList?.[remote]?.configDefaults).length > 0
        //     ) {
        //         setConfigOptionsJson(
        //             JSON.stringify(storeData.remoteConfigList[remote].configDefaults, null, 2)
        //         )
        //     } else {
        //         setConfigOptionsJson(JSON.stringify(RCLONE_CONFIG_DEFAULTS, null, 2))
        //     }
        // }
    }, [remote])

    useEffect(() => {
        getCurrentGlobalFlags().then((flags) => setCurrentGlobalOptions(flags))
    }, [])

    useEffect(() => {
        let step: 'mount' | 'vfs' | 'filter' | 'config' = 'mount'
        try {
            setServeOptions(JSON.parse(serveOptionsJson))

            step = 'vfs'
            setVfsOptions(JSON.parse(vfsOptionsJson))

            step = 'filter'
            setFilterOptions(JSON.parse(filterOptionsJson))

            // step = 'config'
            // setConfigOptions(JSON.parse(configOptionsJson))

            setJsonError(null)
        } catch (error) {
            setJsonError(step)
            console.error(`[Mount] Error parsing ${step} options:`, error)
        }
    }, [serveOptionsJson, vfsOptionsJson, filterOptionsJson])

    async function handleStartServe() {
        if (!remote || !type) return

        setIsLoading(true)

        try {
            await startServe({
                type,
                fs: `${remote}:/`,
                _filter: filterOptions as any,
                ...serveOptions,
            })

            setIsServing(true)

            await triggerTrayRebuild()
            setIsLoading(false)
        } catch (err) {
            console.error('[Mount] Failed to start mount:', err)
            const errorMessage =
                err instanceof Error ? err.message : 'Failed to start mount operation'
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
        if (!remote) return 'Please select a remote'
        if (!type) return 'Please select a serve type'

        if (jsonError) return 'Invalid JSON for ' + jsonError.toUpperCase() + ' options'

        if (!('addr' in serveOptions)) return 'Specify a listen address in the Serve options'
        return 'START SERVE'
    })()

    console.log('serveOptions', serveOptions)

    const buttonIcon = (() => {
        if (isLoading || isServing) return
        if (!remote || !type) return <FoldersIcon className="w-5 h-5" />
        if (jsonError) return <AlertOctagonIcon className="w-4 h-4 mt-0.5" />
        if (!('addr' in serveOptions)) return <AlertOctagonIcon className="w-4 h-4 mt-0.5" />
        return <PlayIcon className="w-4 h-4 fill-current" />
    })()

    console.log('type', type)
    return (
        <div className="flex flex-col h-screen gap-10 pt-10">
            <div className="flex flex-col flex-1 w-full max-w-3xl gap-6 mx-auto">
                <Select
                    selectedKeys={remote ? [remote] : []}
                    onSelectionChange={(keys) => {
                        setRemote(keys.currentKey as string)
                    }}
                    size="lg"
                    placeholder="Select a remote"
                    label="Remote"
                    labelPlacement="outside"
                    classNames={{}}
                >
                    {remotes.map((remote) => (
                        <SelectItem key={remote} textValue={remote}>
                            {remote}
                        </SelectItem>
                    ))}
                </Select>

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
                                    color="success"
                                    radius="lg"
                                    fallback={<ServerCrashIcon />}
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
                            getAvailableOptions={getVfsFlags}
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
                    {/* <AccordionItem
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
                    </AccordionItem> */}
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
                                setRemote(undefined)
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
                        isDisabled={isLoading || !!jsonError || !remote || !type || isServing}
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
