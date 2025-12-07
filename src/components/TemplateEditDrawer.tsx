import {
    Accordion,
    AccordionItem,
    Avatar,
    Button,
    Chip,
    Divider,
    Drawer,
    DrawerBody,
    DrawerContent,
    DrawerFooter,
    DrawerHeader,
    Input,
    Select,
    SelectItem,
    cn,
} from '@heroui/react'
import { useMutation } from '@tanstack/react-query'
import { message } from '@tauri-apps/plugin-dialog'
import { platform } from '@tauri-apps/plugin-os'
import {
    CopyIcon,
    FilterIcon,
    FolderSyncIcon,
    HardDriveIcon,
    ServerCrashIcon,
    WavesLadderIcon,
    WrenchIcon,
} from 'lucide-react'
import { startTransition, useEffect, useMemo, useState } from 'react'
import {
    FLAG_CATEGORIES,
    getJsonKeyCount,
    getOptionsSubtitle,
    groupByCategory,
} from '../../lib/flags'
import { useFlags } from '../../lib/hooks'
import { SERVE_TYPES } from '../../lib/rclone/constants'
import { usePersistedStore } from '../../store/persisted'
import type { BackendOption } from '../../types/rclone'
import type { Template } from '../../types/template'
import OptionsSection from './OptionsSection'

