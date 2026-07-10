import { Accordion, AccordionItem, Avatar } from '@heroui/react'
import {
    ClockIcon,
    CopyIcon,
    DiamondPercentIcon,
    FilterIcon,
    FolderSyncIcon,
    MoveIcon,
    ServerIcon,
    WrenchIcon,
} from 'lucide-react'
import { type ComponentType, type ReactNode, useMemo } from 'react'
import ShowMoreOptionsBanner from '../ShowMoreOptionsBanner'

// Avatar/indicator/title per option category — exactly what each page's accordion rendered.
export const CATEGORY_META: Record<
    'copy' | 'sync' | 'move' | 'bisync' | 'filters' | 'cron' | 'config' | 'remotes',
    {
        title: string
        icon: ComponentType<{ className?: string }>
        avatarColor?: 'primary' | 'success' | 'danger' | 'warning' | 'default'
        avatarClassName?: string
        avatarIconClassName?: string
    }
> = {
    copy: { title: 'Copy', icon: CopyIcon, avatarColor: 'primary' },
    sync: { title: 'Sync', icon: FolderSyncIcon, avatarColor: 'success' },
    move: { title: 'Move', icon: MoveIcon, avatarColor: 'primary' },
    bisync: {
        title: 'Bisync',
        icon: DiamondPercentIcon,
        avatarClassName: 'bg-lime-500',
        avatarIconClassName: 'text-success-foreground',
    },
    filters: { title: 'Filters', icon: FilterIcon, avatarColor: 'danger' },
    cron: { title: 'Cron', icon: ClockIcon, avatarColor: 'warning' },
    config: { title: 'Config', icon: WrenchIcon, avatarColor: 'default' },
    remotes: { title: 'Remotes', icon: ServerIcon, avatarClassName: 'bg-fuchsia-500' },
}

export type OptionCategory = keyof typeof CATEGORY_META

export interface OptionsAccordionItemDef {
    key: string
    category: OptionCategory
    subtitle?: string
    children: ReactNode
}

/**
 * The option-group accordion shared by the operation pages: item scaffolding (Avatar,
 * indicator, title) comes from CATEGORY_META; each item's content (OptionsSection /
 * CronEditor / RemoteOptionsSection) stays page-supplied. `banner` wraps the accordion in the
 * relative div with the ShowMoreOptionsBanner (Copy/Sync/Move); Bisync/Delete/Purge omit it.
 */
export default function OptionsAccordion({
    items,
    defaultExpandedKeys,
    banner = false,
}: {
    items: OptionsAccordionItemDef[]
    defaultExpandedKeys?: string[]
    banner?: boolean
}) {
    const accordionItems = useMemo(
        () =>
            items.map((item) => {
                const meta = CATEGORY_META[item.category]
                const Icon = meta.icon
                return (
                    <AccordionItem
                        key={item.key}
                        startContent={
                            <Avatar
                                color={meta.avatarColor}
                                className={meta.avatarClassName}
                                radius="lg"
                                fallback={<Icon className={meta.avatarIconClassName} />}
                            />
                        }
                        indicator={<Icon />}
                        title={meta.title}
                        subtitle={item.subtitle}
                    >
                        {item.children}
                    </AccordionItem>
                )
            }),
        [items]
    )

    const accordion = (
        <Accordion
            keepContentMounted={true}
            dividerProps={{
                className: 'opacity-50',
            }}
            defaultExpandedKeys={defaultExpandedKeys}
        >
            {accordionItems}
        </Accordion>
    )

    if (!banner) {
        return accordion
    }

    return (
        <div className="relative flex flex-col">
            {accordion}
            <ShowMoreOptionsBanner />
        </div>
    )
}
