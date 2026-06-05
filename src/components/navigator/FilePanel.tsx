import { Button, Divider, Tooltip } from '@heroui/react'
import { useQuery } from '@tanstack/react-query'
import { FolderPlusIcon } from 'lucide-react'
import {
    forwardRef,
    startTransition,
    useCallback,
    useEffect,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
} from 'react'
import { supportsPublicLink } from '../../../lib/rclone/constants'
import rclone from '../../../lib/rclone/client'
import { useHostStore } from '../../../store/host.ts'
import FileList from './FileList'
import PanelToolbar, { type ToolbarButtons } from './PanelToolbar'
import PathBreadcrumb from './PathBreadcrumb'
import PreviewDrawer from './PreviewDrawer'
import RemoteSidebar from './RemoteSidebar'
import type { AllowedKey, ContextMenuItem, Entry, FilePanelHandle, SelectItem } from './types'
import useCreateFolder from './useCreateFolder'
import useFileNavigation from './useFileNavigation'
import { RE_LEADING_SLASH, dragStateRef, dropTargetsRef, serializeRemotePath } from './utils'

export type { FilePanelHandle } from './types'

const FilePanel = forwardRef<
    FilePanelHandle,
    {
        sidebarPosition?: 'left' | 'right' | 'none'
        initialRemote?: string | 'UI_LOCAL_FS'
        initialPath?: string
        selectionMode?: 'checkbox' | 'drag' | 'both'
        allowFiles?: boolean
        allowMultiple?: boolean
        onSelectionChange?: (selected: SelectItem[]) => void
        onNavigate?: (remote: string, path: string) => void
        onDragStart?: (items: SelectItem[]) => void
        onDrop?: (items: SelectItem[], destination: string) => void
        showPreviewColumn?: boolean
        onPreviewRequest?: (item: Entry) => void
        onDownload?: (item: Entry) => void
        onShare?: (item: Entry) => void
        onRename?: (item: Entry) => void
        onDelete?: (item: Entry) => void
        contextMenuItems?: ContextMenuItem[]
        allowedKeys?: AllowedKey[]
        renderToolbar?: (buttons: ToolbarButtons) => React.ReactNode[][]
        toolbarVisible?: boolean
        isActive?: boolean
    }
