import { Button, Divider } from '@heroui/react'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { platform } from '@tauri-apps/plugin-os'
import { exit } from '@tauri-apps/plugin-process'
import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useMemo, useState } from 'react'
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

    const isError = useMemo(
        () => startupStatus === 'error' || startupStatus === 'fatal',
        [startupStatus]
    )

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

    // Close window when it loses focus
    useEffect(() => {
        const currentWindow = getCurrentWindow()
        const unlisten = currentWindow.onFocusChanged(async ({ payload: focused }) => {
            if (!focused) {
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
                                Could not complete the operation, please try again later.
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
                                Use the {platform() === 'macos' ? '⌘' : 'Ctrl'} + Shift + / shortcut
                                to open the Toolbar!
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
                        {startupStatus === 'initializing' && (
                            <motion.p
                                key="initializing"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                className="ml-2 text-3xl"
                            >
                                <span
                                    key={titleIndex}
                                    className="inline-block align-middle animate-fade-in-up"
                                >
                                    {GREET[titleIndex]}
                                </span>{' '}
                                <span className="inline-block align-middle">👋</span>
                            </motion.p>
                        )}
                        {startupStatus === 'updating' && (
                            <motion.p
                                key="updating"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                                className="ml-2 text-3xl"
                            >
                                <span
                                    key={titleIndex}
                                    className="inline-block align-middle animate-fade-in-up"
                                >
                                    {WAIT[titleIndex]}
                                </span>{' '}
                                <span className="inline-block align-middle">👋</span>
                            </motion.p>
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
                        {startupStatus === 'initializing' && (
                            <motion.p
                                key="initializing"
                                initial={{ opacity: 0, scale: 0.95 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.95 }}
                                className="uppercase text-small"
                            >
                                <motion.span
                                    animate={{ opacity: [1, 0.5, 1] }}
                                    transition={{
                                        repeat: Number.POSITIVE_INFINITY,
                                        duration: 4,
                                        ease: 'easeInOut',
                                    }}
                                >
                                    Rclone is initializing
                                </motion.span>
                            </motion.p>
                        )}
                        {startupStatus === 'updating' && (
                            <motion.p
                                key="updating"
                                initial={{ opacity: 0, scale: 0.95 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.95 }}
                                className="uppercase text-small"
                            >
                                <motion.span
                                    animate={{ opacity: [1, 0.5, 1] }}
                                    transition={{
                                        repeat: Number.POSITIVE_INFINITY,
                                        duration: 4,
                                        ease: 'easeInOut',
                                    }}
                                >
                                    Rclone is updating
                                </motion.span>
                            </motion.p>
                        )}
                    </AnimatePresence>
                </div>
            </div>
        </div>
    )
}
