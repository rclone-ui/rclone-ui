import {
    Button,
    Checkbox,
    Dropdown,
    DropdownItem,
    DropdownMenu,
    DropdownTrigger,
    Modal,
    ModalBody,
    ModalContent,
    ModalFooter,
    ModalHeader,
    Progress,
    Radio,
    RadioGroup,
    ScrollShadow,
    Tooltip,
} from '@heroui/react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { message, save } from '@tauri-apps/plugin-dialog'
import { platform } from '@tauri-apps/plugin-os'
import { AnimatePresence, motion } from 'framer-motion'
import {
    CheckCircle2Icon,
    ChevronDownIcon,
    ChevronUpIcon,
    CopyIcon,
    ExternalLinkIcon,
    LoaderIcon,
    MoveIcon,
    SearchCheckIcon,
    XCircleIcon,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { getFsInfo } from '../../lib/format'
// import { Document, Page, pdfjs } from 'react-pdf'
import { formatBytes } from '../../lib/format.ts'
import { startCopy, startMove } from '../../lib/rclone/api'
import rclone from '../../lib/rclone/client'
import { openWindow } from '../../lib/window'
import { FileIcon } from '../components/navigator'
import { FilePanel, type FilePanelHandle } from '../components/navigator'
import type { Entry, SelectItem } from '../components/navigator/types'

export default function Browser() {
    const leftPanelRef = useRef<FilePanelHandle>(null)
    const rightPanelRef = useRef<FilePanelHandle>(null)

    const [dropOperation, setDropOperation] = useState<{
        items: SelectItem[]
        destination: string
    } | null>(null)

    const [contextMenu, setContextMenu] = useState<{
        entry: Entry
        x: number
        y: number
        panelSide: 'left' | 'right'
    } | null>(null)

    const [trackedJobIds, setTrackedJobIds] = useState<Set<number>>(new Set())

    const handleJobStarted = useCallback((jobId: number) => {
        // #region agent log
        fetch('http://127.0.0.1:7250/ingest/2834749a-e80b-4040-ad02-08316d12b97e', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                location: 'Commander.tsx:handleJobStarted',
                message: 'handleJobStarted called',
                data: { jobId },
                timestamp: Date.now(),
                sessionId: 'debug-session',
                hypothesisId: 'G',
            }),
        }).catch(() => {})
        // #endregion
        setTrackedJobIds((prev) => new Set([...prev, jobId]))
    }, [])

    const remotesQuery = useQuery({
        queryKey: ['remotes', 'list', 'all'],
        queryFn: async () => await rclone('/config/listremotes').then((r) => r?.remotes),
        staleTime: 1000 * 60,
    })

    const remotes = remotesQuery.data ?? []
    const firstRemote = remotes[0] ?? null

    const handleDrop = useCallback(
        (items: SelectItem[], destination: string, _sourceSide: 'left' | 'right') => {
            setDropOperation({ items, destination })
        },
        []
    )

    const handleOperationComplete = useCallback(() => {
        leftPanelRef.current?.refresh()
        rightPanelRef.current?.refresh()
    }, [])

    const handleDownload = useCallback(
        async (entry: Entry) => {
            const defaultName = entry.name
            const savePath = await save({
                title: `Save ${entry.isDir ? 'Folder' : 'File'}`,
                defaultPath: defaultName,
            })

            if (!savePath) return

            const srcInfo = getFsInfo(entry.fullPath)
            const dstInfo = getFsInfo(savePath)

            const srcFs = srcInfo.root
            const srcRemote = srcInfo.filePath
            const dstFs = dstInfo.root === ':local:' ? ':local:/' : dstInfo.root
            const dstRemote = dstInfo.filePath

            try {
                const endpoint = entry.isDir ? '/sync/copy' : '/operations/copyfile'
                const params = entry.isDir
                    ? {
                          srcFs: `${srcFs}${srcRemote}/`,
                          dstFs: `${dstFs}${dstRemote}`,
                          createEmptySrcDirs: true,
                      }
                    : { srcFs, srcRemote, dstFs, dstRemote }

                const result = await rclone(endpoint as any, {
                    params: { query: { ...params, _async: true } },
                })

                const jobId = result?.jobid
                if (jobId) handleJobStarted(jobId)
            } catch (error) {
                await message(error instanceof Error ? error.message : 'Download failed', {
                    title: 'Error',
                    kind: 'error',
                })
            }
        },
        [handleJobStarted]
    )

    const closeContextMenu = useCallback(() => {
        setContextMenu(null)
    }, [])

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'r' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                leftPanelRef.current?.refresh()
                rightPanelRef.current?.refresh()
            }
        }

        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [])

    useEffect(() => {
        if (contextMenu) {
            const handleClick = () => closeContextMenu()
            window.addEventListener('click', handleClick)
            return () => window.removeEventListener('click', handleClick)
        }
    }, [contextMenu, closeContextMenu])

    return (
        <div className="flex flex-col w-screen h-screen overflow-hidden">
            <Group orientation="horizontal" className="flex-1">
                <Panel defaultSize={50} minSize={25}>
                    <FilePanel
                        ref={leftPanelRef}
                        sidebarPosition="left"
                        initialRemote="UI_LOCAL_FS"
                        selectionMode="both"
                        allowFiles={true}
                        allowMultiple={true}
                        showPreviewColumn={true}
                        onDrop={(items, dest) => handleDrop(items, dest, 'left')}
                        onDownload={handleDownload}
                        allowedKeys={['REMOTES', 'LOCAL_FS', 'FAVORITES']}
                        isActive={true}
                    />
                </Panel>

                <Separator className="w-1 transition-colors bg-divider hover:bg-primary-200 active:bg-primary-300" />

                <Panel defaultSize={50} minSize={25}>
                    <FilePanel
                        ref={rightPanelRef}
                        sidebarPosition="right"
                        initialRemote={firstRemote ?? 'UI_LOCAL_FS'}
                        selectionMode="both"
                        allowFiles={true}
                        allowMultiple={true}
                        showPreviewColumn={true}
                        onDrop={(items, dest) => handleDrop(items, dest, 'right')}
                        onDownload={handleDownload}
                        allowedKeys={['REMOTES', 'LOCAL_FS', 'FAVORITES']}
                        isActive={true}
                    />
                </Panel>
            </Group>

            <TransfersBar trackedJobIds={trackedJobIds} />

            <OperationDialog
                items={dropOperation?.items ?? null}
                destination={dropOperation?.destination ?? null}
                onClose={() => setDropOperation(null)}
                onComplete={handleOperationComplete}
                onJobStarted={handleJobStarted}
            />

            {contextMenu && (
                <div className="fixed z-50" style={{ top: contextMenu.y, left: contextMenu.x }}>
                    <Dropdown
                        isOpen={true}
                        onClose={closeContextMenu}
                        shadow={platform() === 'windows' ? 'none' : undefined}
                    >
                        <DropdownTrigger>
                            <span />
                        </DropdownTrigger>
                        <DropdownMenu
                            onAction={(key) => {
                                if (key === 'preview' && !contextMenu.entry.isDir) {
                                    setPreviewItem(contextMenu.entry)
                                } else if (key === 'copy-path') {
                                    navigator.clipboard.writeText(contextMenu.entry.fullPath)
                                } else if (key === 'info') {
                                    setPreviewItem(contextMenu.entry)
                                }
                                closeContextMenu()
                            }}
                        >
                            {contextMenu.entry.isDir ? (
                                <>
                                    <DropdownItem key="copy-path">Copy Path</DropdownItem>
                                    <DropdownItem key="info">Get Info</DropdownItem>
                                </>
                            ) : (
                                <>
                                    <DropdownItem key="preview">Preview</DropdownItem>
                                    <DropdownItem key="copy-path">Copy Path</DropdownItem>
                                    <DropdownItem key="info">Get Info</DropdownItem>
                                </>
                            )}
                        </DropdownMenu>
                    </Dropdown>
                </div>
            )}
        </div>
    )
}

