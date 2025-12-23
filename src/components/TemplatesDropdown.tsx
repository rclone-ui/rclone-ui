import {
    Button,
    Dropdown,
    DropdownItem,
    DropdownMenu,
    DropdownSection,
    DropdownTrigger,
} from '@heroui/react'
import { invoke } from '@tauri-apps/api/core'
import { ask, message } from '@tauri-apps/plugin-dialog'
import { FoldersIcon, PlusIcon } from 'lucide-react'
import { useMemo } from 'react'
import { groupByCategory } from '../../lib/flags'
import { useFlags } from '../../lib/hooks'
import { usePersistedStore } from '../../store/persisted'
import type { FlagValue } from '../../types/rclone'
import type { Template } from '../../types/template'

export default function TemplatesDropdown({
    onSelect,
    operation,
    isDisabled,
    getOptions,
}: {
    onSelect: (groupedOptions: ReturnType<typeof groupByCategory>, shouldMerge: boolean) => void
    operation: Template['tags'][number]
    isDisabled: boolean
    getOptions: () => Record<string, FlagValue>
}) {
    const { allFlags } = useFlags()
    const allTemplates = usePersistedStore((state) => state.templates)

    const templates = useMemo(
        () => allTemplates.filter((template) => template.tags.includes(operation)),
        [allTemplates, operation]
    )

    const hasTemplates = useMemo(() => templates.length > 0, [templates])

    return (
        <Dropdown
            shadow="none"
            classNames={{
                content: 'border border-default-200',
            }}
        >
            <DropdownTrigger>
                <Button
                    onPress={() => {}}
                    size="lg"
                    type="button"
                    color="primary"
                    variant="shadow"
                    isIconOnly={true}
                >
                    <FoldersIcon className="size-7" />
                </Button>
            </DropdownTrigger>

            <DropdownMenu
                onAction={(key) => {
                    if (key === 'add') {
                        setTimeout(async () => {
                            const result = await invoke<string | null>('prompt', {
                                title: 'Add Template',
                                message: 'Enter a name for the template',
                                default: '',
                                sensitive: false,
                            }).catch(async (e) => {
                                console.error('[TemplatesDropdown] prompt_text error', e)
                                await message(
                                    'Failed to add template, please open Settings > About and tap the red "Open Github Issue" button.',
                                    {
                                        title: 'Error',
                                        kind: 'error',
                                    }
                                )
                                return null
                            })
                            const inputtedName = result?.trim()
                            if (!inputtedName || typeof inputtedName !== 'string') {
                                return
                            }

                            const options = getOptions()

                            usePersistedStore.setState((prev) => ({
                                templates: [
                                    ...prev.templates,
                                    {
                                        id: Math.floor(Date.now() / 1000).toString(),
                                        name: inputtedName,
                                        tags: [operation],
                                        options,
                                    },
                                ],
                            }))
                        }, 100)
                    } else {
                        const template = templates.find(
                            (template) => template.id === key.toString()
                        )
                        if (!template || !allFlags) {
                            return
                        }

                        setTimeout(async () => {
                            const shouldMerge = await ask(
                                'Would you like to merge the template with your existing flags, or replace all existing flags?',
                                {
                                    title: 'Apply Template',
                                    kind: 'info',
                                    okLabel: 'Add to Existing',
                                    cancelLabel: 'Replace All',
                                }
                            )
                            onSelect(groupByCategory(template.options, allFlags), shouldMerge)
                        }, 100)
                    }
                }}
                color="primary"
                disabledKeys={isDisabled ? ['add'] : []}
            >
                <DropdownSection
                    showDivider={hasTemplates}
                    className={hasTemplates ? undefined : 'mb-0'}
                >
                    <DropdownItem
                        key="add"
                        color="success"
                        className="gap-1.5 text-success"
                        startContent={<PlusIcon className="size-4" />}
                    >
                        SAVE AS TEMPLATE
                    </DropdownItem>
                </DropdownSection>
                {
                    templates.map((template) => (
                        <DropdownItem className="group" key={template.id}>
                            {template.name}
                        </DropdownItem>
                    )) as unknown as ReturnType<typeof DropdownItem>
                }
            </DropdownMenu>
        </Dropdown>
    )
}
