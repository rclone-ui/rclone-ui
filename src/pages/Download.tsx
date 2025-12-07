import { Button, ButtonGroup, Image, Input, Spinner, Tooltip } from '@heroui/react'
import MuxPlayer from '@mux/mux-player-react'
import { useMutation } from '@tanstack/react-query'
import { message } from '@tauri-apps/plugin-dialog'
import { openUrl } from '@tauri-apps/plugin-opener'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertOctagonIcon, ClockIcon, DownloadIcon, FoldersIcon } from 'lucide-react'
import pRetry from 'p-retry'
import { startTransition, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import notify from '../../lib/notify'
import rclone from '../../lib/rclone/client'
import CommandInfoButton from '../components/CommandInfoButton'
import CommandsDropdown from '../components/CommandsDropdown'
import OperationWindowContent from '../components/OperationWindowContent'
import OperationWindowFooter from '../components/OperationWindowFooter'
import { PathField } from '../components/PathFinder'

function isValidUrl(url: string) {
    try {
        new URL(url)
        return true
    } catch {
        return false
    }
}

function isYoutubeUrl(url: string) {
    return url.includes('youtube.com') || url.includes('youtu.be')
}

function getDateFilename() {
    return new Date()
        .toLocaleString(undefined, {
            dateStyle: 'short',
            timeStyle: 'medium',
        })
        .replace(',', ' at')
        .replace(/[\/]/g, '-')
        .replace(/[:]/g, '.')
}

function getUrlDomain(url: string) {
    const hostname = new URL(url).hostname
    return hostname.split('.').slice(0, -1).join('.') || hostname.split('.')[0]
}

export default function Download() {
    const [searchParams] = useSearchParams()

    const [url, setUrl] = useState<string | undefined>(
        () => searchParams.get('initialUrl') || undefined
    )
    const [destination, setDestination] = useState<string | undefined>(
        () => searchParams.get('initialDestination') || undefined
    )
    const [filename, setFilename] = useState<string | undefined>(
        () => searchParams.get('initialFilename') || undefined
    )

    const [downloadData, setDownloadData] = useState<
        | {
              url: string
              title: string
              extension: string
              type: 'video' | 'audio' | 'file' | 'image'
          }
        | undefined
    >()
    const [isFetchingDownloadData, setIsFetchingDownloadData] = useState(false)

    const startDownloadMutation = useMutation({
        mutationFn: async () => {
            if (!url) {
                throw new Error('Please enter a URL')
            }

            if (!destination) {
                throw new Error('Please select a destination path')
            }

            if (!filename) {
                throw new Error('Please enter a filename')
            }

            const downloadUrl = downloadData?.url || url

            await pRetry(
                async () =>
                    rclone('/operations/copyurl', {
                        params: {
                            query: {
                                fs: destination,
                                remote: filename,
                                url: downloadUrl,
                                autoFilename: false,
                                _async: true,
                            },
                        },
                    }),
                { retries: 3 }
            )
        },
        onSuccess: async () => {
            await notify({
                title: 'Success',
                body: 'Download task started',
            })
        },
        onError: async (error) => {
            console.error('[Download] Failed to start download', error)
            await message(error instanceof Error ? error.message : 'Failed to start download', {
                title: 'Download Error',
                kind: 'error',
                okLabel: 'OK',
            })
        },
    })

    const buttonText = useMemo(() => {
        if (startDownloadMutation.isPending) return 'STARTING...'
        if (!url) return 'Please enter a URL'
        if (!isValidUrl(url)) return 'Invalid URL'
        if (!destination) return 'Please select a destination path'
        return 'DOWNLOAD'
    }, [startDownloadMutation.isPending, url, destination])

    const buttonIcon = useMemo(() => {
        if (startDownloadMutation.isPending) return <Spinner size="lg" />
        if (!url) return <AlertOctagonIcon className="w-5 h-5" />
        if (!isValidUrl(url)) return <AlertOctagonIcon className="w-5 h-5" />
        if (!destination) return <FoldersIcon className="w-5 h-5" />
        return <DownloadIcon className="w-5 h-5 fill-current" />
    }, [startDownloadMutation.isPending, url, destination])

    useEffect(() => {
        if (!url || !isValidUrl(url)) {
            startTransition(() => {
                setFilename(undefined)
                setDownloadData(undefined)
                setIsFetchingDownloadData(false)
            })
            return
        }

        console.log('[Download] Fetching download data for URL:', url)

        const abortController = new AbortController()
        startTransition(() => {
            setIsFetchingDownloadData(true)
        })

        let parsedFilename: typeof filename
        let parsedDownloadData: typeof downloadData

        fetch(`https://rcloneui.com/api/download?url=${encodeURIComponent(url)}`, {
            signal: abortController.signal,
        })
            .then(async (response) => {
                if (response.ok) {
                    const result = (await response.json()) as {
                        data?: {
                            url: string
                            title: string
                            extension: string
                            type: 'video' | 'audio' | 'file' | 'image'
                        }[]
                    }

                    if (result.data && Array.isArray(result.data) && result.data.length > 0) {
                        console.log('[Download] Successfully fetched download data')
                        const item = result.data[0]
                        parsedDownloadData = {
                            url: item.url,
                            title: item.title,
                            extension: item.extension,
                            type: item.type,
                        }
                        parsedFilename = `${item.title.substring(0, 42).trim()}.${item.extension || 'txt'}`
                        console.log(parsedDownloadData)
                        console.log(parsedFilename)
                    }
                }

                if (parsedFilename && parsedDownloadData) {
                    console.log('[Download] Setting filename and download data')
                    startTransition(() => {
                        setFilename(parsedFilename)
                        setDownloadData(parsedDownloadData)
                    })
                } else {
                    const extractedExtension = url.split('.').pop()?.split('?')[0]?.toLowerCase()

                    if (extractedExtension) {
                        parsedFilename = url.split('/').pop()?.split('?')[0]
                    } else {
                        parsedFilename = `${getUrlDomain(url)} ${getDateFilename()}.txt`
                    }

                    startTransition(() => {
                        setFilename(parsedFilename)
                        setDownloadData(undefined)
                    })
                }

                startTransition(() => {
                    setIsFetchingDownloadData(false)
                })
            })
            .catch()

        return () => {
            abortController.abort()
        }
    }, [url])

    return (
        <div className="flex flex-col h-screen gap-2">
            {/* Main Content */}
            <OperationWindowContent className="gap-4">
                <Input
                    label="URL"
                    placeholder="Enter a URL"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    fullWidth={true}
                    description="Supports Youtube, TikTok, SoundCloud, Google Drive, etc."
                    size="lg"
                    data-focus-visible="false"
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck="false"
                    endContent={
                        <Button
                            variant="faded"
                            color="primary"
                            onPress={() => {
                                setTimeout(() => {
                                    navigator.clipboard.readText().then((text) => {
                                        setUrl(text)
                                    })
                                }, 10)
                            }}
                        >
                            Paste
                        </Button>
                    }
                />

                {/* Path Display */}
                <PathField
                    path={destination || ''}
                    setPath={setDestination}
                    label="Destination"
                    description="Select the destination folder or manually enter a folder path"
                    placeholder="Enter a remote:/path as destination"
                    showPicker={true}
                    showFiles={false}
                />

                <Input
                    label="Filename"
                    placeholder="Enter a filename"
                    description="Make sure to include an extension"
                    value={filename}
                    onChange={(e) => setFilename(e.target.value)}
                    fullWidth={true}
                    isDisabled={!url || !destination}
                    size="lg"
                    data-focus-visible="false"
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck="false"
                />
            </OperationWindowContent>

            <div className="flex items-center justify-center flex-1 overflow-hidden">
                {isFetchingDownloadData && <Spinner size="lg" />}

                {!isFetchingDownloadData &&
                    downloadData &&
                    downloadData.type === 'video' &&
                    !isYoutubeUrl(url || '') && (
                        <MuxPlayer
                            autoPlay={true}
                            muted={true}
                            // controls={true}
                            src={downloadData.url}
                            className="object-contain w-full h-64 mx-10 overflow-hidden rounded-large"
                        />
                    )}

                {!isFetchingDownloadData && downloadData && downloadData.type === 'image' && (
                    <Image src={downloadData.url} className="object-contain w-full h-64" />
                )}

                {!isFetchingDownloadData && downloadData && downloadData.type === 'audio' && (
                    <audio src={downloadData.url} controls={true}>
                        <track kind="captions" src="" srcLang="en" />
                    </audio>
                )}
            </div>

            <OperationWindowFooter>
                <AnimatePresence mode="wait" initial={false}>
                    {startDownloadMutation.isSuccess ? (
                        <motion.div
                            key="started-buttons"
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            transition={{ duration: 0.2, ease: 'easeOut' }}
                            className="flex flex-1 gap-2"
                        >
                            <Button
                                fullWidth={true}
                                color="primary"
                                size="lg"
                                onPress={() => {
                                    startTransition(() => {
                                        setUrl(undefined)
                                        setDestination(undefined)
                                        setFilename(undefined)
                                        setDownloadData(undefined)
                                        setIsFetchingDownloadData(false)
                                        startDownloadMutation.reset()
                                    })
                                }}
                                data-focus-visible="false"
                            >
                                NEW DOWNLOAD
                            </Button>
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
                                onPress={() => startDownloadMutation.mutate()}
                                size="lg"
                                fullWidth={true}
                                type="button"
                                color="primary"
                                isDisabled={
                                    startDownloadMutation.isPending ||
                                    !destination ||
                                    isFetchingDownloadData
                                }
                                isLoading={startDownloadMutation.isPending}
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
                                        title: 'Schedule Downloads',
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
                        content={`Download a URL's content and copy it to the destination without saving it in temporary storage.

This uses rclone's copyurl command to stream content directly to your destination.

For supported platforms, the app will automatically extract the direct download URL and suggest a filename.

Supported platforms include:
• YouTube
• TikTok
• Instagram
• Threads
• Twitter / X
• Facebook
• Pinterest
• Spotify
• SoundCloud
• Capcut
• Douyin
• Xiaohongshu
• SnackVideo
• Cocofun
• Google Drive
• MediaFire
• Direct file URLs (any URL)

If a platform isn't listed, it may still work — try pasting the URL and see if a preview appears.

Here's a quick guide to using Download:

1. ENTER URL
Paste or type the URL you want to download. You can use the "Paste" button to quickly paste from your clipboard. If the URL is from a supported platform, the app will automatically fetch metadata and show a preview.

2. SELECT DESTINATION
Choose where to save the downloaded file. Tap the folder icon to browse your remotes and local filesystem, or type a path directly.

3. SET FILENAME
The filename is auto-populated based on the URL or video title. You can edit it if needed. Make sure to include the correct file extension (e.g., .mp4, .mp3, .jpg).

4. DOWNLOAD
Tap "DOWNLOAD" to start. The file will be streamed directly to your destination without using local temporary storage.

Note: If a download doesn't work, the site may have restrictions. Try the URL with curl directly to verify it's accessible.`}
                    />
                    <CommandsDropdown currentCommand="download" />
                </ButtonGroup>
            </OperationWindowFooter>
        </div>
    )
}
