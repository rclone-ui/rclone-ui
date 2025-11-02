import { Button, Image, Input, Spinner } from '@heroui/react'
import MuxPlayer from '@mux/mux-player-react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { message } from '@tauri-apps/plugin-dialog'
import { DownloadIcon, FoldersIcon, XIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { startDownload } from '../../lib/rclone/api'
import CommandInfo from '../components/CommandInfo'
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
    const [url, setUrl] = useState<string | undefined>()
    const [destination, setDestination] = useState<string | undefined>()
    const [filename, setFilename] = useState<string | undefined>()

    const [isStarted, setIsStarted] = useState(false)
    const [isLoading, setIsLoading] = useState(false)

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

    async function handleStartDownload() {
        setIsLoading(true)

        if (!url) {
            await message('Please enter a URL', {
                title: 'Error',
                kind: 'error',
            })
            setIsLoading(false)
            return
        }

        if (!destination) {
            await message('Please select a destination path', {
                title: 'Error',
                kind: 'error',
            })
            setIsLoading(false)
            return
        }

        if (!filename) {
            await message('Please enter a filename', {
                title: 'Error',
                kind: 'error',
            })
            setIsLoading(false)
            return
        }

        const downloadUrl = downloadData?.url || url

        try {
            await startDownload({
                fs: destination,
                remote: filename,
                url: downloadUrl,
            })

            // await _startDownload()

            setIsStarted(true)

            await message('Download job started', {
                title: 'Success',
                okLabel: 'OK',
            })
            setIsLoading(false)
        } catch (error) {
            await message(`Failed to start download job, ${error}`, {
                title: 'Error',
                kind: 'error',
                okLabel: 'OK',
            })
            setIsLoading(false)
        }
    }

    const buttonText = (() => {
        if (isLoading) return 'STARTING...'
        if (!url) return 'Please enter a URL'
        if (!isValidUrl(url)) return 'Invalid URL'
        if (!destination) return 'Please select a destination path'
        return 'DOWNLOAD'
    })()

    const buttonIcon = (() => {
        if (isLoading) return
        if (!url) return <XIcon className="w-5 h-5" />
        if (!isValidUrl(url)) return <XIcon className="w-5 h-5" />
        if (!destination) return <FoldersIcon className="w-5 h-5" />
        return <DownloadIcon className="w-5 h-5 fill-current" />
    })()

    useEffect(() => {
        if (!url || !isValidUrl(url)) {
            setFilename(undefined)
            setDownloadData(undefined)
            setIsFetchingDownloadData(false)
            return
        }

        console.log('[Download] Fetching download data for URL:', url)

        const abortController = new AbortController()
        setIsFetchingDownloadData(true)

        let parsedFilename: typeof filename
        let parsedDownloadData: typeof downloadData

        fetch(`https://rcloneui.com/api/download?url=${encodeURIComponent(url)}`, {
            signal: abortController.signal,
        })
            .then(async (response) => {
                if (response.ok) {
                    const result = await response.json()

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
                    setFilename(parsedFilename)
                    setDownloadData(parsedDownloadData)
                } else {
                    const extractedExtension = url.split('.').pop()?.split('?')[0]?.toLowerCase()

                    if (extractedExtension) {
                        parsedFilename = url.split('/').pop()?.split('?')[0]
                    } else {
                        parsedFilename = `${getUrlDomain(url)} ${getDateFilename()}.txt`
                    }

                    setFilename(parsedFilename)
                    setDownloadData(undefined)
                }

                setIsFetchingDownloadData(false)
            })
            .catch()

        return () => {
            abortController.abort()
        }
    }, [url])

    return (
        <div className="flex flex-col h-screen gap-2">
            <CommandInfo
                content={`Download a URL's content and copy it to the destination without saving it in temporary storage, using the copyurl command.
					
Supports Youtube, TikTok, SoundCloud, Google Drive, etc. as well as regular URLs.

If you can't get Download to work then make sure the site works with curl directly.`}
            />

            <div className="w-full h-5" />

            {/* Main Content */}
            <div className="flex flex-col flex-1 w-full max-w-3xl gap-4 mx-auto">
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
            </div>

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

            <div className="sticky bottom-0 z-50 flex items-center justify-center flex-none gap-2 p-4 border-t border-neutral-500/20 bg-neutral-900/50 backdrop-blur-lg">
                {isStarted ? (
                    <>
                        <Button
                            fullWidth={true}
                            color="primary"
                            size="lg"
                            onPress={() => {
                                setDestination(undefined)
                                setIsStarted(false)
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
                        onPress={handleStartDownload}
                        size="lg"
                        fullWidth={true}
                        type="button"
                        color="primary"
                        isDisabled={isLoading || !destination || isFetchingDownloadData}
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