export default function TemplateEditDrawer({
    isOpen,
    onClose,
    selectedTemplate,
}: {
    isOpen: boolean
    onClose: () => void
    selectedTemplate: Template
}) {
    const {
        globalFlags,
        filterFlags,
        configFlags,
        mountFlags,
        vfsFlags,
        copyFlags,
        syncFlags,
        serveFlags,
        allFlags,
    } = useFlags()

    const [name, setName] = useState(selectedTemplate.name)
    const [tags, setTags] = useState<string[]>(selectedTemplate.tags)

    const [configOptionsJson, setConfigOptionsJson] = useState<string>('{}')
    const [copyOptionsJson, setCopyOptionsJson] = useState<string>('{}')
    const [syncOptionsJson, setSyncOptionsJson] = useState<string>('{}')
    const [filterOptionsJson, setFilterOptionsJson] = useState<string>('{}')
    const [mountOptionsJson, setMountOptionsJson] = useState<string>('{}')
    const [vfsOptionsJson, setVfsOptionsJson] = useState<string>('{}')
    const [serveOptionsJson, setServeOptionsJson] = useState<string>('{}')

    const uniqueServeFlags = useMemo(() => {
        const all = Object.values(serveFlags).flat()
        const unique = new Map<string, BackendOption>()
        for (const flag of all) {
            if (!unique.has(flag.Name)) {
                unique.set(flag.Name, flag)
            }
        }
        return Array.from(unique.values()).sort((a, b) => a.Name.localeCompare(b.Name))
    }, [serveFlags])

    const mergedGlobalServeFlags = useMemo(() => {
        const merged = {}
        if (!globalFlags) return {}
        for (const type of SERVE_TYPES) {
            const flags = globalFlags[type]
            if (flags) {
                Object.assign(merged, flags)
            }
        }
        return merged
    }, [globalFlags])

    useEffect(() => {
        if (!selectedTemplate || !allFlags) return

        setName(selectedTemplate.name)
        setTags(selectedTemplate.tags)

        const groupedFlags = groupByCategory(selectedTemplate.options, allFlags)

        const mountJson = JSON.stringify(groupedFlags.mount, null, 2)
        const configJson = JSON.stringify(groupedFlags.config, null, 2)
        const vfsJson = JSON.stringify(groupedFlags.vfs, null, 2)
        const filterJson = JSON.stringify(groupedFlags.filter, null, 2)
        const copyJson = JSON.stringify(groupedFlags.copy, null, 2)
        const syncJson = JSON.stringify(groupedFlags.sync, null, 2)
        const serveJson = JSON.stringify(
            Object.values(groupedFlags.serve).reduce((acc, curr) => {
                Object.assign(acc, curr)
                return acc
            }, {}),
            null,
            2
        )

        startTransition(() => {
            setMountOptionsJson(mountJson)
            setConfigOptionsJson(configJson)
            setVfsOptionsJson(vfsJson)
            setFilterOptionsJson(filterJson)
            setCopyOptionsJson(copyJson)
            setSyncOptionsJson(syncJson)
            setServeOptionsJson(serveJson)
        })
    }, [selectedTemplate, allFlags])

    const updateTemplateMutation = useMutation({
        mutationFn: async () => {
            if (!name) {
                await message('Please enter a name for the template', {
                    title: 'Error',
                    kind: 'error',
                })
                return
            }

            const options: Record<string, any> = {
                ...(JSON.parse(mountOptionsJson) as Record<string, any>),
                ...(JSON.parse(configOptionsJson) as Record<string, any>),
                ...(JSON.parse(vfsOptionsJson) as Record<string, any>),
                ...(JSON.parse(filterOptionsJson) as Record<string, any>),
                ...(JSON.parse(copyOptionsJson) as Record<string, any>),
                ...(JSON.parse(syncOptionsJson) as Record<string, any>),
                ...(JSON.parse(serveOptionsJson) as Record<string, any>),
            }

            usePersistedStore.setState((state) => ({
                templates: state.templates.map((t) =>
                    t.id === selectedTemplate.id
                        ? {
                              ...t,
                              name,
                              tags: tags as any,
                              options,
                          }
                        : t
                ),
            }))

            return true
        },
        onSuccess: () => {
            onClose()
        },
        onError: async (error) => {
            await message(
                error instanceof Error
                    ? error.message
                    : 'Error saving template. Please check your options.',
                {
                    title: 'Error',
                    kind: 'error',
                }
            )
            console.error(error)
        },
    })

    return (
        <Drawer
            isOpen={isOpen}
            placement="bottom"
            size="full"
            onClose={onClose}
            hideCloseButton={true}
        >
            <DrawerContent
                className={cn(
                    'bg-content1/80 backdrop-blur-md dark:bg-content1/90',
                    platform() === 'macos' && 'pt-5'
                )}
            >
                {(close) => (
                    <>
                        <DrawerHeader className="px-0 pb-0">
                            <div className="flex flex-col w-full gap-2">
                                <div className="flex flex-row items-baseline w-full gap-4 pl-6 pr-4 pb-0.5">
                                    <p className="shrink-0">Edit Template</p>
                                    <p className="text-small text-foreground-500 line-clamp-1">
                                        Edit your template configuration.
                                    </p>
                                </div>
                                <Divider />
                            </div>
                        </DrawerHeader>
                        <DrawerBody id="template-edit-drawer-body" className="py-0">
                            <div className="flex flex-col gap-8 pt-6">
                                <div className="flex flex-col gap-5">
                                    <Input
                                        label="Name"
                                        labelPlacement="outside"
                                        placeholder="My Template"
                                        value={name}
                                        onValueChange={(value) => setName(value)}
                                        size="lg"
                                        data-focus-visible="false"
                                        autoComplete="off"
                                        autoCorrect="off"
                                        autoCapitalize="off"
                                        spellCheck="false"
                                        isClearable={true}
                                        onClear={() => setName('')}
                                    />

                                    <Select
                                        size="lg"
                                        isMultiline={false}
                                        items={[
                                            ...FLAG_CATEGORIES.filter(
                                                (c) => !c.startsWith('serve.')
                                            ),
                                            'serve',
                                        ].map((category) => ({
                                            key: category,
                                            label: category,
                                        }))}
                                        label="Tags"
                                        labelPlacement="outside"
                                        placeholder="Select tags"
                                        data-focus-visible="false"
                                        autoComplete="off"
                                        autoCorrect="off"
                                        autoCapitalize="off"
                                        spellCheck="false"
                                        renderValue={(items) => {
                                            return (
                                                <div className="flex flex-row w-full gap-2">
                                                    {items.map((item) => (
                                                        <Chip key={item.key} color="primary">
                                                            {item.data?.label.toUpperCase()}
                                                        </Chip>
                                                    ))}
                                                </div>
                                            )
                                        }}
                                        selectedKeys={tags}
                                        selectionMode="multiple"
                                        onSelectionChange={(value) => {
                                            setTags(
                                                Array.from(value).map((item) => item.toString())
                                            )
                                        }}
                                    >
                                        {(tagCategory) => (
                                            <SelectItem
                                                variant="flat"
                                                key={tagCategory.key}
                                                textValue={tagCategory.label}
                                            >
                                                <span className="text-small">
                                                    {tagCategory.label.toUpperCase()}
                                                </span>
                                            </SelectItem>
                                        )}
                                    </Select>
                                </div>

                                <Accordion selectionMode="multiple" defaultExpandedKeys={'all'}>
                                    <AccordionItem
                                        key="mount"
                                        startContent={
                                            <Avatar
                                                color="secondary"
                                                radius="lg"
                                                fallback={<HardDriveIcon />}
                                            />
                                        }
                                        indicator={<HardDriveIcon />}
                                        title="Mount"
                                        subtitle={getOptionsSubtitle(
                                            getJsonKeyCount(mountOptionsJson)
                                        )}
                                    >
                                        <div className="flex flex-col gap-4">
                                            <OptionsSection
                                                optionsJson={mountOptionsJson}
                                                setOptionsJson={setMountOptionsJson}
                                                globalOptions={globalFlags?.mount ?? {}}
                                                availableOptions={mountFlags || []}
                                            />
                                        </div>
                                    </AccordionItem>

                                    <AccordionItem
                                        key="config"
                                        startContent={
                                            <Avatar
                                                color="default"
                                                radius="lg"
                                                fallback={<WrenchIcon />}
                                            />
                                        }
                                        indicator={<WrenchIcon />}
                                        title="Config"
                                        subtitle={getOptionsSubtitle(
                                            getJsonKeyCount(configOptionsJson)
                                        )}
                                    >
                                        <OptionsSection
                                            optionsJson={configOptionsJson}
                                            setOptionsJson={setConfigOptionsJson}
                                            globalOptions={globalFlags?.main || {}}
                                            availableOptions={configFlags || []}
                                        />
                                    </AccordionItem>
                                    <AccordionItem
                                        key="vfs"
                                        startContent={
                                            <Avatar
                                                color="warning"
                                                radius="lg"
                                                fallback={<WavesLadderIcon />}
                                            />
                                        }
                                        indicator={<WavesLadderIcon />}
                                        title="VFS"
                                        subtitle={getOptionsSubtitle(
                                            getJsonKeyCount(vfsOptionsJson)
                                        )}
                                    >
                                        <OptionsSection
                                            optionsJson={vfsOptionsJson}
                                            setOptionsJson={setVfsOptionsJson}
                                            globalOptions={globalFlags?.vfs || {}}
                                            availableOptions={vfsFlags || []}
                                        />
                                    </AccordionItem>
                                    <AccordionItem
                                        key="filters"
                                        startContent={
                                            <Avatar
                                                color="danger"
                                                radius="lg"
                                                fallback={<FilterIcon />}
                                            />
                                        }
                                        indicator={<FilterIcon />}
                                        title="Filters"
                                        subtitle={getOptionsSubtitle(
                                            getJsonKeyCount(filterOptionsJson)
                                        )}
                                    >
                                        <OptionsSection
                                            optionsJson={filterOptionsJson}
                                            setOptionsJson={setFilterOptionsJson}
                                            globalOptions={globalFlags?.filter || {}}
                                            availableOptions={filterFlags || []}
                                        />
                                    </AccordionItem>
                                    <AccordionItem
                                        key="copy"
                                        startContent={
                                            <Avatar
                                                color="primary"
                                                radius="lg"
                                                fallback={<CopyIcon />}
                                            />
                                        }
                                        indicator={<CopyIcon />}
                                        title="Copy"
                                        subtitle={getOptionsSubtitle(
                                            getJsonKeyCount(copyOptionsJson)
                                        )}
                                    >
                                        <OptionsSection
                                            optionsJson={copyOptionsJson}
                                            setOptionsJson={setCopyOptionsJson}
                                            globalOptions={globalFlags?.main || {}}
                                            availableOptions={copyFlags || []}
                                        />
                                    </AccordionItem>

                                    <AccordionItem
                                        key="sync"
                                        startContent={
                                            <Avatar
                                                color="success"
                                                radius="lg"
                                                fallback={<FolderSyncIcon />}
                                            />
                                        }
                                        indicator={<FolderSyncIcon />}
                                        title="Sync"
                                        subtitle={getOptionsSubtitle(
                                            getJsonKeyCount(syncOptionsJson)
                                        )}
                                    >
                                        <OptionsSection
                                            optionsJson={syncOptionsJson}
                                            setOptionsJson={setSyncOptionsJson}
                                            globalOptions={globalFlags?.main || {}}
                                            availableOptions={syncFlags || []}
                                        />
                                    </AccordionItem>

                                    <AccordionItem
                                        key="serve"
                                        startContent={
                                            <Avatar
                                                radius="lg"
                                                fallback={
                                                    <ServerCrashIcon className="text-success-foreground" />
                                                }
                                                className="bg-cyan-500"
                                            />
                                        }
                                        indicator={<ServerCrashIcon />}
                                        title="Serve"
                                        subtitle={getOptionsSubtitle(
                                            getJsonKeyCount(serveOptionsJson)
                                        )}
                                    >
                                        <OptionsSection
                                            optionsJson={serveOptionsJson}
                                            setOptionsJson={setServeOptionsJson}
                                            globalOptions={mergedGlobalServeFlags as any}
                                            availableOptions={uniqueServeFlags}
                                        />
                                    </AccordionItem>
                                </Accordion>
                            </div>
                        </DrawerBody>
                        <DrawerFooter>
                            <Button
                                color="danger"
                                variant="light"
                                onPress={() => {
                                    close()
                                }}
                                data-focus-visible="false"
                            >
                                CANCEL
                            </Button>
                            <Button
                                color="primary"
                                isLoading={updateTemplateMutation.isPending}
                                onPress={() =>
                                    setTimeout(() => updateTemplateMutation.mutate(), 100)
                                }
                                data-focus-visible="false"
                            >
                                SAVE CHANGES
                            </Button>
                        </DrawerFooter>
                    </>
                )}
            </DrawerContent>
        </Drawer>
    )
}