>(function FilePanel(
    {
        sidebarPosition = 'left',
        initialRemote,
        initialPath,
        selectionMode = 'checkbox',
        allowFiles = true,
        allowMultiple = true,
        onSelectionChange,
        onNavigate,
        onDragStart,
        onDrop,
        showPreviewColumn = true,
        onPreviewRequest,
        onDownload,
        onShare,
        onRename,
        onDelete,
        contextMenuItems,
        allowedKeys = ['REMOTES', 'LOCAL_FS'],
        renderToolbar,
        toolbarVisible = true,
        isActive = true,
    },
    ref
) {
    const favoritePaths = useHostStore((state) => state.favoritePaths)
    const [previewItem, setPreviewItem] = useState<Entry | null>(null)

    const nav = useFileNavigation({
        initialRemote,
        initialPath,
        allowedKeys,
        allowFiles,
        allowMultiple,
        isActive,
    })

    const remoteConfigQuery = useQuery({
        queryKey: ['remote', nav.selectedRemote, 'config'],
        queryFn: async () => {
            return await rclone('/config/get', {
                params: { query: { name: nav.selectedRemote! } },
            })
        },
        enabled: nav.isRemote,
    })

    const canShare = supportsPublicLink(remoteConfigQuery.data?.type)

    const { canCreateFolder, createFolder } = useCreateFolder(
        nav.selectedRemote,
        nav.cwd,
        nav.refresh
    )

    const newFolderButton = useMemo(
        () =>
            canCreateFolder ? (
                <Tooltip
                    key="new-folder-tooltip"
                    content="Create a new folder in this directory"
                    size="lg"
                    color="foreground"
                >
                    <Button
                        color="primary"
                        size="sm"
                        radius="full"
                        startContent={<FolderPlusIcon className="size-4" />}
                        className="gap-1 min-w-fit"
                        onPress={createFolder}
                    >
                        NEW
                    </Button>
                </Tooltip>
            ) : null,
        [canCreateFolder, createFolder]
    )

    const listRef = useRef<HTMLDivElement>(null)
    const panelRef = useRef<HTMLDivElement>(null)
    const panelIdRef = useRef(`panel-${Math.random().toString(36).slice(2)}`)
    const [listHeight, setListHeight] = useState(400)

    useEffect(() => {
        if (!isActive || !listRef.current) return

        const measureInitial = () => {
            if (listRef.current) {
                const height = listRef.current.getBoundingClientRect().height
                if (height > 0) {
                    startTransition(() => setListHeight(height))
                }
            }
        }
        measureInitial()
        const timeoutId = setTimeout(measureInitial, 100)

        const obs = new ResizeObserver((entries) => {
            for (const entry of entries) {
                startTransition(() => setListHeight(entry.contentRect.height))
            }
        })
        obs.observe(listRef.current)

        return () => {
            clearTimeout(timeoutId)
            obs.disconnect()
        }
    }, [isActive])

    useEffect(() => {
        if (!onDrop || !panelRef.current) return
        const panelId = panelIdRef.current
        const getDestination = () =>
            nav.selectedRemote === 'UI_LOCAL_FS'
                ? nav.cwd
                : serializeRemotePath(nav.selectedRemote as string, nav.cwd)

        dropTargetsRef.current.set(panelId, {
            element: panelRef.current,
            onDrop,
            getDestination,
        })
        return () => {
            dropTargetsRef.current.delete(panelId)
        }
    }, [onDrop, nav.selectedRemote, nav.cwd])

    // biome-ignore lint/correctness/useExhaustiveDependencies: <>
    useEffect(() => {
        if (onSelectionChange) {
            onSelectionChange(nav.getSelection())
        }
    }, [nav.selectedPaths, onSelectionChange, nav.getSelection])

    useEffect(() => {
        if (onNavigate && nav.selectedRemote) {
            onNavigate(nav.selectedRemote, nav.cwd)
        }
    }, [nav.selectedRemote, nav.cwd, onNavigate])

    useImperativeHandle(
        ref,
        () => ({
            refresh: nav.refresh,
            getSelection: nav.getSelection,
            clearSelection: nav.clearSelection,
            selectAll: nav.selectAll,
            navigate: (remote: string, path: string) => {
                nav.setSelectedRemote(remote as any)
                nav.setCwd(path)
            },
            getCurrentPath: () => ({
                remote: nav.selectedRemote,
                path: nav.cwd,
            }),
        }),
        [nav]
    )

    const handleToggleFavorite = useCallback(
        (entry: Entry, isFavorited: boolean) => {
            if (isFavorited) {
                useHostStore.setState({
                    favoritePaths: (favoritePaths || []).filter((it) => {
                        const remote = (it as any).remote as string | undefined
                        const rawPath = (it as any).path as string
                        let fullKey = rawPath
                        if (rawPath?.includes(':/')) {
                            fullKey = rawPath
                        } else if (remote && remote !== 'UI_LOCAL_FS') {
                            const rel = (rawPath || '').replace(RE_LEADING_SLASH, '')
                            fullKey = serializeRemotePath(remote, rel)
                        } else {
                            fullKey = rawPath
                        }
                        return fullKey !== entry.fullPath
                    }),
                })
            } else {
                const storedPath = entry.fullPath.includes(':/')
                    ? entry.fullPath.split(':/').slice(1).join('/')
                    : entry.fullPath
                useHostStore.setState({
                    favoritePaths: [
                        ...(favoritePaths || []),
                        {
                            remote: entry.remote!,
                            path: storedPath,
                            added: Date.now(),
                        },
                    ],
                })
            }
        },
        [favoritePaths]
    )

    const handleDragStartInternal = useCallback(
        (items: Entry[]) => {
            if (onDragStart) {
                onDragStart(
                    items.map((e) => ({ path: e.fullPath, type: e.isDir ? 'folder' : 'file' }))
                )
            }
        },
        [onDragStart]
    )

    const handleDrop = useCallback(
        (event: React.DragEvent) => {
            if (!onDrop) return
            event.preventDefault()

            let items: SelectItem[] | null = null

            const data = event.dataTransfer.getData('application/json')
            if (data) {
                try {
                    const paths = JSON.parse(data) as string[]
                    items = paths.map((p) => ({
                        path: p,
                        type: p.endsWith('/') ? 'folder' : 'file',
                    }))
                } catch {
                    // Invalid JSON data
                }
            }

            if (!items && dragStateRef.current) {
                items = dragStateRef.current
            }

            if (!items || items.length === 0) return

            const destination =
                nav.selectedRemote === 'UI_LOCAL_FS'
                    ? nav.cwd
                    : serializeRemotePath(nav.selectedRemote as string, nav.cwd)
            onDrop(items, destination)
            dragStateRef.current = null
        },
        [onDrop, nav.selectedRemote, nav.cwd]
    )

    const handleDragOver = useCallback(
        (event: React.DragEvent) => {
            if (onDrop) {
                event.preventDefault()
                event.dataTransfer.dropEffect = 'copy'
            }
        },
        [onDrop]
    )

    const handlePreviewClick = useCallback(
        (entry: Entry) => {
            if (entry.isDir) return
            if (onPreviewRequest) {
                onPreviewRequest(entry)
            } else {
                setPreviewItem(entry)
            }
        },
        [onPreviewRequest]
    )

    const showSidebar = sidebarPosition !== 'none'

    return (
        <div
            ref={panelRef}
            className="flex flex-row w-full h-full"
            onDrop={handleDrop}
            onDragOver={handleDragOver}
        >
            {showSidebar && sidebarPosition === 'left' && (
                <>
                    <RemoteSidebar
                        position="left"
                        selectedRemote={nav.selectedRemote}
                        cwd={nav.cwd}
                        onRemoteSelect={nav.selectRemote}
                        allowedKeys={allowedKeys}
                        remotes={nav.remotes}
                    />
                    <Divider orientation="vertical" />
                </>
            )}

            <div className="flex flex-col w-full h-full overflow-y-hidden ">
                <PathBreadcrumb
                    remote={nav.selectedRemote}
                    path={nav.cwd}
                    pathInput={nav.pathInput}
                    onNavigate={nav.navigateTo}
                    onPathInputChange={nav.setPathInput}
                    isReadOnly={nav.selectedRemote === 'UI_FAVORITES'}
                />
                <Divider />

                <div className="relative flex flex-col w-full h-full overflow-hidden">
                    <div
                        className={`sticky top-0 z-10 grid ${showPreviewColumn ? 'grid-cols-[2.5rem_1fr_6rem_9rem_11rem]' : 'grid-cols-[2.5rem_1fr_6rem_9rem_2.5rem]'} items-center py-2 bg-default-100`}
                    >
                        <div />
                        <div className="pl-2 font-semibold text-small">Name</div>
                        <div className="font-semibold text-small">Size</div>
                        <div className="font-semibold text-small">Last Modified</div>
                        <div />
                    </div>

                    <div ref={listRef} className="relative flex-1 w-full overflow-hidden">
                        <FileList
                            items={nav.virtualizedItems}
                            isLoading={nav.isLoading}
                            error={nav.error}
                            selectedKeys={nav.selectedPaths}
                            onToggleSelect={nav.handleToggleSelect}
                            onNavigate={nav.handleNavigate}
                            selectionMode={selectionMode}
                            allowMultiple={allowMultiple}
                            showPreviewColumn={showPreviewColumn}
                            onPreviewClick={handlePreviewClick}
                            onDownload={onDownload}
                            onShare={canShare ? onShare : undefined}
                            onRename={onRename}
                            onDelete={onDelete}
                            draggable={selectionMode === 'drag' || selectionMode === 'both'}
                            onDragStart={handleDragStartInternal}
                            // handled at the Browser level
                            onContextMenu={contextMenuItems ? () => {} : undefined}
                            favoritedKeys={nav.favoritedKeys}
                            onToggleFavorite={handleToggleFavorite}
                            listHeight={listHeight}
                        />
                    </div>

                    <PanelToolbar
                        onBack={nav.navigateUp}
                        onRefresh={nav.refresh}
                        isBackDisabled={nav.isUpDisabled}
                        isLoading={nav.isLoading}
                        searchTerm={nav.searchTerm}
                        onSearchChange={nav.setSearchTerm}
                        renderToolbar={renderToolbar}
                        visible={toolbarVisible && nav.selectedRemote !== 'UI_FAVORITES'}
                        newFolderButton={newFolderButton}
                    />
                </div>
            </div>

            {showSidebar && sidebarPosition === 'right' && (
                <>
                    <Divider orientation="vertical" />
                    <RemoteSidebar
                        position="right"
                        selectedRemote={nav.selectedRemote}
                        cwd={nav.cwd}
                        onRemoteSelect={nav.selectRemote}
                        allowedKeys={allowedKeys}
                        remotes={nav.remotes}
                    />
                </>
            )}

            {!onPreviewRequest && (
                <PreviewDrawer item={previewItem} onClose={() => setPreviewItem(null)} />
            )}
        </div>
    )
})

export default FilePanel
