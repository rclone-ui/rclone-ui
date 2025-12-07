import {
    Accordion,
    AccordionItem,
    Avatar,
    Button,
    ButtonGroup,
    Dropdown,
    DropdownItem,
    DropdownMenu,
    DropdownTrigger,
    Select,
    SelectItem,
    Tooltip,
} from '@heroui/react'
import * as Sentry from '@sentry/browser'
import { useMutation } from '@tanstack/react-query'
import { message } from '@tauri-apps/plugin-dialog'
import { openUrl } from '@tauri-apps/plugin-opener'
import { platform } from '@tauri-apps/plugin-os'
import { AnimatePresence, motion } from 'framer-motion'
import {
    AlertOctagonIcon,
    ClockIcon,
    FilterIcon,
    FoldersIcon,
    PlayIcon,
    ServerCrashIcon,
    WavesLadderIcon,
    WrenchIcon,
} from 'lucide-react'
import { startTransition, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { getOptionsSubtitle } from '../../lib/flags'
import { useFlags } from '../../lib/hooks'
import { startServe } from '../../lib/rclone/api'
import { RCLONE_CONFIG_DEFAULTS, SERVE_TYPES } from '../../lib/rclone/constants'
import type { FlagValue } from '../../types/rclone'
import CommandInfoButton from '../components/CommandInfoButton'
import CommandsDropdown from '../components/CommandsDropdown'
import OperationWindowContent from '../components/OperationWindowContent'
import OperationWindowFooter from '../components/OperationWindowFooter'
import OptionsSection from '../components/OptionsSection'
import { PathField } from '../components/PathFinder'
import TemplatesDropdown from '../components/TemplatesDropdown'

export default function Serve() {
    const [searchParams] = useSearchParams()
    const { globalFlags, filterFlags, configFlags, vfsFlags, serveFlags } = useFlags()

    const [source, setSource] = useState<string | undefined>(
        searchParams.get('initialSource') ? searchParams.get('initialSource')! : undefined
    )
    const [type, setType] = useState<(typeof SERVE_TYPES)[number] | undefined>(
        searchParams.get('initialType')
            ? (searchParams.get('initialType')! as (typeof SERVE_TYPES)[number])
            : undefined
    )

    const [jsonError, setJsonError] = useState<'serve' | 'vfs' | 'filter' | 'config' | null>(null)

    const [serveOptionsLocked, setServeOptionsLocked] = useState(false)
    const [serveOptions, setServeOptions] = useState<Record<string, FlagValue>>({})
    const [serveOptionsJsonString, setServeOptionsJsonString] = useState<string>('{}')

    const [vfsOptionsLocked, setVfsOptionsLocked] = useState(false)
    const [vfsOptions, setVfsOptions] = useState<Record<string, FlagValue>>({})
    const [vfsOptionsJsonString, setVfsOptionsJsonString] = useState<string>('{}')

    const [filterOptionsLocked, setFilterOptionsLocked] = useState(false)
    const [filterOptions, setFilterOptions] = useState<Record<string, FlagValue>>({})
    const [filterOptionsJsonString, setFilterOptionsJsonString] = useState<string>('{}')

    const [configOptionsLocked, setConfigOptionsLocked] = useState(false)
    const [configOptions, setConfigOptions] = useState<Record<string, FlagValue>>({})
    const [configOptionsJsonString, setConfigOptionsJsonString] = useState<string>('{}')

    const startServeMutation = useMutation({
        mutationFn: async () => {
            if (!source || !type) {
                throw new Error('Please select both a source and serve type')
            }

            await startServe({
                type,
                // fs: `${remote}:/`,
                fs: source,
                _filter: filterOptions as any,
                _config: configOptions as any,
                ...(serveOptions as { addr: string } & Record<string, FlagValue>),
                ...(vfsOptions as Record<string, FlagValue>),
            })
        },
        onError: async (error) => {
            console.error('[Serve] Failed to start serve:', error)
            Sentry.captureException(error)
            await message(error instanceof Error ? error.message : 'Failed to start serve', {
                title: 'Serve',
                kind: 'error',
            })
        },
    })

    useEffect(() => {
        startTransition(() => {
            setConfigOptionsJsonString(JSON.stringify(RCLONE_CONFIG_DEFAULTS.config, null, 2))
            setVfsOptionsJsonString(JSON.stringify(RCLONE_CONFIG_DEFAULTS.vfs, null, 2))
        })
    }, [])

    useEffect(() => {
        let step: 'serve' | 'vfs' | 'filter' | 'config' = 'serve'
        try {
            const parsedServe = JSON.parse(serveOptionsJsonString) as Record<string, FlagValue>

            step = 'vfs'
            const parsedVfs = JSON.parse(vfsOptionsJsonString) as Record<string, FlagValue>

            step = 'filter'
            const parsedFilter = JSON.parse(filterOptionsJsonString) as Record<string, FlagValue>

            step = 'config'
            const parsedConfig = JSON.parse(configOptionsJsonString) as Record<string, FlagValue>

            startTransition(() => {
                setServeOptions(parsedServe)
                setVfsOptions(parsedVfs)
                setFilterOptions(parsedFilter)
                setConfigOptions(parsedConfig)
                setJsonError(null)
            })
        } catch (error) {
            setJsonError(step)
            console.error(`[Serve] Error parsing ${step} options:`, error)
        }
    }, [
        serveOptionsJsonString,
        vfsOptionsJsonString,
        filterOptionsJsonString,
        configOptionsJsonString,
    ])

    const buttonText = useMemo(() => {
        if (startServeMutation.isPending) return 'STARTING...'
        if (!source) return 'Please select a source'
        if (!type) return 'Please select a serve type'
        if (jsonError) return 'Invalid JSON for ' + jsonError.toUpperCase() + ' options'
        if (!('addr' in serveOptions)) return 'Specify a listen address in the Serve options'
        return 'START SERVE'
    }, [startServeMutation.isPending, source, type, jsonError, serveOptions])

    const buttonIcon = useMemo(() => {
        if (startServeMutation.isPending || startServeMutation.isSuccess) return
        if (!source || !type) return <FoldersIcon className="w-5 h-5" />
        if (jsonError) return <AlertOctagonIcon className="w-4 h-4 mt-0.5" />
        if (!('addr' in serveOptions)) return <AlertOctagonIcon className="w-4 h-4 mt-0.5" />
        return <PlayIcon className="w-4 h-4 fill-current" />
    }, [
        startServeMutation.isPending,
        startServeMutation.isSuccess,
        source,
        type,
        jsonError,
        serveOptions,
    ])

    return (
        <div className="flex flex-col h-screen gap-10">
            <OperationWindowContent>
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

                <Accordion
                    keepContentMounted={true}
                    dividerProps={{
                        className: 'opacity-50',
                    }}
                >
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
                            title="Serve"
                            subtitle={getOptionsSubtitle(Object.keys(serveOptions).length)}
                        >
                            <OptionsSection
                                optionsJson={serveOptionsJsonString}
                                setOptionsJson={setServeOptionsJsonString}
                                globalOptions={globalFlags?.[type] || {}}
                                availableOptions={serveFlags[type] || []}
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
                        title="VFS"
                        subtitle={getOptionsSubtitle(Object.keys(vfsOptions).length)}
                    >
                        <OptionsSection
                            optionsJson={vfsOptionsJsonString}
                            setOptionsJson={setVfsOptionsJsonString}
                            globalOptions={globalFlags?.vfs || {}}
                            availableOptions={vfsFlags || []}
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
                        title="Filters"
                        subtitle={getOptionsSubtitle(Object.keys(filterOptions).length)}
                    >
                        <OptionsSection
                            globalOptions={globalFlags?.filter || {}}
                            optionsJson={filterOptionsJsonString}
                            setOptionsJson={setFilterOptionsJsonString}
                            availableOptions={filterFlags || []}
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
                        title="Config"
                        subtitle={getOptionsSubtitle(Object.keys(configOptions).length)}
                    >
                        <OptionsSection
                            globalOptions={globalFlags?.main || {}}
                            optionsJson={configOptionsJsonString}
                            setOptionsJson={setConfigOptionsJsonString}
                            availableOptions={configFlags || []}
                            isLocked={configOptionsLocked}
                            setIsLocked={setConfigOptionsLocked}
                        />
                    </AccordionItem>
                </Accordion>
            </OperationWindowContent>

            <OperationWindowFooter>
                <TemplatesDropdown
                    isDisabled={!!jsonError}
                    operation="serve"
                    onSelect={(groupedOptions, shouldMerge) => {
                        startTransition(() => {
                            if (shouldMerge) {
                                if (groupedOptions.serve && type)
                                    setServeOptions({
                                        ...serveOptions,
                                        ...groupedOptions.serve[type],
                                    })
                                if (groupedOptions.vfs)
                                    setVfsOptions({ ...vfsOptions, ...groupedOptions.vfs })
                                if (groupedOptions.filter)
                                    setFilterOptions({ ...filterOptions, ...groupedOptions.filter })
                                if (groupedOptions.config)
                                    setConfigOptions({ ...configOptions, ...groupedOptions.config })
                            } else {
                                if (groupedOptions.serve && type)
                                    setServeOptions(groupedOptions.serve[type])
                                if (groupedOptions.vfs) setVfsOptions(groupedOptions.vfs)
                                if (groupedOptions.filter) setFilterOptions(groupedOptions.filter)
                                if (groupedOptions.config) setConfigOptions(groupedOptions.config)
                            }
                        })
                    }}
                    getOptions={() => ({
                        ...serveOptions,
                        ...vfsOptions,
                        ...filterOptions,
                        ...configOptions,
                    })}
                />
                <AnimatePresence mode="wait" initial={false}>
                    {startServeMutation.isSuccess ? (
                        <motion.div
                            key="started-buttons"
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            transition={{ duration: 0.2, ease: 'easeOut' }}
                            className="flex flex-1 gap-2"
                        >
                            <Dropdown shadow={platform() === 'windows' ? 'none' : undefined}>
                                <DropdownTrigger>
                                    <Button
                                        fullWidth={true}
                                        size="lg"
                                        color="primary"
                                        data-focus-visible="false"
                                    >
                                        NEW SERVE
                                    </Button>
                                </DropdownTrigger>
                                <DropdownMenu>
                                    <DropdownItem
                                        key="reset-source-type"
                                        onPress={() => {
                                            startTransition(() => {
                                                setSource(undefined)
                                                setType(undefined)
                                                setJsonError(null)
                                                startServeMutation.reset()
                                            })
                                        }}
                                    >
                                        Reset Source & Type
                                    </DropdownItem>
                                    <DropdownItem
                                        key="reset-options"
                                        onPress={() => {
                                            startTransition(() => {
                                                setServeOptionsJsonString('{}')
                                                setVfsOptionsJsonString(
                                                    JSON.stringify(
                                                        RCLONE_CONFIG_DEFAULTS.vfs,
                                                        null,
                                                        2
                                                    )
                                                )
                                                setFilterOptionsJsonString('{}')
                                                setConfigOptionsJsonString(
                                                    JSON.stringify(
                                                        RCLONE_CONFIG_DEFAULTS.config,
                                                        null,
                                                        2
                                                    )
                                                )
                                                setJsonError(null)
                                                startServeMutation.reset()
                                            })
                                        }}
                                    >
                                        Reset Options
                                    </DropdownItem>
                                    <DropdownItem
                                        key="reset-all"
                                        onPress={() => {
                                            startTransition(() => {
                                                setSource(undefined)
                                                setType(undefined)
                                                setServeOptionsJsonString('{}')
                                                setVfsOptionsJsonString(
                                                    JSON.stringify(
                                                        RCLONE_CONFIG_DEFAULTS.vfs,
                                                        null,
                                                        2
                                                    )
                                                )
                                                setFilterOptionsJsonString('{}')
                                                setConfigOptionsJsonString(
                                                    JSON.stringify(
                                                        RCLONE_CONFIG_DEFAULTS.config,
                                                        null,
                                                        2
                                                    )
                                                )
                                                setServeOptionsLocked(false)
                                                setVfsOptionsLocked(false)
                                                setFilterOptionsLocked(false)
                                                setConfigOptionsLocked(false)
                                                setJsonError(null)
                                                startServeMutation.reset()
                                            })
                                        }}
                                    >
                                        Reset All
                                    </DropdownItem>
                                </DropdownMenu>
                            </Dropdown>
                        </motion.div>
                    ) : (
                        <motion.div
                            key="start-button"
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            transition={{ duration: 0.2, ease: 'easeOut' }}
                            className="flex flex-1"
                        >
                            <Button
                                onPress={() => setTimeout(() => startServeMutation.mutate(), 100)}
                                size="lg"
                                fullWidth={true}
                                color="primary"
                                isDisabled={
                                    startServeMutation.isPending ||
                                    !!jsonError ||
                                    !source ||
                                    !type ||
                                    startServeMutation.isSuccess ||
                                    !('addr' in serveOptions)
                                }
                                isLoading={startServeMutation.isPending}
                                endContent={buttonIcon}
                                className="max-w-2xl gap-2"
                                data-focus-visible="false"
                            >
                                {buttonText}
                            </Button>
                        </motion.div>
                    )}
                </AnimatePresence>
                <ButtonGroup variant="flat">
                    <Tooltip content="Schedule task" placement="top" size="lg" color="foreground">
                        <Button
                            size="lg"
                            type="button"
                            color="primary"
                            isIconOnly={true}
                            onPress={async () => {
                                const res = await message(
                                    'Not yet implemented, you can request this feature on GitHub.',
                                    {
                                        title: 'Schedule Serves',
                                        kind: 'info',
                                        buttons: {
                                            ok: 'Request Feature',
                                        },
                                    }
                                )

                                if (res === 'Ok') {
                                    await openUrl(
                                        'https://github.com/rclone-ui/rclone-ui/issues/18'
                                    )
                                }
                            }}
                        >
                            <ClockIcon className="size-6" />
                        </Button>
                    </Tooltip>
                    <CommandInfoButton
                        content={`Serve allows you to serve the contents of a remote as a file server using various protocols.

This turns any rclone remote into a server that other applications and devices can connect to. Choose a protocol based on what your clients support.

Available server types:

• HTTP — Serves files over HTTP. Can be viewed in a web browser or used as an HTTP remote. Supports directory listing and file downloads.

• WebDAV — Serves files via the WebDAV protocol. Compatible with Windows Explorer, macOS Finder, and many file managers. Supports read and write operations.

• FTP — Serves files over the FTP protocol. Works with any FTP client. Supports read and write operations with VFS caching enabled.

• SFTP — Serves files over SFTP (SSH File Transfer Protocol). More secure than FTP. Requires authentication via username/password or SSH keys.

• DLNA — Serves media files to DLNA-compatible devices like smart TVs, Xbox, PlayStation, and VLC. Automatically discovered on your local network via SSDP.

• S3 — Serves files using the S3 API. Allows S3-compatible clients and tools to access your remote. Experimental feature.

• NFS — Serves files as an NFS mount. Useful on macOS where FUSE is difficult to install. Requires VFS caching for write access. Experimental feature.

• Restic — Serves files via restic's REST API. Allows the restic backup tool to use rclone as a storage backend for cloud providers restic doesn't support directly.

• Docker — Implements Docker's volume plugin API. Allows Docker containers to use rclone remotes as volumes. Linux only.

Here's a quick guide to using Serve:

1. SELECT SOURCE
Choose which remote (and optional subfolder) to serve. This is the content that will be accessible to clients.

2. SELECT TYPE
Choose the server protocol. Pick based on what your clients support — HTTP for browsers, WebDAV for file managers, DLNA for media players, etc.

3. CONFIGURE OPTIONS
Expand the accordion sections to customize your server. The most important option is "addr" in the Serve section — this sets the IP and port to listen on (e.g., ":8080" for all interfaces, or "127.0.0.1:8080" for localhost only).

• Serve — Protocol-specific options including listen address, authentication, and TLS settings.

• VFS — Virtual File System caching. Set vfs_cache_mode to "writes" or "full" if you need write access.

• Filters — Include or exclude files by pattern.

• Config — Global rclone settings.

4. START SERVE
Once configured, tap "START SERVE" to begin. The server will run until you stop it or quit the app.`}
                    />
                    <CommandsDropdown currentCommand="serve" />
                </ButtonGroup>
            </OperationWindowFooter>
        </div>
    )
}
