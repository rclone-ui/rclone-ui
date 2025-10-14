import { Button, Input } from '@heroui/react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { message } from '@tauri-apps/plugin-dialog'
import { DownloadIcon, FoldersIcon, XIcon } from 'lucide-react'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { startDownload } from '../../lib/rclone/api'
import { PathField } from '../components/PathFinder'

export default function Download() {
    const [searchParams] = useSearchParams()

    const [url, setUrl] = useState<string | undefined>()
    const [source, setSource] = useState<string | undefined>(
        searchParams.get('initialSource') ? searchParams.get('initialSource')! : undefined
    )

    const [isStarted, setIsStarted] = useState(false)
    const [isLoading, setIsLoading] = useState(false)

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

        if (!source) {
            await message('Please select a destination path', {
                title: 'Error',
                kind: 'error',
            })
            setIsLoading(false)
            return
        }

        const [fs, remote] = source.split(':')

        if (!fs || !remote) {
            await message('Invalid destination path', {
                title: 'Error',
                kind: 'error',
            })
            setIsLoading(false)
            return
        }

        try {
            await startDownload({
                fs,
                remote,
                url,
            })

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
        if (!source) return 'Please select a destination path'
        return 'DOWNLOAD'
    })()

    const buttonIcon = (() => {
        if (isLoading) return
        if (!source) return <FoldersIcon className="w-5 h-5" />
        return <DownloadIcon className="w-5 h-5 fill-current" />
    })()

    return (
        <div className="flex flex-col h-screen gap-10 pt-10">
            {/* Main Content */}
            <div className="flex flex-col flex-1 w-full max-w-3xl gap-6 mx-auto">
                <Input
                    label="URL"
                    placeholder="Enter a URL"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    fullWidth={true}
                    size="lg"
                    data-focus-visible="false"
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck="false"
                    endContent={
                        <Button
                            variant="faded"
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
                    path={source || ''}
                    setPath={setSource}
                    label="Destination"
                    placeholder="Enter a remote:/path as destination"
                    showPicker={true}
                    showFiles={false}
                />
            </div>

            <div className="sticky bottom-0 z-50 flex items-center justify-center flex-none gap-2 p-4 border-t border-neutral-500/20 bg-neutral-900/50 backdrop-blur-lg">
                {isStarted ? (
                    <>
                        <Button
                            fullWidth={true}
                            color="primary"
                            size="lg"
                            onPress={() => {
                                setSource(undefined)
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
                        isDisabled={isLoading || !source}
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
