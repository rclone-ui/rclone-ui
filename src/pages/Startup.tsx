import { Button, Divider } from '@heroui/react'

import { getCurrentWindow } from '@tauri-apps/api/window'
import { exit } from '@tauri-apps/plugin-process'
import { useEffect, useState } from 'react'
import { useStore } from '../../lib/store'

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

    const isError = startupStatus === 'error' || startupStatus === 'fatal'

    useEffect(() => {
        let intervalId: NodeJS.Timeout | null = null
        if (startupStatus === 'initializing') {
            intervalId = setInterval(() => {
                setTitleIndex((previousIndex) => (previousIndex + 1) % GREET.length)
            }, 2500)
        } else if (startupStatus === 'updating') {
            intervalId = setInterval(() => {
                setTitleIndex((previousIndex) => (previousIndex + 1) % WAIT.length)
            }, 2500)
        }
        return () => {
            if (intervalId) {
                clearInterval(intervalId)
            }
        }
    }, [startupStatus])

    return (
        <div className="flex flex-col h-screen rounded-lg">
            <img src="/banner.png" alt="Rclone UI" className="w-full h-auto p-5" />

            <Divider />

            <div className="flex flex-col w-full h-full justify-evenly">
                <div className="flex flex-col items-center w-full gap-8 overflow-visible">
                    {isError && (
                        <p className="ml-2 text-2xl">
                            Could not complete the operation, please try again later.
                        </p>
                    )}
                    {startupStatus === 'initialized' && (
                        <p className="ml-2 text-2xl">
                            Rclone has initialized, you can find it in the tray menu!
                        </p>
                    )}
                    {startupStatus === 'updated' && (
                        <p className="ml-2 text-2xl">
                            Rclone has updated, you can find it in the tray menu!
                        </p>
                    )}
                    {startupStatus === 'initializing' && (
                        <p className="ml-2 text-3xl">
                            <span
                                key={titleIndex}
                                className="inline-block align-middle animate-fade-in-up"
                            >
                                {GREET[titleIndex]}
                            </span>{' '}
                            <span className="inline-block align-middle">👋</span>
                        </p>
                    )}
                    {startupStatus === 'updating' && (
                        <p className="ml-2 text-3xl">
                            <span
                                key={titleIndex}
                                className="inline-block align-middle animate-fade-in-up"
                            >
                                {WAIT[titleIndex]}
                            </span>{' '}
                            <span className="inline-block align-middle">👋</span>
                        </p>
                    )}
                </div>
                <div className="flex flex-col items-center w-full bg-red-500/0">
                    {(startupStatus === 'initialized' || startupStatus === 'updated') && (
                        <Button
                            className="w-full max-w-md py-8 text-large"
                            variant="shadow"
                            color="primary"
                            size="lg"
                            onPress={async () => {
                                await getCurrentWindow().hide()
                                await getCurrentWindow().destroy()
                            }}
                        >
                            START
                        </Button>
                    )}
                    {isError && (
                        <Button
                            className="w-full max-w-md py-8 text-large"
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
                    )}
                    {startupStatus === 'initializing' && (
                        <p className="uppercase text-small animate-pulse">Rclone is initalizing</p>
                    )}
                    {startupStatus === 'updating' && (
                        <p className="uppercase text-small animate-pulse">Rclone is updating</p>
                    )}
                </div>
            </div>
        </div>
    )
}
