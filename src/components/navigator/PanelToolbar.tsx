import { Button, Input, Tooltip } from '@heroui/react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeftIcon, RefreshCwIcon } from 'lucide-react'
import type { ReactNode } from 'react'

export type ToolbarButtons = {
    BackButton: ReactNode
    RefreshButton: ReactNode
    SearchInput: ReactNode
}

export default function PanelToolbar({
    onBack,
    onRefresh,
    isBackDisabled,
    isLoading,
    searchTerm,
    onSearchChange,
    renderToolbar,
    visible = true,
}: {
    onBack: () => void
    onRefresh: () => void
    isBackDisabled: boolean
    isLoading: boolean
    searchTerm: string
    onSearchChange: (term: string) => void
    renderToolbar?: (buttons: ToolbarButtons) => ReactNode[][]
    visible?: boolean
}) {
    const BackButton = (
        <Tooltip content="Go to parent directory" size="lg" color="foreground">
            <Button
                color="primary"
                size="sm"
                onPress={onBack}
                isDisabled={isBackDisabled || isLoading}
                radius="full"
                startContent={<ArrowLeftIcon className="size-5" />}
                className="gap-1 min-w-fit"
            >
                BACK
            </Button>
        </Tooltip>
    )

    const RefreshButton = (
        <Tooltip content="Refresh directory" size="lg" color="foreground">
            <Button
                color="primary"
                size="sm"
                onPress={onRefresh}
                isDisabled={isLoading}
                radius="full"
                isIconOnly={true}
            >
                <RefreshCwIcon className={`size-4 ${isLoading ? 'animate-spin' : ''}`} />
            </Button>
        </Tooltip>
    )

    const SearchInput = (
        <Input
            size="sm"
            radius="full"
            placeholder="Type here to search"
            value={searchTerm}
            onValueChange={onSearchChange}
            isClearable={true}
            onClear={() => onSearchChange('')}
            autoCapitalize="off"
            autoComplete="off"
            autoCorrect="off"
            spellCheck="false"
            classNames={{
                base: 'w-48',
            }}
        />
    )

    const buttons: ToolbarButtons = { BackButton, RefreshButton, SearchInput }
    const groups = renderToolbar
        ? renderToolbar(buttons)
        : [[BackButton, RefreshButton], [SearchInput]]

    const motionTransition = {
        enter: {
            type: 'spring',
            stiffness: 300,
            damping: 20,
            delay: 0.69,
        },
        exit: {
            duration: 0.2,
            delay: 0,
        },
    }

    return (
        <div className="absolute left-0 right-0 flex justify-center w-full gap-4 bottom-5">
            <AnimatePresence>
                {visible &&
                    groups.map((group, index) => (
                        <motion.div
                            key={index}
                            initial={{ y: 100, opacity: 0 }}
                            animate={{ y: 0, opacity: 1 }}
                            exit={{ y: 100, opacity: 0 }}
                            transition={motionTransition}
                            className="flex flex-row items-center gap-2.5 px-2 py-1.5 rounded-full bg-content2"
                        >
                            {group}
                        </motion.div>
                    ))}
            </AnimatePresence>
        </div>
    )
}
