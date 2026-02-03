import {
    Button,
    Divider,
    Drawer,
    DrawerBody,
    DrawerContent,
    DrawerHeader,
    Spinner,
} from '@heroui/react'
import { DownloadIcon, FileIcon as FileIconLucide, XIcon } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { formatBytes } from '../../../lib/format.ts'
import { usePersistedStore } from '../../../store/persisted.ts'
import FileIcon, { getFileType, isPreviewable } from './FileIcon'
import type { Entry } from './types'

const TRAILING_SLASH_RE = /\/$/
const MAX_PREVIEW_SIZE = 500_000_000

function buildPreviewUrl(entry: Entry, hostUrl: string, auth?: string): string {
    const normalizedHost = hostUrl.replace(TRAILING_SLASH_RE, '')

    if (entry.remote === 'UI_LOCAL_FS') {
        return `${normalizedHost}/[local]/${entry.fullPath}`
    }

    const pathPart = entry.fullPath.includes(':/')
        ? entry.fullPath.split(':/').slice(1).join('/')
        : entry.fullPath

    const url = `${normalizedHost}/[${entry.remote}:]/${pathPart}`

    if (auth) {
        return `${url}?auth=${encodeURIComponent(auth)}`
    }

    return url
}

export default function PreviewDrawer({
    item,
    onClose,
}: {
    item: Entry | null
    onClose: () => void
}) {
    const currentHost = usePersistedStore((state) => state.currentHost)
    const hostUrl = currentHost?.url
    const authUser = currentHost?.authUser
    const authPassword = currentHost?.authPassword

    const [textContent, setTextContent] = useState<string | null>(null)
    const [isLoadingText, setIsLoadingText] = useState(false)
    const [textError, setTextError] = useState<string | null>(null)

    const auth = useMemo(() => {
        if (authUser) {
            return btoa(`${authUser}:${authPassword ?? ''}`)
        }
        return undefined
    }, [authUser, authPassword])

    const fileType = item ? getFileType(item) : 'unknown'
    const canPreview = item ? isPreviewable(item) : false

    const isTooLarge =
        item?.size !== undefined && MAX_PREVIEW_SIZE > 0 && item.size > MAX_PREVIEW_SIZE

    const previewUrl = useMemo(() => {
        if (!item || !hostUrl) return null
        return buildPreviewUrl(item, hostUrl, auth)
    }, [item, hostUrl, auth])

    useEffect(() => {
        if (!item || fileType !== 'text' || !previewUrl || isTooLarge) {
            setTextContent(null)
            setTextError(null)
            return
        }

        setIsLoadingText(true)
        setTextError(null)

        fetch(previewUrl, {
            headers: auth ? { Authorization: `Basic ${auth}` } : undefined,
        })
            .then((res) => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`)
                return res.text()
            })
            .then((text) => {
                setTextContent(text)
                setIsLoadingText(false)
            })
            .catch((err: Error) => {
                setTextError(err.message)
                setIsLoadingText(false)
            })
    }, [item, fileType, previewUrl, auth, isTooLarge])

    const handleDownload = useCallback(() => {
        if (!previewUrl) return
        window.open(previewUrl, '_blank')
    }, [previewUrl])

    const renderPreview = () => {
        if (!item || !previewUrl) {
            return (
                <div className="flex flex-col items-center justify-center h-full gap-4 text-default-500">
                    <FileIconLucide className="size-16" />
                    <p>Select a file to preview</p>
                </div>
            )
        }

        if (isTooLarge) {
            return (
                <div className="flex flex-col items-center justify-center h-full gap-4 text-default-500">
                    <FileIcon entry={item} size="lg" />
                    <p>File is too large for preview</p>
                    <p className="text-sm">
                        {formatBytes(item.size ?? 0)} (max: {formatBytes(MAX_PREVIEW_SIZE)})
                    </p>
                    <Button
                        color="primary"
                        onPress={handleDownload}
                        startContent={<DownloadIcon className="size-4" />}
                    >
                        Download
                    </Button>
                </div>
            )
        }

        if (!canPreview) {
            return (
                <div className="flex flex-col items-center justify-center h-full gap-4 text-default-500">
                    <FileIcon entry={item} size="lg" />
                    <p>Preview not available for this file type</p>
                    <Button
                        color="primary"
                        onPress={handleDownload}
                        startContent={<DownloadIcon className="size-4" />}
                    >
                        Download
                    </Button>
                </div>
            )
        }

        switch (fileType) {
            case 'image':
                return (
                    <div className="flex items-center justify-center w-full h-full p-4">
                        <img
                            src={previewUrl}
                            alt={item.name}
                            className="object-contain max-w-full max-h-full rounded-lg"
                        />
                    </div>
                )

            case 'video':
                return (
                    <div className="flex items-center justify-center w-full h-full p-4">
                        {/* biome-ignore lint/a11y/useMediaCaption: <explanation> */}
                        <video
                            src={previewUrl}
                            controls={true}
                            className="max-w-full max-h-full rounded-lg"
                            autoPlay={false}
                        >
                            Your browser does not support the video tag.
                        </video>
                    </div>
                )

            case 'audio':
                return (
                    <div className="flex flex-col items-center justify-center w-full h-full gap-4 p-4">
                        <FileIcon entry={item} size="lg" />
                        <p className="text-lg font-medium">{item.name}</p>
                        {/* biome-ignore lint/a11y/useMediaCaption: <explanation> */}
                        <audio src={previewUrl} controls={true} className="w-full max-w-md">
                            Your browser does not support the audio tag.
                        </audio>
                    </div>
                )

            case 'text': {
                if (isLoadingText) {
                    return (
                        <div className="flex items-center justify-center w-full h-full">
                            <Spinner size="lg" />
                        </div>
                    )
                }
                if (textError) {
                    return (
                        <div className="flex flex-col items-center justify-center h-full gap-4 text-danger">
                            <p>Error loading file: {textError}</p>
                        </div>
                    )
                }
                return (
                    <div className="w-full h-full p-4 overflow-auto">
                        <pre className="p-4 font-mono text-sm break-words whitespace-pre-wrap rounded-lg bg-default-100">
                            {textContent}
                        </pre>
                    </div>
                )
            }

            case 'document':
                return (
                    <div className="flex flex-col items-center w-full h-full p-4 overflow-auto">
                        {/* PDF preview disabled - uncomment when react-pdf is configured */}
                    </div>
                )

            default:
                return (
                    <div className="flex flex-col items-center justify-center h-full gap-4 text-default-500">
                        <FileIcon entry={item} size="lg" />
                        <p>Preview not available</p>
                        <Button
                            color="primary"
                            onPress={handleDownload}
                            startContent={<DownloadIcon className="size-4" />}
                        >
                            Download
                        </Button>
                    </div>
                )
        }
    }

    return (
        <Drawer
            isOpen={!!item}
            placement="right"
            size="md"
            onClose={onClose}
            hideCloseButton={true}
        >
            <DrawerContent>
                <DrawerHeader className="flex items-center justify-between mt-4">
                    <div className="flex items-center gap-2 overflow-hidden">
                        {item && <FileIcon entry={item} size="md" />}
                        <span className="font-medium truncate">{item?.name ?? 'Preview'}</span>
                    </div>
                    <Button isIconOnly={true} size="sm" variant="light" onPress={onClose}>
                        <XIcon className="size-5" />
                    </Button>
                </DrawerHeader>
                <Divider />
                <DrawerBody className="p-0">
                    <div className="flex flex-col h-full">
                        <div className="flex-1 overflow-hidden">{renderPreview()}</div>

                        {item && (
                            <>
                                <Divider />
                                <div className="p-4 space-y-2 text-sm shrink-0 bg-default-50">
                                    <div className="flex justify-between">
                                        <span className="text-default-500">Type:</span>
                                        <span className="capitalize">{fileType}</span>
                                    </div>
                                    {item.size !== undefined && (
                                        <div className="flex justify-between">
                                            <span className="text-default-500">Size:</span>
                                            <span>{formatBytes(item.size)}</span>
                                        </div>
                                    )}
                                    {item.modTime && (
                                        <div className="flex justify-between">
                                            <span className="text-default-500">Modified:</span>
                                            <span>{item.modTime}</span>
                                        </div>
                                    )}
                                    <div className="flex justify-between">
                                        <span className="text-default-500">Location:</span>
                                        <span
                                            className="text-right truncate max-w-[200px]"
                                            title={item.fullPath}
                                        >
                                            {item.remote === 'UI_LOCAL_FS' ? 'Local' : item.remote}
                                        </span>
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                </DrawerBody>
            </DrawerContent>
        </Drawer>
    )
}
