import {
    Button,
    Dropdown,
    DropdownItem,
    DropdownMenu,
    DropdownSection,
    DropdownTrigger,
} from '@heroui/react'
import { invoke } from '@tauri-apps/api/core'
import { message } from '@tauri-apps/plugin-dialog'
import { PlusIcon } from 'lucide-react'
import { usePersistedStore } from '../../lib/store'

export default function TemplatesDropdown({
    onSelect,
    onAdd,
    operation,
}: {
    onSelect: (templateId: string) => void
    onAdd: (name: string) => void
    operation: 'copy' | 'sync' | 'move' | 'delete' | 'purge'
}) {
    const allTemplates = usePersistedStore((state) => state.templates)

    const templates = allTemplates.filter((template) => template.operation === operation)

    const hasTemplates = templates.length > 0

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
                    className="min-w-fit"
                    variant="shadow"
                    // className="max-w-2xl gap-2"
                    // data-focus-visible="false"
                >
                    TEMPLATES
                </Button>
            </DropdownTrigger>

            <DropdownMenu
                onAction={(key) => {
                    if (key === 'add') {
                        setTimeout(async () => {
                            const result = await invoke<string | null>('prompt_text', {
                                title: 'Add Template',
                                message: 'Enter a name for the template',
                                default: '',
                            }).catch(async (e) => {
                                console.error('[TemplatesDropdown] prompt_text error', e)
                                await message(
                                    'Failed to add template, please open Settings and tap the red "Open Github Issue" button.',
                                    {
                                        title: 'Error',
                                        kind: 'error',
                                    }
                                )
                                return null
                            })
                            const inputtedName = result?.trim()
                            if (typeof inputtedName === 'string' && inputtedName) {
                                onAdd(inputtedName)
                            }
                        }, 100)
                    } else {
                        onSelect(key.toString())
                    }
                }}
                color="primary"
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
