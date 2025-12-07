import { Button, Drawer, DrawerBody, DrawerContent, DrawerHeader, Tooltip, cn } from '@heroui/react'
import { platform } from '@tauri-apps/plugin-os'
import { InfoIcon } from 'lucide-react'
import { startTransition, useState } from 'react'

export default function CommandInfoButton({ content }: { content: string }) {
    const [isOpen, setIsOpen] = useState(false)

    return (
        <>
            <Tooltip content={'View documentation'} placement="top" size="lg" color="foreground">
                <Button
                    onPress={() => {
                        startTransition(() => {
                            setIsOpen((prev) => !prev)
                        })
                    }}
                    size="lg"
                    type="button"
                    color="primary"
                    // variant="faded"
                    isIconOnly={true}
                >
                    <InfoIcon className="size-6" />
                </Button>
            </Tooltip>

            <Drawer
                isOpen={isOpen}
                onClose={() => {
                    startTransition(() => {
                        setIsOpen(false)
                    })
                }}
                size="full"
                placement={'bottom'}
            >
                <DrawerContent
                    className={cn(
                        'bg-content1/80 backdrop-blur-md dark:bg-content1/90',
                        platform() === 'macos' ? 'pt-4' : undefined
                    )}
                >
                    <DrawerHeader>Documentation</DrawerHeader>
                    <DrawerBody className="pb-20 whitespace-pre-wrap text-large">
                        {content}
                    </DrawerBody>
                </DrawerContent>
            </Drawer>
        </>
    )
}
