import { Accordion, AccordionItem, Avatar, Button } from '@heroui/react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { message } from '@tauri-apps/plugin-dialog'
import { exists, mkdir, remove } from '@tauri-apps/plugin-fs'
import { openPath } from '@tauri-apps/plugin-opener'
import { platform } from '@tauri-apps/plugin-os'
import {
    AlertOctagonIcon,
    FilterIcon,
    FoldersIcon,
    HardDriveIcon,
    PlayIcon,
    WavesLadderIcon,
    WrenchIcon,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { isDirectoryEmpty } from '../../lib/fs'
import {
    getConfigFlags,
    getCurrentGlobalFlags,
    getFilterFlags,
    getMountFlags,
    getVfsFlags,
    mountRemote,
} from '../../lib/rclone/api'
import { RCLONE_CONFIG_DEFAULTS, RCLONE_VFS_DEFAULTS } from '../../lib/rclone/constants'
import { dialogGetMountPlugin } from '../../lib/rclone/mount'
import { needsMountPlugin } from '../../lib/rclone/mount'
import { usePersistedStore } from '../../lib/store'
import { triggerTrayRebuild } from '../../lib/tray'
import OptionsSection from '../components/OptionsSection'
import { PathFinder } from '../components/PathFinder'

export default function Mount() {
    const [searchParams] = useSearchParams()

    const [source, setSource] = useState<string | undefined>(
        searchParams.get('initialSource') || undefined
    )
    const [dest, setDest] = useState<string | undefined>(undefined)

    const [isMounted, setIsMounted] = useState(false)
    const [isLoading, setIsLoading] = useState(false)
    const [jsonError, setJsonError] = useState<'mount' | 'vfs' | 'filter' | 'config' | null>(null)

    const [mountOptionsLocked, setMountOptionsLocked] = useState(false)
    const [mountOptions, setMountOptions] = useState<Record<string, string>>({})
    const [mountOptionsJson, setMountOptionsJson] = useState<string>('{}')

    const [vfsOptionsLocked, setVfsOptionsLocked] = useState(false)
    const [vfsOptions, setVfsOptions] = useState<Record<string, string>>({})
    const [vfsOptionsJson, setVfsOptionsJson] = useState<string>('{}')

    const [filterOptionsLocked, setFilterOptionsLocked] = useState(false)
    const [filterOptions, setFilterOptions] = useState<Record<string, string>>({})
    const [filterOptionsJson, setFilterOptionsJson] = useState<string>('{}')

    const [configOptionsLocked, setConfigOptionsLocked] = useState(false)
    const [configOptions, setConfigOptions] = useState<Record<string, string>>({})
    const [configOptionsJson, setConfigOptionsJson] = useState<string>('{}')

    const [currentGlobalOptions, setCurrentGlobalOptions] = useState<any[]>([])

    // biome-ignore lint/correctness/useExhaustiveDependencies: when unlocking, we don't want to re-run the effect
    useEffect(() => {
        const storeData = usePersistedStore.getState()

        const remote = source?.split(':')[0]

        if (!remote) return

        if (
            storeData.remoteConfigList?.[remote]?.mountDefaults &&
            Object.keys(storeData.remoteConfigList?.[remote]?.mountDefaults).length > 0 &&
            !mountOptionsLocked
        ) {
            setMountOptionsJson(
                JSON.stringify(storeData.remoteConfigList[remote].mountDefaults, null, 2)
            )
        }

        if (!vfsOptionsLocked) {
            if (
                storeData.remoteConfigList?.[remote]?.vfsDefaults &&
                Object.keys(storeData.remoteConfigList?.[remote]?.vfsDefaults).length > 0
            ) {
                setVfsOptionsJson(
                    JSON.stringify(storeData.remoteConfigList[remote].vfsDefaults, null, 2)
                )
            } else {
                setVfsOptionsJson(JSON.stringify(RCLONE_VFS_DEFAULTS, null, 2))
            }
        }

        if (
            storeData.remoteConfigList?.[remote]?.filterDefaults &&
            Object.keys(storeData.remoteConfigList?.[remote]?.filterDefaults).length > 0 &&
            !filterOptionsLocked
        ) {
            setFilterOptionsJson(
                JSON.stringify(storeData.remoteConfigList[remote].filterDefaults, null, 2)
            )
        }

        if (!configOptionsLocked) {
            if (
                storeData.remoteConfigList?.[remote]?.configDefaults &&
                Object.keys(storeData.remoteConfigList?.[remote]?.configDefaults).length > 0
            ) {
                setConfigOptionsJson(
                    JSON.stringify(storeData.remoteConfigList[remote].configDefaults, null, 2)
                )
            } else {
                setConfigOptionsJson(JSON.stringify(RCLONE_CONFIG_DEFAULTS, null, 2))
            }
        }
    }, [source])

    useEffect(() => {
        getCurrentGlobalFlags().then((flags) => setCurrentGlobalOptions(flags))
    }, [])

    useEffect(() => {
        let step: 'mount' | 'vfs' | 'filter' | 'config' = 'mount'
        try {
            setMountOptions(JSON.parse(mountOptionsJson))

            step = 'vfs'
            setVfsOptions(JSON.parse(vfsOptionsJson))

            step = 'filter'
            setFilterOptions(JSON.parse(filterOptionsJson))

            step = 'config'
            setConfigOptions(JSON.parse(configOptionsJson))

            setJsonError(null)
        } catch (error) {
            setJsonError(step)
            console.error(`[Mount] Error parsing ${step} options:`, error)
        }
    }, [mountOptionsJson, vfsOptionsJson, filterOptionsJson, configOptionsJson])

    async function handleStartMount() {
        if (!dest || !source) return

        setIsLoading(true)

        // Extract all conditional logic outside try/catch for React Compiler compatibility
        const currentPlatform = platform()
        const needsVolumeName = ['windows', 'macos'].includes(currentPlatform)
        const _mountOptions = { ...mountOptions }

        // Check if volume name exists and generate if needed - all outside try/catch
        const hasVolumeName = 'VolumeName' in _mountOptions && _mountOptions.VolumeName
        if (!hasVolumeName && needsVolumeName) {
            const segments = source.split('/').filter(Boolean)
            console.log('[Mount] segments', segments)

            const sourcePath =
                segments.length === 1 ? segments[0].replace(/:/g, '') : segments.pop()
            console.log('[Mount] sourcePath', sourcePath)

            _mountOptions.VolumeName = `${sourcePath}-${Math.random().toString(36).substring(2, 3).toUpperCase()}`
        }

        try {
            const needsPlugin = await needsMountPlugin()
            if (needsPlugin) {
                console.log('[Mount] Mount plugin not installed')
                await dialogGetMountPlugin()
                setIsLoading(false)
                return
            }
            console.log('[Mount] Mount plugin installed')

            let directoryExists: boolean | undefined

            try {
                directoryExists = await exists(dest)
            } catch (err) {
                console.error('[Mount] Error checking if directory exists:', err)
            }
            console.log('[Mount] directoryExists', directoryExists)

            const isPlatformWindows = platform() === 'windows'

            if (directoryExists) {
                const isEmpty = await isDirectoryEmpty(dest)
                if (!isEmpty) {
                    // await resetMainWindow()

                    await message('The selected directory must be empty to mount a remote.', {
                        title: 'Mount Error',
                        kind: 'error',
                    })

                    setIsLoading(false)
                    return
                }

                if (isPlatformWindows) {
                    await remove(dest)
                }
            } else if (!isPlatformWindows) {
                try {
                    await mkdir(dest)
                } catch (error) {
                    console.error('[Mount] Error creating directory:', error)
                    await message(
                        'Failed to create mount directory. Try creating it manually first.',
                        {
                            title: 'Mount Error',
                            kind: 'error',
                        }
                    )
                    setIsLoading(false)
                    return
                }
            }

            await mountRemote({
                remotePath: source,
                mountPoint: dest,
                mountOptions: _mountOptions,
                vfsOptions,
                _filter: filterOptions,
                _config: configOptions,
            })

            setIsMounted(true)

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
        if (isLoading) return 'MOUNTING...'
        if (isMounted) return 'MOUNTED'
        if (!source) return 'Please select a source path'
        if (!dest) return 'Please select a destination path'
        if (source === dest) return 'Source and destination cannot be the same'
        if (jsonError) return 'Invalid JSON for ' + jsonError.toUpperCase() + ' options'
        return 'START MOUNT'
    })()

    const buttonIcon = (() => {
        if (isLoading || isMounted) return
        if (!source || !dest || source === dest) return <FoldersIcon className="w-5 h-5" />
        if (jsonError) return <AlertOctagonIcon className="w-4 h-4" />
        return <PlayIcon className="w-4 h-4 fill-current" />
    })()

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
                    switchable={false}
                    sourceOptions={{
                        label: 'Remote Path',
                        showPicker: false,
                        placeholder: 'Root path inside the remote',
                        showSuggestions: true,
                        clearable: true,
                    }}
                    destOptions={{
                        label: 'Mount Point',
                        showPicker: true,
                        placeholder: 'The local path to mount the remote to',
                        showSuggestions: false,
                        clearable: false,
                    }}
                />

                <Accordion>
                    <AccordionItem
                        key="mount"
                        startContent={
                            <Avatar color="secondary" radius="lg" fallback={<HardDriveIcon />} />
                        }
                        indicator={<HardDriveIcon />}
                        subtitle="Tap to see Mount options for the current operation"
                        title="Mount"
                    >
                        <OptionsSection
                            optionsJson={mountOptionsJson}
                            setOptionsJson={setMountOptionsJson}
                            globalOptions={
                                currentGlobalOptions['mount' as keyof typeof currentGlobalOptions]
                            }
                            getAvailableOptions={getMountFlags}
                            rows={7}
                            isLocked={mountOptionsLocked}
                            setIsLocked={setMountOptionsLocked}
                        />
                    </AccordionItem>
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
                            rows={10}
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
                </Accordion>
            </div>

            <div className="sticky bottom-0 z-50 flex items-center justify-center flex-none gap-5 p-4 border-t border-neutral-500/20 bg-neutral-900/50 backdrop-blur-lg">
                {isMounted ? (
                    <>
                        <Button
                            fullWidth={true}
                            size="lg"
                            onPress={() => {
                                setDest(undefined)
                                setIsMounted(false)
                            }}
                            data-focus-visible="false"
                        >
                            New Mount
                        </Button>

                        <Button
                            fullWidth={true}
                            size="lg"
                            color="primary"
                            onPress={async () => {
                                if (!dest) return
                                try {
                                    await openPath(dest)
                                } catch (err) {
                                    console.error('[Mount] Error opening path:', err)
                                    await message(`Failed to open ${dest} (${err})`, {
                                        title: 'Open Error',
                                        kind: 'error',
                                    })
                                }
                                await getCurrentWindow().destroy()
                            }}
                            data-focus-visible="false"
                        >
                            Open
                        </Button>
                    </>
                ) : (
                    <Button
                        onPress={handleStartMount}
                        size="lg"
                        fullWidth={true}
                        color="primary"
                        isDisabled={
                            isLoading ||
                            !!jsonError ||
                            !source ||
                            !dest ||
                            source === dest ||
                            isMounted
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