function TransfersBar({ trackedJobIds }: { trackedJobIds: Set<number> }) {
    const [isExpanded, setIsExpanded] = useState(false)
    const jobIds = Array.from(trackedJobIds)

    // #region agent log
    fetch('http://127.0.0.1:7250/ingest/2834749a-e80b-4040-ad02-08316d12b97e', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            location: 'Commander.tsx:TransfersBar:render',
            message: 'TransfersBar rendering',
            data: { jobIdsCount: jobIds.length, jobIds },
            timestamp: Date.now(),
            sessionId: 'debug-session',
            hypothesisId: 'G,H',
        }),
    }).catch(() => {})
    // #endregion

    const itemsQuery = useQuery({
        queryKey: ['transfers', 'items', jobIds],
        queryFn: async () => {
            if (jobIds.length === 0) return { transferring: [], checking: [], transferred: [] }

            const results = await Promise.all(
                jobIds.map(async (jobId) => {
                    const [stats, transferredData] = await Promise.all([
                        rclone('/core/stats', { params: { query: { group: `job/${jobId}` } } }),
                        rclone('/core/transferred', {
                            params: { query: { group: `job/${jobId}` } },
                        }),
                    ])
                    return {
                        jobId,
                        transferring: (stats?.transferring || []).map((t: any) => ({
                            ...t,
                            jobId,
                        })),
                        checking: (stats?.checking || []).map((c: any) => ({ ...c, jobId })),
                        transferred: (transferredData?.transferred || []).map((t: any) => ({
                            ...t,
                            jobId,
                        })),
                    }
                })
            )

            return {
                transferring: results.flatMap((r) => r.transferring),
                checking: results.flatMap((r) => r.checking),
                transferred: results.flatMap((r) => r.transferred),
            }
        },
        refetchInterval: 1000,
        enabled: jobIds.length > 0,
    })

    const transferring = itemsQuery.data?.transferring ?? []
    const checking = itemsQuery.data?.checking ?? []
    const transferred = itemsQuery.data?.transferred ?? []

    const inProgressCount = transferring.length + checking.length
    const hasTransfers = transferring.length > 0 || checking.length > 0 || transferred.length > 0

    const toggleExpanded = useCallback(() => {
        setIsExpanded((prev) => !prev)
    }, [])

    const handleOpenTransfers = useCallback(async () => {
        await openWindow({ name: 'Transfers', url: '/transfers' })
    }, [])

    return (
        <div className="border-t border-divider bg-content1">
            <div
                className="flex items-center justify-between h-10 px-4 cursor-pointer select-none hover:bg-content2"
                onClick={toggleExpanded}
            >
                <div className="flex items-center gap-3">
                    <span className="text-sm font-medium">Transfers</span>
                    {inProgressCount > 0 && (
                        <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-primary-100 text-primary-700">
                            {inProgressCount} active
                        </span>
                    )}
                    {!hasTransfers && (
                        <span className="text-sm text-default-400">No active transfers</span>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    <Tooltip content="Open Transfers page" size="sm">
                        <Button
                            isIconOnly={true}
                            size="sm"
                            variant="light"
                            onPress={handleOpenTransfers}
                            onClick={(e) => e.stopPropagation()}
                        >
                            <ExternalLinkIcon className="size-4" />
                        </Button>
                    </Tooltip>
                    <Button
                        isIconOnly={true}
                        size="sm"
                        variant="light"
                        onPress={toggleExpanded}
                        onClick={(e) => e.stopPropagation()}
                    >
                        {isExpanded ? (
                            <ChevronDownIcon className="size-4" />
                        ) : (
                            <ChevronUpIcon className="size-4" />
                        )}
                    </Button>
                </div>
            </div>

            <AnimatePresence>
                {isExpanded && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: '40vh', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden border-t border-divider"
                    >
                        <ScrollShadow className="h-[40vh] p-2">
                            {hasTransfers ? (
                                <div className="space-y-1">
                                    {checking.map((item: any, idx: number) => (
                                        <TransferItem
                                            key={`checking-${item.name}-${idx}`}
                                            item={item}
                                            status="checking"
                                        />
                                    ))}
                                    {transferring.map((item: any, idx: number) => (
                                        <TransferItem
                                            key={`transferring-${item.name}-${idx}`}
                                            item={item}
                                            status="transferring"
                                        />
                                    ))}
                                    {transferred.map((item: any, idx: number) => (
                                        <TransferItem
                                            key={`transferred-${item.name}-${idx}`}
                                            item={item}
                                            status={item.error ? 'error' : 'done'}
                                        />
                                    ))}
                                </div>
                            ) : (
                                <div className="flex items-center justify-center h-full text-sm text-default-400">
                                    No transfers in progress
                                </div>
                            )}
                        </ScrollShadow>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    )
}

function TransferItem({
    item,
    status,
}: {
    item: {
        name?: string
        size?: number
        bytes?: number
        percentage?: number
        speed?: number
        error?: string
    }
    status: 'transferring' | 'checking' | 'done' | 'error'
}) {
    const fileName = item.name?.split('/').pop() || item.name || 'Unknown'

    return (
        <div className="flex items-center gap-3 p-2 rounded-lg hover:bg-content2">
            <div className="shrink-0">
                {status === 'error' ? (
                    <XCircleIcon className="text-danger size-4" />
                ) : status === 'done' ? (
                    <CheckCircle2Icon className="text-success size-4" />
                ) : status === 'checking' ? (
                    <SearchCheckIcon className="text-warning size-4 animate-pulse" />
                ) : (
                    <LoaderIcon className="text-primary size-4 animate-spin" />
                )}
            </div>

            <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-sm truncate" title={item.name}>
                        {fileName}
                    </span>
                    <span className="text-xs shrink-0 text-default-500">
                        {status === 'error'
                            ? 'Failed'
                            : status === 'done'
                              ? formatBytes(item.size || 0)
                              : status === 'checking'
                                ? 'Checking...'
                                : (item.size || 0) > 0
                                  ? `${formatBytes(item.bytes || 0)} / ${formatBytes(item.size || 0)}`
                                  : '—'}
                    </span>
                </div>

                {(status === 'transferring' || status === 'checking') && (
                    <div className="flex items-center gap-2">
                        <Progress
                            value={item.percentage || 0}
                            size="sm"
                            color={status === 'checking' ? 'warning' : 'primary'}
                            className="flex-1"
                            aria-label="Transfer progress"
                            isIndeterminate={status === 'checking'}
                        />
                        {(item.speed || 0) > 0 && (
                            <span className="text-xs shrink-0 text-default-400">
                                {formatBytes(item.speed || 0)}/s
                            </span>
                        )}
                    </div>
                )}

                {status === 'done' && item.name && (
                    <span className="text-xs truncate text-default-400" title={item.name}>
                        {item.name}
                    </span>
                )}

                {status === 'error' && item.error && (
                    <span className="text-xs truncate text-danger" title={item.error}>
                        {item.error}
                    </span>
                )}
            </div>
        </div>
    )
}

function OperationDialog({
    items,
    destination,
    onClose,
    onComplete,
    onJobStarted,
}: {
    items: SelectItem[] | null
    destination: string | null
    onClose: () => void
    onComplete?: () => void
    onJobStarted?: (jobId: number) => void
}) {
    const [operation, setOperation] = useState<'copy' | 'move'>('copy')
    const [overwrite, setOverwrite] = useState(false)

    const copyMutation = useMutation({
        mutationFn: async () => {
            if (!items || !destination) throw new Error('Missing items or destination')

            const sources = items.map((item) => item.path + (item.type === 'folder' ? '/' : ''))

            const jobId = await startCopy({
                sources,
                destination,
                options: {
                    copy: overwrite ? {} : { no_update_modtime: true },
                    config: {},
                    filter: {},
                },
            })
            if (jobId) onJobStarted?.(jobId)
        },
        onSuccess: () => {
            onComplete?.()
            onClose()
        },
        onError: async (error) => {
            await message(error instanceof Error ? error.message : 'Copy operation failed', {
                title: 'Error',
                kind: 'error',
            })
        },
    })

    const moveMutation = useMutation({
        mutationFn: async () => {
            if (!items || !destination) throw new Error('Missing items or destination')

            const sources = items.map((item) => item.path + (item.type === 'folder' ? '/' : ''))

            const jobId = await startMove({
                sources,
                destination,
                options: {
                    move: overwrite ? {} : { no_update_modtime: true },
                    config: {},
                    filter: {},
                },
            })
            if (jobId) onJobStarted?.(jobId)
        },
        onSuccess: () => {
            onComplete?.()
            onClose()
        },
        onError: async (error) => {
            await message(error instanceof Error ? error.message : 'Move operation failed', {
                title: 'Error',
                kind: 'error',
            })
        },
    })

    const handleConfirm = useCallback(() => {
        if (operation === 'copy') {
            copyMutation.mutate()
        } else {
            moveMutation.mutate()
        }
    }, [operation, copyMutation, moveMutation])

    const isLoading = copyMutation.isPending || moveMutation.isPending
    const itemCount = items?.length ?? 0

    const formatPath = (path: string) => {
        if (path.includes(':/')) {
            const [remote, ...rest] = path.split(':/')
            const relativePath = rest.join('/')
            const fileName = relativePath.split('/').pop() || relativePath
            return { remote, fileName, isRemote: true }
        }
        const fileName = path.split('/').pop() || path
        return { remote: 'Local', fileName, isRemote: false }
    }

    const destinationInfo = destination ? formatPath(destination) : null

    return (
        <Modal
            isOpen={!!items && items.length > 0}
            onClose={onClose}
            size="lg"
            hideCloseButton={isLoading}
        >
            <ModalContent>
                <ModalHeader className="flex items-center gap-2">
                    {operation === 'copy' ? (
                        <CopyIcon className="size-5" />
                    ) : (
                        <MoveIcon className="size-5" />
                    )}
                    <span>
                        {operation === 'copy' ? 'Copy' : 'Move'} {itemCount} item
                        {itemCount !== 1 ? 's' : ''}
                    </span>
                </ModalHeader>
                <ModalBody>
                    <div className="space-y-4">
                        <RadioGroup
                            label="Operation"
                            value={operation}
                            onValueChange={(val) => setOperation(val as 'copy' | 'move')}
                            orientation="vertical"
                            isDisabled={isLoading}
                        >
                            <Radio value="copy" description="Keep original files">
                                <div className="flex items-center gap-2">
                                    <CopyIcon className="size-4" />
                                    Copy
                                </div>
                            </Radio>
                            <Radio value="move" description="Delete after transfer">
                                <div className="flex items-center gap-2">
                                    <MoveIcon className="size-4" />
                                    Move
                                </div>
                            </Radio>
                        </RadioGroup>

                        <div className="p-3 rounded-lg bg-default-100">
                            <p className="mb-2 text-sm font-medium text-default-600">
                                Destination:
                            </p>
                            <div className="flex items-center gap-2">
                                <span className="px-2 py-1 text-xs font-medium rounded bg-primary-100 text-primary-700">
                                    {destinationInfo?.remote}
                                </span>
                                <span className="text-sm truncate">
                                    {destinationInfo?.fileName || '/'}
                                </span>
                            </div>
                        </div>

                        {itemCount > 1 && (
                            <div>
                                <p className="mb-2 text-sm font-medium text-default-600">
                                    Items to transfer:
                                </p>
                                <ScrollShadow className="p-2 rounded-lg max-h-40 bg-default-50">
                                    <ul className="space-y-1">
                                        {items?.map((item) => {
                                            const info = formatPath(item.path)
                                            const mockEntry = {
                                                key: item.path,
                                                name: info.fileName,
                                                isDir: item.type === 'folder',
                                                fullPath: item.path,
                                            } as Entry
                                            return (
                                                <li
                                                    key={item.path}
                                                    className="flex items-center gap-2 text-sm"
                                                >
                                                    <FileIcon entry={mockEntry} size="sm" />
                                                    <span className="truncate">
                                                        {info.fileName}
                                                    </span>
                                                    {info.isRemote && (
                                                        <span className="px-1.5 py-0.5 text-xs rounded bg-default-200 text-default-600">
                                                            {info.remote}
                                                        </span>
                                                    )}
                                                </li>
                                            )
                                        })}
                                    </ul>
                                </ScrollShadow>
                            </div>
                        )}

                        <Checkbox
                            isSelected={overwrite}
                            onValueChange={setOverwrite}
                            isDisabled={isLoading}
                            size="sm"
                        >
                            Overwrite existing files
                        </Checkbox>
                    </div>
                </ModalBody>
                <ModalFooter>
                    <Button variant="flat" onPress={onClose} isDisabled={isLoading}>
                        Cancel
                    </Button>
                    <Button color="primary" onPress={handleConfirm} isLoading={isLoading}>
                        {operation === 'copy' ? 'Copy' : 'Move'}
                    </Button>
                </ModalFooter>
            </ModalContent>
        </Modal>
    )
}
