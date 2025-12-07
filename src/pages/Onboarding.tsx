import { Button } from '@heroui/react'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { openUrl } from '@tauri-apps/plugin-opener'
import { platform } from '@tauri-apps/plugin-os'
import confetti from 'canvas-confetti'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronRightIcon } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'

const SLIDES = [
    {
        title: 'Welcome to Rclone UI',
        description:
            'All the power of rclone — combined with a battle-tested interface that gets out of your way, and right back in when needed.',
        image: '/banner.png',
    },
    {
        title: 'Schedule Tasks',
        description:
            'Set it and forget it! Schedule any task to run automatically whenever you want. Perfect for hands-free backups, regular syncs & everything in between.',
        image: '/onboarding/schedules.png',
        className: 'px-10',
    },
    {
        title: 'Templates',
        description:
            'Use templates to store reusable flags that you often need. Quickly create templates by pasting your existing CLI commands.',
        image: '/onboarding/templates.png',
        link: {
            label: 'Browse gallery',
            url: 'https://rcloneui.com/templates/',
        },
        className: 'w-80',
    },
    {
        title: 'Remote Control',
        description:
            'Control rclone instances on other machines straight from your current device. No vendor lock, custom docker setups, or shoddy solutions.',
        image: '/onboarding/remote.png',
    },
    {
        title: 'Private & Open Source',
        description:
            'RCUI is 100% private and open source. No tracking, no ads, no nonsense. You can rest assured that your data never leaves your device.',
        image: '/onboarding/github.png',
        className: 'w-full pt-24',
    },
    {
        title: 'Coming to phones & tablets near you!',
        description:
            'Rclone UI Mobile is right around the corner. The launch is scheduled at 2,000 stars on GitHub. We guarantee it will be worth it!',
        image: '/onboarding/mobile.png',
        link: {
            label: 'Give it a ⭐️',
            url: 'https://github.com/rclone-ui/rclone-ui',
        },
        className: 'pt-48 w-96',
    },
] as const

export default function Onboarding() {
    const [currentSlide, setCurrentSlide] = useState(0)
    const [direction, setDirection] = useState(1) // 1 for forward, -1 for backward
    const [isFinishing, setIsFinishing] = useState(false)

    const slide = useMemo(() => SLIDES[currentSlide], [currentSlide])
    const isFirstSlide = useMemo(() => currentSlide === 0, [currentSlide])
    const isLastSlide = useMemo(() => currentSlide === SLIDES.length - 1, [currentSlide])

    const handleFinish = useCallback(async () => {
        const currentWindow = getCurrentWindow()

        if (platform() === 'windows') {
            await currentWindow.hide()
            await new Promise((resolve) => setTimeout(resolve, 690))
            await invoke('show_toolbar')
            await currentWindow.destroy()
            return
        }

        await currentWindow.setAlwaysOnTop(false)
        setIsFinishing(true)

        const duration = 2500

        confetti({
            particleCount: 150,
            spread: 100,
            origin: { x: 0.5, y: 0.8 },
            gravity: 0.8,
            ticks: 300,
            startVelocity: 45,
            colors: ['#ff6b6b', '#4ecdc4', '#ffe66d', '#95e1d3', '#f38181'],
            shapes: ['square', 'circle', 'star'],
            scalar: 1.1,
            drift: 0,
        })

        await invoke('show_toolbar')
        await new Promise((resolve) => setTimeout(resolve, duration * 2))
        await currentWindow.hide()
        await currentWindow.destroy()
    }, [])

    const handleNext = useCallback(() => {
        if (isLastSlide) {
            handleFinish()
            return
        }
        setDirection(1)
        setCurrentSlide((prev) => prev + 1)
    }, [isLastSlide, handleFinish])

    const handleBack = useCallback(() => {
        if (isFirstSlide) return
        setDirection(-1)
        setCurrentSlide((prev) => prev - 1)
    }, [isFirstSlide])

    const imageVariants = useMemo(
        () => ({
            enter: (ctx: { dir: number; slide: number }) => {
                // Entering slide 0 (coming back from slide 1): fade in with scale + rotate
                if (ctx.dir < 0 && ctx.slide === 0) {
                    return { x: 0, opacity: 0, scale: 1.15, rotate: -3 }
                }
                return {
                    x: ctx.dir > 0 ? 80 : -80,
                    opacity: 0,
                    scale: 1,
                    rotate: 0,
                }
            },
            center: {
                x: 0,
                opacity: 1,
                scale: 1,
                rotate: 0,
            },
            exit: (ctx: { dir: number; slide: number }) => {
                // Exiting slide 0 (going to slide 1): fade out with scale + rotate
                if (ctx.dir > 0 && ctx.slide === 1) {
                    return { x: 0, opacity: 0, scale: 1.15, rotate: 3 }
                }
                return {
                    x: ctx.dir > 0 ? -80 : 80,
                    opacity: 0,
                    scale: 1,
                    rotate: 0,
                }
            },
        }),
        []
    )

    return (
        <div className="flex flex-col items-center justify-center w-full h-screen p-0.5 bg-transparent">
            <div
                className={`w-full h-full bg-content1 rounded-large overflow-hidden transition-opacity duration-300 ${isFinishing ? 'opacity-0' : 'opacity-100'}`}
            >
                <div className="flex flex-col items-center justify-center overflow-hidden h-3/5 bg-gradient-to-b from-primary/90 dark:from-primary/10 to-transparent">
                    <AnimatePresence mode="wait" custom={{ dir: direction, slide: currentSlide }}>
                        <motion.img
                            key={currentSlide}
                            src={slide.image}
                            alt={slide.title}
                            custom={{ dir: direction, slide: currentSlide }}
                            variants={imageVariants}
                            initial="enter"
                            animate="center"
                            exit="exit"
                            transition={{
                                x: { type: 'spring', stiffness: 300, damping: 30 },
                                opacity: { duration: 0.2 },
                                scale: { type: 'spring', stiffness: 300, damping: 30 },
                                rotate: { type: 'spring', stiffness: 300, damping: 30 },
                            }}
                            className={'className' in slide ? slide.className : ''}
                        />
                    </AnimatePresence>
                </div>
                <div className="flex flex-col justify-between pt-4 pb-5 pl-6 pr-7 h-2/5 bg-content1">
                    <div className="flex flex-col max-w-[690px] gap-2">
                        <p className="text-2xl font-medium">{slide.title}</p>
                        <p className=" text-foreground-500">{slide.description}</p>
                    </div>
                    <div className="flex flex-row items-center justify-between">
                        {isFirstSlide ? (
                            <Button color="primary" onPress={handleNext}>
                                Get Started
                            </Button>
                        ) : (
                            <>
                                <Button variant="flat" onPress={handleBack}>
                                    Back
                                </Button>
                                <div className="flex flex-row gap-2">
                                    {'link' in slide && (
                                        <Button
                                            variant="faded"
                                            onPress={() => openUrl(slide.link.url)}
                                        >
                                            {slide.link.label}
                                        </Button>
                                    )}
                                    <Button
                                        color="primary"
                                        onPress={handleNext}
                                        endContent={
                                            isLastSlide ? undefined : (
                                                <ChevronRightIcon className="size-4 mt-0.5" />
                                            )
                                        }
                                        className="gap-0"
                                    >
                                        {isLastSlide ? 'START' : 'Next'}
                                    </Button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}
