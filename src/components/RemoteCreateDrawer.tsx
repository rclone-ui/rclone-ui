import { Drawer, DrawerBody, DrawerFooter, DrawerHeader } from '@heroui/react'
import {
    Autocomplete,
    AutocompleteItem,
    Button,
    Checkbox,
    DrawerContent,
    Input,
    Select,
    SelectItem,
} from '@heroui/react'
import { message } from '@tauri-apps/plugin-dialog'
import { openUrl } from '@tauri-apps/plugin-opener'
import { ChevronDown, ChevronUp, ExternalLinkIcon, RefreshCcwIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { createRemote } from '../../lib/rclone/api'
import { getBackends } from '../../lib/rclone/api'
import { useStore } from '../../lib/store'
import { triggerTrayRebuild } from '../../lib/tray'
import type { Backend, BackendOption } from '../../types/rclone'

export default function RemoteCreateDrawer({
    isOpen,
    onClose,
}: { isOpen: boolean; onClose: () => void }) {
    const addRemote = useStore((state) => state.addRemote)
    const [config, setConfig] = useState<Record<string, any>>({})
    const [showMoreOptions, setShowMoreOptions] = useState(false)
    const [isSaving, setIsSaving] = useState(false)
    const [backends, setBackends] = useState<Backend[]>([])

    const currentBackend = config.type ? backends.find((b) => b.Name === config.type) : null

    const currentBackendFields = currentBackend
        ? (currentBackend.Options as BackendOption[]).filter((opt) => {
              if (!opt.Provider) return true
              if (opt.Provider.includes(config.provider) && !opt.Provider.startsWith('!'))
                  return true
              if (config.type === 's3' && config.provider === 'Other' && opt.Provider.includes('!'))
                  return true
              return false
          }) || []
        : []

    function handleTypeChange(e: React.ChangeEvent<HTMLSelectElement>) {
        const newType = e.target.value

        // preserve name when resetting type
        setConfig((prev) => ({ name: prev.name, type: newType }))
    }

    function renderField(option: BackendOption) {
        // Skip rendering if the field should be hidden
        if (option.Hide !== 0) return null

        // For S3 type, only show fields that match the current provider or have no provider specified
        // if (config.type === 's3' && option.Provider && option.Provider !== config.provider) {
        //     return null
        // }

        const fieldId = `field-${option.Name}`
        const fieldValue = config[option.Name] || option.DefaultStr

        switch (option.Type) {
            case 'bool':
                return (
                    <div key={option.Name} className="flex flex-col gap-0.5">
                        <Checkbox
                            checked={fieldValue === 'true'}
                            name={option.Name}
                            radius="sm"
                            onValueChange={(checked) =>
                                setConfig({ ...config, [option.Name]: checked })
                            }
                        >
                            {option.Name}
                        </Checkbox>
                        {option.Help.includes('\n') && (
                            <p className="text-xs text-foreground-400">
                                {option.Help.split('\n').slice(1).join('\n')}
                            </p>
                        )}
                    </div>
                )
            case 'string': {
                if (
                    !(config?.provider === 'Other' && option.Name === 'endpoint') &&
                    option.Examples &&
                    option.Examples.length > 0
                ) {
                    return (
                        <Autocomplete
                            id={fieldId}
                            name={option.Name}
                            defaultInputValue={fieldValue}
                            defaultItems={option.Examples}
                            label={option.Name}
                            labelPlacement="outside"
                            placeholder={option.Help.split('\n')[0]}
                            description={option.Help.split('\n').slice(1).join('\n')}
                            isRequired={option.Required}
                            onInputChange={(value) => {
                                // console.log(value)
                                setConfig({ ...config, [option.Name]: value })
                            }}
                            allowsCustomValue={true}
                        >
                            {(item) => (
                                <AutocompleteItem
                                    key={item.Value}
                                    textValue={item.Value}
                                    startContent={
                                        option.Name === 'provider' && (
                                            <img
                                                src={`/icons/providers/${item.Value}.png`}
                                                className="object-contain w-4 h-4"
                                                alt={item.Value}
                                            />
                                        )
                                    }
                                >
                                    {item.Value || 'No Value'} {item.Help && `— ${item.Help}`}
                                </AutocompleteItem>
                            )}
                        </Autocomplete>
                    )
                }
                return (
                    <Input
                        key={option.Name}
                        id={fieldId}
                        name={option.Name}
                        label={option.Name}
                        labelPlacement="outside"
                        placeholder={option.Help.split('\n')[0]}
                        type={option.IsPassword ? 'password' : 'text'}
                        value={fieldValue}
                        classNames={
                            config.type === 'drive' && option.Name === 'client_id'
                                ? {
                                      description: 'text-warning',
                                      'inputWrapper': 'pr-0',
                                  }
                                : undefined
                        }
                        endContent={
                            config.type === 'drive' &&
                            option.Name === 'client_id' && (
                                <Button
                                    size="sm"
                                    className="h-full gap-1 rounded-l-none"
                                    color="warning"
                                    endContent={
                                        <ExternalLinkIcon className="mb-0.5 size-4 shrink-0" />
                                    }
                                    onPress={() => {
                                        openUrl(
                                            'https://rclone.org/drive/#making-your-own-client-id'
                                        )
                                    }}
                                >
                                    GUIDE
                                </Button>
                            )
                        }
                        autoComplete="off"
                        autoCapitalize="off"
                        autoCorrect="off"
                        spellCheck="false"
                        description={option.Help.split('\n').slice(1).join('\n')}
                        isRequired={option.Required}
                        onValueChange={(value) => {
                            setConfig({ ...config, [option.Name]: value })
                        }}
                    />
                )
            }
            default:
                return null
        }
    }

    async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault()
        setIsSaving(true)

        const formData = new FormData(e.currentTarget)
        const data: Record<string, string | boolean> = {}

        for (const [key, value] of formData.entries()) {
            if (value.toString().trim() === '') continue
            if (
                e.currentTarget[key] instanceof HTMLInputElement &&
                e.currentTarget[key].type === 'checkbox'
            ) {
                data[key] = (e.currentTarget[key] as HTMLInputElement).checked
            } else {
                data[key] = value.toString()
            }
        }
        try {
            const name = data.name as string
            const type = data.type as string
            const parameters = Object.fromEntries(
                Object.entries(data).filter(([key]) => key !== 'name' && key !== 'type')
            )

            await createRemote(name, type, parameters)
            addRemote(name)
            onClose()
            setConfig({})
            setShowMoreOptions(false)
            await triggerTrayRebuild()
        } catch (error) {
            console.error('Failed to create remote:', error)
            await message(error instanceof Error ? error.message : 'Unknown error occurred', {
                title: 'Could not create remote',
                kind: 'error',
            })
        }
        setIsSaving(false)
    }

    useEffect(() => {
        getBackends().then((b) => {
            setBackends(b)
        })
    }, [])

    return (
        <Drawer
            isOpen={isOpen}
            placement={'bottom'}
            size="full"
            onClose={onClose}
            hideCloseButton={true}
        >
            <DrawerContent>
                {(close) => (
                    <>
                        <DrawerHeader className="flex flex-row justify-between gap-1">
                            <span>Create Remote</span>
                            <Button
                                size="sm"
                                variant="faded"
                                color="danger"
                                startContent={<RefreshCcwIcon className="w-3 h-3" />}
                                onPress={() => setConfig({})}
                                data-focus-visible="false"
                                className="gap-2"
                            >
                                Reset
                            </Button>
                        </DrawerHeader>
                        <DrawerBody id="create-form-body">
                            <form
                                className="flex flex-col gap-4"
                                onSubmit={handleSubmit}
                                id="create-form"
                            >
                                <Input
                                    id="remote-name"
                                    name="name"
                                    label="name"
                                    labelPlacement="outside"
                                    placeholder="Remote Name (for your reference)"
                                    value={config.name || ''}
                                    onValueChange={(value) => setConfig({ ...config, name: value })}
                                    isRequired={true}
                                    autoComplete="off"
                                    autoCapitalize="off"
                                    autoCorrect="off"
                                    spellCheck="false"
                                />

                                <Select
                                    id="remote-type"
                                    name="type"
                                    label="type"
                                    labelPlacement="outside"
                                    selectionMode="single"
                                    placeholder="Select Type"
                                    selectedKeys={[config.type]}
                                    onChange={handleTypeChange}
                                    isRequired={true}
                                    itemHeight={42}
                                >
                                    {backends.map((backend) => (
                                        <SelectItem
                                            key={backend.Name}
                                            startContent={
                                                <img
                                                    src={`/icons/backends/${backend.Prefix}.png`}
                                                    className="object-contain w-8 h-8"
                                                    alt={backend.Name}
                                                />
                                            }
                                        >
                                            {backend.Description.includes('Compliant')
                                                ? `${backend.Description.split('Compliant')[0]} Compliant`
                                                : backend.Description?.replace(
                                                      ' (this is not Google Drive)',
                                                      ''
                                                  ) || backend.Name}
                                        </SelectItem>
                                    ))}
                                </Select>

                                {/* Normal Fields */}
                                {currentBackendFields
                                    .filter((opt) => !opt.Advanced)
                                    .map(renderField)}

                                {/* Advanced Fields */}
                                {currentBackendFields.some((opt) => opt.Advanced) && (
                                    <div className="pt-4">
                                        <button
                                            type="button"
                                            onClick={() => setShowMoreOptions((prev) => !prev)}
                                            className="flex items-center space-x-2 text-sm font-medium text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
                                        >
                                            {showMoreOptions ? (
                                                <ChevronUp className="w-4 h-4" />
                                            ) : (
                                                <ChevronDown className="w-4 h-4" />
                                            )}
                                            <span>More Options</span>
                                        </button>

                                        {showMoreOptions && (
                                            <div className="flex flex-col gap-4 pt-4 mt-4">
                                                {currentBackendFields
                                                    .filter((opt) => opt.Advanced)
                                                    .map(renderField)}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </form>
                        </DrawerBody>
                        <DrawerFooter>
                            <Button
                                color="danger"
                                variant="light"
                                onPress={close}
                                data-focus-visible="false"
                            >
                                Cancel
                            </Button>
                            <Button
                                color="primary"
                                type="submit"
                                form="create-form"
                                isLoading={isSaving}
                                data-focus-visible="false"
                            >
                                {isSaving ? 'Creating...' : 'Create Remote'}
                            </Button>
                        </DrawerFooter>
                    </>
                )}
            </DrawerContent>
        </Drawer>
    )
}
