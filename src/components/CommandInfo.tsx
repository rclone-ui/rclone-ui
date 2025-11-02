import { Accordion, AccordionItem } from '@heroui/react'
import { InfoIcon } from 'lucide-react'
import { startTransition, useState } from 'react'

export default function CommandInfo({ content }: { content: string }) {
    const [isOpen, setIsOpen] = useState(false)

    return (
        <Accordion
            variant="light"
            fullWidth={true}
            onSelectionChange={() => {
                startTransition(() => {
                    setIsOpen((prev) => !prev)
                })
            }}
        >
            <AccordionItem
                key="command-info"
                title={
                    isOpen
                        ? 'Tap here to hide the info about this command'
                        : 'Tap here to see more info about this command'
                }
                classNames={{
                    base: '-mx-2 bg-primary-100 rounded-b-large px-8 whitespace-pre-wrap text-primary-900',
                    trigger: 'pb-1.5 pt-1 !cursor-pointer !outline-none !ring-0',
                    title: 'text-small !cursor-pointer text-primary-700 font-light',
                }}
                indicator={<InfoIcon className="text-primary-800 size-3.5" />}
            >
                {content}
            </AccordionItem>
        </Accordion>
    )
}
