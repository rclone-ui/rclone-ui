import { ChevronDownIcon } from 'lucide-react'
import { startTransition, useEffect } from 'react'
import { usePersistedStore } from '../../store/persisted'

export default function ShowMoreOptionsBanner() {
    const acknowledgements = usePersistedStore((state) => state.acknowledgements)

    const showMoreOptions = !acknowledgements.includes('showMoreOptions')

    useEffect(() => {
        if (acknowledgements.includes('showMoreOptions')) return

        const handleScroll = () => {
            usePersistedStore.setState((prev) => {
                if (prev.acknowledgements.includes('showMoreOptions')) return prev
                return {
                    acknowledgements: [...prev.acknowledgements, 'showMoreOptions'],
                }
            })
        }

        window.addEventListener('scroll', handleScroll, { once: true })

        return () => {
            window.removeEventListener('scroll', handleScroll)
        }
    }, [acknowledgements])

    if (!showMoreOptions) return null

    return (
        <div
            className="absolute flex flex-col items-center justify-center w-full gap-1 bg-white dark:bg-[#121212] bottom-0 group py-2"
            onClick={() => {
                startTransition(() => {
                    usePersistedStore.setState((prev) => ({
                        acknowledgements: [...prev.acknowledgements, 'showMoreOptions'],
                    }))
                })
                requestAnimationFrame(() => {
                    setTimeout(() => {
                        scrollTo({
                            top: document.body.scrollHeight,
                            behavior: 'smooth',
                        })
                    }, 400)
                })
            }}
        >
            <p className="text-small animate-show-more-title group-hover:text-foreground-500 text-foreground-400">
                Show more options
            </p>
            <ChevronDownIcon className="size-5 stroke-foreground-400 animate-show-more group-hover:stroke-foreground-500" />
        </div>
    )
}
