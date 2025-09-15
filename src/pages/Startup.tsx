import { Button, Divider } from '@heroui/react'

import { useEffect, useState } from 'react'
import { useStore } from '../../lib/store'

const GREETINGS = [
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

export default function Startup() {
    const [greetingIndex, setGreetingIndex] = useState(0)

    const startupStatus = useStore((state) => state.startupStatus)

    const isInitialized = startupStatus === 'initialized'

    useEffect(() => {
        const intervalId = setInterval(() => {
            setGreetingIndex((previousIndex) => (previousIndex + 1) % GREETINGS.length)
        }, 2500)
        return () => clearInterval(intervalId)
    }, [])

    return (
        <div className="flex flex-col h-screen rounded-lg">
            <img src="/banner.png" alt="Rclone UI" className="w-full h-auto p-5" />

            <Divider />

            <div className="flex flex-col w-full h-full justify-evenly">
                <div className="flex flex-col items-center w-full gap-8 overflow-visible">
                    {isInitialized && (
                        <p className="ml-2 text-2xl">
                            Rclone has initialized, you can find it in the tray menu!
                        </p>
                    )}
                    {!isInitialized && (
                        <p className="ml-2 text-3xl">
                            <span
                                key={greetingIndex}
                                className="inline-block align-middle animate-fade-in-up"
                            >
                                {GREETINGS[greetingIndex]}
                            </span>{' '}
                            <span className="inline-block align-middle">👋</span>
                        </p>
                    )}
                </div>
                <div className="flex flex-col items-center w-full bg-red-500/0">
                    {isInitialized ? (
                        <Button
                            className="w-full max-w-md py-8 text-large"
                            variant="shadow"
                            color="primary"
                            size="lg"
                            onPress={() => {}}
                        >
                            START
                        </Button>
                    ) : (
                        <p className="uppercase text-small animate-pulse">Rclone is initalizing</p>
                    )}
                </div>
            </div>
        </div>
    )
}
