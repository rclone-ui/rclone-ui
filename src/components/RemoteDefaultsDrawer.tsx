import { Checkbox, Tab, Tabs } from '@heroui/react'
import { Drawer, DrawerBody, DrawerContent, DrawerFooter, DrawerHeader } from '@heroui/react'
import { Accordion, AccordionItem, Avatar, Button, Input } from '@heroui/react'
import { homeDir } from '@tauri-apps/api/path'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { message, open } from '@tauri-apps/plugin-dialog'
import {
    CogIcon,
    CopyIcon,
    FilterIcon,
    FolderOpen,
    FolderSyncIcon,
    HardDriveIcon,
    ServerCrashIcon,
    WavesLadderIcon,
    WrenchIcon,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import {
    getConfigFlags,
    getCopyFlags,
    getCurrentGlobalFlags,
    getFilterFlags,
    getMountFlags,
    getServeFlags,
    getSyncFlags,
    getVfsFlags,
} from '../../lib/rclone/api'
import { SERVE_TYPES } from '../../lib/rclone/constants'
import { type RemoteConfig, usePersistedStore } from '../../lib/store'
import { triggerTrayRebuild } from '../../lib/tray'
import { lockWindows, unlockWindows } from '../../lib/window'
import OptionsSection from './OptionsSection'

export default function RemoteDefaultsDrawer({
    remoteName,
    onClose,
    isOpen,
}: {
    remoteName: string
    onClose: () => void
    isOpen: boolean
}) {
    const licenseValid = usePersistedStore((state) => state.licenseValid)
    const remoteConfigList = usePersistedStore((state) => state.remoteConfigList)
    const mergeRemoteConfig = usePersistedStore((state) => state.mergeRemoteConfig)

    const [isSaving, setIsSaving] = useState(false)
    const [buttonText, setButtonText] = useState('Save Changes')

    const [config, setConfig] = useState<RemoteConfig | null>(null)

    const [configOptionsJson, setConfigOptionsJson] = useState<string>('{}')
    const [copyOptionsJson, setCopyOptionsJson] = useState<string>('{}')
    const [syncOptionsJson, setSyncOptionsJson] = useState<string>('{}')
    const [filterOptionsJson, setFilterOptionsJson] = useState<string>('{}')
    const [mountOptionsJson, setMountOptionsJson] = useState<string>('{}')
    const [vfsOptionsJson, setVfsOptionsJson] = useState<string>('{}')
    const [serveOptionsJsonForType, setServeOptionsJsonForType] = useState<Record<string, string>>(
        {}
    )

    const [globalOptions, setGlobalOptions] = useState<any[]>([])

    useEffect(() => {
        getCurrentGlobalFlags().then((flags) => setGlobalOptions(flags))
    }, [])

    useEffect(() => {
        if (config?.disabledActions?.length === 3) {
            setConfig((prev) => ({
                ...prev,
                disabledActions: [...(prev?.disabledActions || []), 'tray'],
            }))
        }
    }, [config?.disabledActions?.length])

    useEffect(() => {
        // console.log(JSON.stringify(remoteConfigList, null, 2))

        const remoteConfig = remoteConfigList[remoteName] || {}
        setConfig(remoteConfig)

        console.log('remoteName', remoteName)
        // console.log(JSON.stringify(remoteConfig, null, 2))

        setConfigOptionsJson(JSON.stringify(remoteConfig?.configDefaults || {}, null, 2))
        setCopyOptionsJson(JSON.stringify(remoteConfig?.copyDefaults || {}, null, 2))
        setSyncOptionsJson(JSON.stringify(remoteConfig?.syncDefaults || {}, null, 2))
        setFilterOptionsJson(JSON.stringify(remoteConfig?.filterDefaults || {}, null, 2))
        setMountOptionsJson(JSON.stringify(remoteConfig?.mountDefaults || {}, null, 2))
        setVfsOptionsJson(JSON.stringify(remoteConfig?.vfsDefaults || {}, null, 2))
        for (const type of SERVE_TYPES) {
            setServeOptionsJsonForType((prev) => ({
                ...prev,
                [type]: JSON.stringify(
                    remoteConfig?.serveDefaults?.[
                        type as keyof typeof remoteConfig.serveDefaults
                    ] || {},
                    null,
                    2
                ),
            }))
        }
    }, [remoteConfigList, remoteName])

    async function handleSubmit() {
        if (!config) {
            console.log('No config')
            return
        }

        setIsSaving(true)

        const newConfig = {
            ...config,
        }

        const parseJson = <T,>(json: string) => {
            try {
                return { ok: true as const, value: JSON.parse(json) as T }
            } catch (error) {
                return { ok: false as const, error }
            }
        }

        const parseOptionsOrAbort = async <T,>(json: string, label: string) => {
            const result = parseJson<T>(json)
            if (!result.ok) {
                await message(`Could not update remote, error parsing ${label} options`, {
                    title: 'Invalid JSON',
                    kind: 'error',
                })
                setIsSaving(false)
                return null
            }
            return result.value
        }

        // react compiler todo: support value blocks

        const configOptions = await parseOptionsOrAbort<Record<string, unknown>>(
            configOptionsJson,
            'Config'
        )
        if (configOptions === null) {
            return
        }
        if (Object.keys(configOptions).length > 0) {
            newConfig.configDefaults = configOptions
        }

        const copyOptions = await parseOptionsOrAbort<Record<string, unknown>>(
            copyOptionsJson,
            'Copy'
        )
        if (copyOptions === null) {
            return
        }
        if (Object.keys(copyOptions).length > 0) {
            newConfig.copyDefaults = copyOptions
        }

        const mountOptions = await parseOptionsOrAbort<Record<string, unknown>>(
            mountOptionsJson,
            'Mount'
        )
        if (mountOptions === null) {
            return
        }
        if (Object.keys(mountOptions).length > 0) {
            newConfig.mountDefaults = mountOptions
        }

        const syncOptions = await parseOptionsOrAbort<Record<string, unknown>>(
            syncOptionsJson,
            'Sync'
        )
        if (syncOptions === null) {
            return
        }
        if (Object.keys(syncOptions).length > 0) {
            newConfig.syncDefaults = syncOptions
        }

        const filterOptions = await parseOptionsOrAbort<Record<string, unknown>>(
            filterOptionsJson,
            'Filter'
        )
        if (filterOptions === null) {
            return
        }
        if (Object.keys(filterOptions).length > 0) {
            newConfig.filterDefaults = filterOptions
        }

        const vfsOptions = await parseOptionsOrAbort<Record<string, unknown>>(vfsOptionsJson, 'VFS')
        if (vfsOptions === null) {
            return
        }
        if (Object.keys(vfsOptions).length > 0) {
            newConfig.vfsDefaults = vfsOptions
        }

        const serveDefaultsAccumulator: Record<
            (typeof SERVE_TYPES)[number],
            Record<string, unknown>
        > = {
            ...SERVE_TYPES.reduce(
                (acc, type) => {
                    acc[type] = {}
                    return acc
                },
                {} as Record<(typeof SERVE_TYPES)[number], Record<string, unknown>>
            ),
        }
        for (let i = 0; i < SERVE_TYPES.length; i++) {
            const type = SERVE_TYPES[i]
            const serveOptionsJsonValue =
                serveOptionsJsonForType[type as keyof typeof serveOptionsJsonForType]
            const jsonToParse = serveOptionsJsonValue === undefined ? '{}' : serveOptionsJsonValue

            const serveOptions = await parseOptionsOrAbort<Record<string, unknown>>(
                jsonToParse,
                `Serve (${type})`
            )
            if (serveOptions === null) {
                return
            }

            if (Object.keys(serveOptions).length > 0) {
                serveDefaultsAccumulator[type] = serveOptions
            }
        }

        if (Object.keys(serveDefaultsAccumulator).length > 0) {
            newConfig.serveDefaults = {
                ...(newConfig.serveDefaults ?? {}),
                ...serveDefaultsAccumulator,
            }
        }

        try {
            mergeRemoteConfig(remoteName, newConfig)
            await triggerTrayRebuild()
            setConfig(newConfig)
            await new Promise((resolve) => setTimeout(resolve, 500))
            setButtonText('Saved')
            setTimeout(() => {
                setButtonText('Save Changes')
            }, 1200)
        } catch (error) {
            console.error('Failed to update remote:', error)
            await message(error instanceof Error ? error.message : 'Unknown error occurred', {
                title: 'Could not update remote',
                kind: 'error',
            })
        }
        setIsSaving(false)
    }

    return (
        <Drawer
            isOpen={isOpen}
            placement={'bottom'}
            size="full"
            onClose={onClose}
            hideCloseButton={true}
        >
            <DrawerContent>
                {(close) => (
                    <>
                        <DrawerHeader className="flex flex-col gap-1">Defaults</DrawerHeader>
                        <DrawerBody>
                            <Accordion selectionMode="multiple" defaultExpandedKeys={['general']}>
                                <AccordionItem
                                    key="general"
                                    startContent={
                                        <Avatar
                                            color="default"
                                            radius="lg"
                                            fallback={<CogIcon />}
                                        />
                                    }
                                    indicator={<CogIcon />}
                                    subtitle={`General defaults for ${remoteName}`}
                                    title="UI & General"
                                >
                                    <div className="flex flex-col gap-2">
                                        <Checkbox
                                            isSelected={!config?.disabledActions?.includes('tray')}
                                            onValueChange={(value) => {
                                                if (value) {
                                                    setConfig((prev) => ({
                                                        ...prev,
                                                        disabledActions:
                                                            prev?.disabledActions?.filter(
                                                                (action) => action !== 'tray'
                                                            ),
                                                    }))
                                                } else {
                                                    setConfig((prev) => ({
                                                        ...prev,
                                                        disabledActions: [
                                                            ...(prev?.disabledActions || []),
                                                            'tray',
                                                        ],
                                                    }))
                                                }
                                            }}
                                        >
                                            Show in tray menu
                                        </Checkbox>
                                        <Checkbox
                                            isSelected={
                                                !config?.disabledActions?.includes('tray-mount')
                                            }
                                            onValueChange={(value) => {
                                                if (value) {
                                                    setConfig((prev) => ({
                                                        ...prev,
                                                        disabledActions:
                                                            prev?.disabledActions?.filter(
                                                                (action) => action !== 'tray-mount'
                                                            ),
                                                    }))
                                                } else {
                                                    setConfig((prev) => ({
                                                        ...prev,
                                                        disabledActions: [
                                                            ...(prev?.disabledActions || []),
                                                            'tray-mount',
                                                        ],
                                                    }))
                                                }
                                            }}
                                        >
                                            Show{' '}
                                            <span className="font-mono text-blue-300">Mount</span>{' '}
                                            option
                                        </Checkbox>
                                        <Checkbox
                                            isSelected={
                                                !config?.disabledActions?.includes('tray-browse')
                                            }
                                            onValueChange={(value) => {
                                                if (value) {
                                                    setConfig((prev) => ({
                                                        ...prev,
                                                        disabledActions:
                                                            prev?.disabledActions?.filter(
                                                                (action) => action !== 'tray-browse'
                                                            ),
                                                    }))
                                                } else {
                                                    setConfig((prev) => ({
                                                        ...prev,
                                                        disabledActions: [
                                                            ...(prev?.disabledActions || []),
                                                            'tray-browse',
                                                        ],
                                                    }))
                                                }
                                            }}
                                        >
                                            Show{' '}
                                            <span className="font-mono text-blue-300">Browse</span>{' '}
                                            option
                                        </Checkbox>
                                        <Checkbox
                                            isSelected={
                                                !config?.disabledActions?.includes('tray-cleanup')
                                            }
                                            onValueChange={(value) => {
                                                if (value) {
                                                    setConfig((prev) => ({
                                                        ...prev,
                                                        disabledActions:
                                                            prev?.disabledActions?.filter(
                                                                (action) =>
                                                                    action !== 'tray-cleanup'
                                                            ),
                                                    }))
                                                } else {
                                                    setConfig((prev) => ({
                                                        ...prev,
                                                        disabledActions: [
                                                            ...(prev?.disabledActions || []),
                                                            'tray-cleanup',
                                                        ],
                                                    }))
                                                }
                                            }}
                                        >
                                            Show{' '}
                                            <span className="font-mono text-blue-300">Cleanup</span>{' '}
                                            option
                                        </Checkbox>
                                        <Checkbox
                                            isSelected={
                                                !config?.disabledActions?.includes('tray-remove')
                                            }
                                            onValueChange={(value) => {
                                                if (value) {
                                                    setConfig((prev) => ({
                                                        ...prev,
                                                        disabledActions:
                                                            prev?.disabledActions?.filter(
                                                                (action) => action !== 'tray-remove'
                                                            ),
                                                    }))
                                                } else {
                                                    setConfig((prev) => ({
                                                        ...prev,
                                                        disabledActions: [
                                                            ...(prev?.disabledActions || []),
                                                            'tray-remove',
                                                        ],
                                                    }))
                                                }
                                            }}
                                        >
                                            Show{' '}
                                            <span className="font-mono text-blue-300">Remove</span>{' '}
                                            option
                                        </Checkbox>
                                    </div>
                                </AccordionItem>

                                <AccordionItem
                                    key="mount"
                                    startContent={
                                        <Avatar
                                            color="secondary"
                                            radius="lg"
                                            fallback={<HardDriveIcon />}
                                        />
                                    }
                                    indicator={<HardDriveIcon />}
                                    subtitle={`Mount defaults for ${remoteName}`}
                                    title="Mount"
                                >
                                    <div className="flex flex-col gap-4">
                                        <Input
                                            placeholder="Default Remote Path (starting with bucket name: bucket/path/to/folder)"
                                            type="text"
                                            value={config?.defaultRemotePath || ''}
                                            size="lg"
                                            autoComplete="off"
                                            autoCapitalize="off"
                                            autoCorrect="off"
                                            spellCheck="false"
                                            onValueChange={(value) => {
                                                setConfig((prev) => ({
                                                    ...prev,
                                                    defaultRemotePath: value
                                                        ? value.startsWith('/')
                                                            ? value.slice(1)
                                                            : value
                                                        : undefined,
                                                }))
                                            }}
                                        />

                                        <Input
                                            placeholder="Default Mount Point"
                                            type="text"
                                            value={config?.defaultMountPoint || ''}
                                            size="lg"
                                            autoComplete="off"
                                            autoCapitalize="off"
                                            autoCorrect="off"
                                            spellCheck="false"
                                            startContent={
                                                <Button
                                                    onPress={async () => {
                                                        try {
                                                            await lockWindows()
                                                            await getCurrentWindow().setFocus()
                                                            const selected = await open({
                                                                directory: true,
                                                                multiple: false,
                                                                defaultPath: await homeDir(),
                                                                title: 'Select a mount point',
                                                            })
                                                            await unlockWindows()
                                                            if (selected) {
                                                                setConfig((prev) => ({
                                                                    ...prev,
                                                                    defaultMountPoint:
                                                                        selected as string,
                                                                }))
                                                            }
                                                        } catch (err) {
                                                            console.error(
                                                                'Failed to open folder picker:',
                                                                err
                                                            )
                                                            await message(
                                                                'Failed to open folder picker',
                                                                {
                                                                    title: 'Error',
                                                                    kind: 'error',
                                                                }
                                                            )
                                                        }
                                                    }}
                                                    isIconOnly={true}
                                                    data-focus-visible="false"
                                                    size="sm"
                                                >
                                                    <FolderOpen className="w-4 h-4" />
                                                </Button>
                                            }
                                            endContent={
                                                <Checkbox
                                                    isSelected={config?.mountOnStart || false}
                                                    onValueChange={async (value) => {
                                                        if (!licenseValid) {
                                                            await message(
                                                                'Community version does not support mount on startup.',
                                                                {
                                                                    title: 'Missing license',
                                                                    kind: 'error',
                                                                }
                                                            )
                                                            return
                                                        }

                                                        if (
                                                            !config?.defaultMountPoint ||
                                                            !config?.defaultRemotePath
                                                        ) {
                                                            await message(
                                                                'Please set a default mount point and remote path before enabling this option',
                                                                {
                                                                    title: 'Missing Information',
                                                                    kind: 'error',
                                                                }
                                                            )
                                                            return
                                                        }

                                                        setConfig((prev) => ({
                                                            ...prev,
                                                            mountOnStart: value || undefined,
                                                        }))
                                                    }}
                                                    size="sm"
                                                    data-focus-visible="false"
                                                    className="h-full m-0 min-w-fit"
                                                >
                                                    Mount on startup
                                                </Checkbox>
                                            }
                                            onValueChange={(value) => {
                                                setConfig((prev) => ({
                                                    ...prev,
                                                    defaultMountPoint: value || undefined,
                                                }))
                                            }}
                                        />

                                        <OptionsSection
                                            optionsJson={mountOptionsJson}
                                            setOptionsJson={setMountOptionsJson}
                                            globalOptions={
                                                globalOptions['mount' as keyof typeof globalOptions]
                                            }
                                            getAvailableOptions={getMountFlags}
                                        />
                                    </div>
                                </AccordionItem>

                                <AccordionItem
                                    key="config"
                                    startContent={
                                        <Avatar
                                            color="default"
                                            radius="lg"
                                            fallback={<WrenchIcon />}
                                        />
                                    }
                                    indicator={<WrenchIcon />}
                                    subtitle={`Default config flags for ${remoteName}`}
                                    title="Config"
                                >
                                    <OptionsSection
                                        optionsJson={configOptionsJson}
                                        setOptionsJson={setConfigOptionsJson}
                                        globalOptions={
                                            globalOptions['main' as keyof typeof globalOptions]
                                        }
                                        getAvailableOptions={getConfigFlags}
                                    />
                                </AccordionItem>
                                <AccordionItem
                                    key="vfs"
                                    startContent={
                                        <Avatar
                                            color="warning"
                                            radius="lg"
                                            fallback={<WavesLadderIcon />}
                                        />
                                    }
                                    indicator={<WavesLadderIcon />}
                                    subtitle={`VFS defaults for ${remoteName}`}
                                    title="VFS"
                                >
                                    <OptionsSection
                                        optionsJson={vfsOptionsJson}
                                        setOptionsJson={setVfsOptionsJson}
                                        globalOptions={
                                            globalOptions['vfs' as keyof typeof globalOptions]
                                        }
                                        getAvailableOptions={getVfsFlags}
                                    />
                                </AccordionItem>
                                <AccordionItem
                                    key="filters"
                                    startContent={
                                        <Avatar
                                            color="danger"
                                            radius="lg"
                                            fallback={<FilterIcon />}
                                        />
                                    }
                                    indicator={<FilterIcon />}
                                    subtitle={`Filtering defaults for ${remoteName}`}
                                    title="Filters"
                                >
                                    <OptionsSection
                                        optionsJson={filterOptionsJson}
                                        setOptionsJson={setFilterOptionsJson}
                                        globalOptions={
                                            globalOptions['filter' as keyof typeof globalOptions]
                                        }
                                        getAvailableOptions={getFilterFlags}
                                    />
                                </AccordionItem>
                                <AccordionItem
                                    key="copy"
                                    startContent={
                                        <Avatar
                                            color="primary"
                                            radius="lg"
                                            fallback={<CopyIcon />}
                                        />
                                    }
                                    indicator={<CopyIcon />}
                                    subtitle={`Default copy flags for ${remoteName}`}
                                    title="Copy"
                                >
                                    <OptionsSection
                                        optionsJson={copyOptionsJson}
                                        setOptionsJson={setCopyOptionsJson}
                                        globalOptions={
                                            globalOptions['main' as keyof typeof globalOptions]
                                        }
                                        getAvailableOptions={getCopyFlags}
                                    />
                                </AccordionItem>

                                <AccordionItem
                                    key="sync"
                                    startContent={
                                        <Avatar
                                            color="success"
                                            radius="lg"
                                            fallback={<FolderSyncIcon />}
                                        />
                                    }
                                    indicator={<FolderSyncIcon />}
                                    subtitle={`Sync defaults for ${remoteName}`}
                                    title="Sync"
                                >
                                    <OptionsSection
                                        optionsJson={syncOptionsJson}
                                        setOptionsJson={setSyncOptionsJson}
                                        globalOptions={
                                            globalOptions['main' as keyof typeof globalOptions]
                                        }
                                        getAvailableOptions={getSyncFlags}
                                    />
                                </AccordionItem>

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
                                    subtitle={`Default serve flags for ${remoteName}`}
                                    title="Serve"
                                >
                                    <Tabs
                                        items={SERVE_TYPES.map((type) => ({
                                            id: type,
                                            label: type.toUpperCase(),
                                        }))}
                                        fullWidth={true}
                                        variant="bordered"
                                    >
                                        {(item) => (
                                            <Tab key={item.id} title={item.label}>
                                                <OptionsSection
                                                    optionsJson={
                                                        serveOptionsJsonForType?.[
                                                            item.id as keyof typeof serveOptionsJsonForType
                                                        ]
                                                    }
                                                    setOptionsJson={(optionsJson) =>
                                                        setServeOptionsJsonForType((prev) => ({
                                                            ...prev,
                                                            [item.id]: optionsJson,
                                                        }))
                                                    }
                                                    globalOptions={
                                                        globalOptions[
                                                            item.id as keyof typeof globalOptions
                                                        ]
                                                    }
                                                    getAvailableOptions={async () =>
                                                        await getServeFlags(item.id)
                                                    }
                                                />
                                            </Tab>
                                        )}
                                    </Tabs>
                                </AccordionItem>
                            </Accordion>
                        </DrawerBody>
                        <DrawerFooter>
                            <Button
                                color="danger"
                                variant="light"
                                onPress={close}
                                data-focus-visible="false"
                            >
                                Close
                            </Button>
                            <Button
                                color="primary"
                                isDisabled={isSaving}
                                onPress={handleSubmit}
                                data-focus-visible="false"
                            >
                                {buttonText}
                            </Button>
                        </DrawerFooter>
                    </>
                )}
            </DrawerContent>
        </Drawer>
    )
}
