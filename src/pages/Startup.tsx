import { Button, Divider, Progress } from '@heroui/react'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { platform } from '@tauri-apps/plugin-os'
import { exit } from '@tauri-apps/plugin-process'
import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useMemo, useState } from 'react'
import { formatBytes } from '../../lib/format'
import { openSmallWindow } from '../../lib/window'
import { useStore } from '../../store/memory'
import { usePersistedStore } from '../../store/persisted'

const GREET = [
    'Hello',
    'こんにちは',
    'Salut',
    'Cześć',
    'Hej',
    'Bonjour',
    'Olá',
    'Ciao',
    '你好',
    'Hallo',
    'Merhaba',
    'مرحباً',
]

const WAIT = [
    'Just a moment',
    '少々お待ちください',
    'Un moment',
    'Chwileczkę',
    'Ett ögonblick',
    'Juste un instant',
    'Só um momento',
    'Un attimo',
    '请稍等一下',
    'Einen Moment, bitte',
    'Bir saniye lütfen',
    'لحظة من فضلك',
]

export default function Startup() {
    const [titleIndex, setTitleIndex] = useState(0)

    const startupStatus = useStore((state) => state.startupStatus)
    const startupMessage = useStore((state) => state.startupMessage)
    const startupIsDownloading = useStore((state) => state.startupIsDownloading)
    const startupDownloadedBytes = useStore((state) => state.startupDownloadedBytes)
    const startupTotalBytes = useStore((state) => state.startupTotalBytes)
    const startupDownloadSpeed = useStore((state) => state.startupDownloadSpeed)
    const toolbarShortcut = usePersistedStore((state) => state.toolbarShortcut)

    const shortcutDisplay = useMemo(() => {
        const raw = toolbarShortcut ?? 'CmdOrCtrl+Shift+/'
        return raw
            .split('+')
            .map((part) =>
                part === 'CmdOrCtrl'
                    ? platform() === 'macos'
                        ? '⌘'
                        : 'Ctrl'
                    : part === 'Command'
                      ? '⌘'
                      : part
            )
            .join(' + ')
    }, [toolbarShortcut])

    const isError = useMemo(
        () => startupStatus === 'error' || startupStatus === 'fatal',
        [startupStatus]
    )
    const isBusy = useMemo(
        () => startupStatus === 'initializing' || startupStatus === 'updating',
        [startupStatus]
    )
    const downloadProgress = useMemo(() => {
        if (!startupTotalBytes || startupTotalBytes <= 0) {
            return null
        }

        return Math.min((startupDownloadedBytes / startupTotalBytes) * 100, 100)
    }, [startupDownloadedBytes, startupTotalBytes])
    const downloadProgressLabel = useMemo(() => {
        if (!startupIsDownloading) {
            return null
        }

        const downloaded = formatBytes(startupDownloadedBytes)
        const total = startupTotalBytes ? formatBytes(startupTotalBytes) : 'Unknown size'
        const speed = startupDownloadSpeed ? `${formatBytes(startupDownloadSpeed)}/s` : null

        if (speed) {
            return `${downloaded} / ${total} • ${speed}`
        }

        return `${downloaded} / ${total}`
    }, [
        startupDownloadSpeed,
        startupDownloadedBytes,
        startupIsDownloading,
        startupTotalBytes,
    ])

    useEffect(() => {
        let intervalId: NodeJS.Timeout | null = null
        if (startupStatus === 'initializing') {
            intervalId = setInterval(() => {
                setTitleIndex((previousIndex) => (previousIndex + 1) % GREET.length)
            }, 1500)
        } else if (startupStatus === 'updating') {
            intervalId = setInterval(() => {
                setTitleIndex((previousIndex) => (previousIndex + 1) % WAIT.length)
            }, 2000)
        }
        return () => {
            if (intervalId) {
                clearInterval(intervalId)
            }
        }
    }, [startupStatus])

    // Linux can emit focus changes while the startup window is still provisioning rclone.
    useEffect(() => {
        const currentWindow = getCurrentWindow()
        const unlisten = currentWindow.onFocusChanged(async ({ payload: focused }) => {
            if (!focused) {
                const status = useStore.getState().startupStatus
                const busy = status === 'initializing' || status === 'updating'
                if (platform() === 'linux' && busy) {
                    return
                }
                await currentWindow.hide()
                await currentWindow.destroy()
            }
        })

        return () => {
            unlisten.then((fn) => fn())
        }
    }, [])

    return (
        <div className="flex flex-col h-screen rounded-2xl bg-content1">
            <img src="/banner.png" alt="Rclone UI" className="w-full h-auto p-5" />

            <Divider />

            <div className="flex flex-col w-full h-full justify-evenly">
                <div className="flex flex-col items-center w-full gap-8 overflow-visible">
                    <AnimatePresence mode="wait">
                        {isError && (
                            <motion.p
                                key="error"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                className="ml-2 text-2xl"
                            >
                                {startupMessage ||
                                    'Could not complete the operation, please try again later.'}
                            </motion.p>
                        )}
                        {startupStatus === 'initialized' && (
                            <motion.p
                                key="initialized"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                className="ml-2 text-2xl"
                            >
                                Use the {shortcutDisplay} shortcut to open the Toolbar!
                            </motion.p>
                        )}
                        {startupStatus === 'updated' && (
                            <motion.p
                                key="updated"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                className="ml-2 text-2xl"
                            >
                                Rclone has just been updated, thanks for waiting!
                            </motion.p>
                        )}
                        {isBusy && (
                            <motion.div
                                key="busy"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                className="flex flex-col items-center gap-4 px-8"
                            >
                                <p className="ml-2 text-3xl">
                                    <span
                                        key={titleIndex}
                                        className="inline-block align-middle animate-fade-in-up"
                                    >
                                        {startupStatus === 'updating'
                                            ? WAIT[titleIndex % WAIT.length]
                                            : GREET[titleIndex % GREET.length]}
                                    </span>{' '}
                                    <span className="inline-block align-middle">👋</span>
                                </p>

                                {startupIsDownloading && (
                                    <div className="w-full max-w-md space-y-2">
                                        <Progress
                                            value={downloadProgress ?? undefined}
                                            isIndeterminate={downloadProgress === null}
                                            aria-label="Rclone download progress"
                                            className="w-full"
                                        />
                                        <p className="text-sm text-center text-default-500">
                                            {downloadProgressLabel}
                                        </p>
                                    </div>
                                )}
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
                <div className="flex flex-col items-center w-full bg-red-500/0">
                    <AnimatePresence mode="wait">
                        {(startupStatus === 'initialized' || startupStatus === 'updated') && (
                            <motion.div
                                key="start-button"
                                className="w-full max-w-md"
                                initial={{ opacity: 0, scale: 0.95 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.95 }}
                            >
                                <Button
                                    className="w-full py-8 text-large"
                                    variant="shadow"
                                    color="primary"
                                    size="lg"
                                    onPress={async () => {
                                        const currentWindow = getCurrentWindow()

                                        await currentWindow.hide()

                                        if (
                                            usePersistedStore
                                                .getState()
                                                .acknowledgements.includes('onboarding')
                                        ) {
                                            await invoke('show_toolbar')
                                        } else {
                                            usePersistedStore.setState((prev) => ({
                                                acknowledgements: [
                                                    ...prev.acknowledgements,
                                                    'onboarding',
                                                ],
                                            }))
                                            await openSmallWindow({
                                                name: 'Onboarding',
                                                url: '/onboarding',
                                            })
                                        }

                                        await new Promise((resolve) => setTimeout(resolve, 690))

                                        await currentWindow.destroy()
                                    }}
                                >
                                    TAP TO START
                                </Button>
                            </motion.div>
                        )}
                        {isError && (
                            <motion.div
                                key="error-button"
                                className="w-full max-w-md"
                                initial={{ opacity: 0, scale: 0.95 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.95 }}
                            >
                                <Button
                                    className="w-full py-8 text-large"
                                    variant="shadow"
                                    color="primary"
                                    size="lg"
                                    onPress={async () => {
                                        if (startupStatus === 'error') {
                                            await getCurrentWindow().hide()
                                            await getCurrentWindow().destroy()
                                        } else {
                                            await exit(0)
                                        }
                                    }}
                                >
                                    {startupStatus === 'error' ? 'OK' : 'QUIT'}
                                </Button>
                            </motion.div>
                        )}
                        {isBusy && (
                            <motion.div
                                key="busy"
                                initial={{ opacity: 0, scale: 0.95 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.95 }}
                                className="flex flex-col items-center w-full gap-4 px-8 text-center uppercase text-small"
                            >
                                <motion.span
                                    animate={{ opacity: [1, 0.5, 1] }}
                                    transition={{
                                        repeat: Number.POSITIVE_INFINITY,
                                        duration: 4,
                                        ease: 'easeInOut',
                                    }}
                                >
                                    {startupMessage ||
                                        (startupStatus === 'updating'
                                            ? 'Rclone is updating'
                                            : 'Rclone is initializing')}
                                </motion.span>
                                {startupIsDownloading && (
                                    <Button
                                        variant="flat"
                                        color="default"
                                        onPress={async () => {
                                            await exit(0)
                                        }}
                                    >
                                        Quit for now
                                    </Button>
                                )}
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </div>
        </div>
    )
}
