import { Checkbox } from '@heroui/react'
import { Drawer, DrawerBody, DrawerContent, DrawerFooter, DrawerHeader } from '@heroui/react'
import { Autocomplete, AutocompleteItem, Button, Input, Select, SelectItem } from '@heroui/react'
import { message } from '@tauri-apps/plugin-dialog'
import { openUrl } from '@tauri-apps/plugin-opener'
import { ChevronDown, ChevronUp, ExternalLinkIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { getBackends, getRemote, updateRemote } from '../../lib/rclone/api'
import type { Backend, BackendOption } from '../../types/rclone'

export default function RemoteEditDrawer({
    remoteName,
    onClose,
    isOpen,
}: {
    remoteName: string
    onClose: () => void
    isOpen: boolean
}) {
    const [config, setConfig] = useState<any>({})
    const [isSaving, setIsSaving] = useState(false)
    const [currentBackend, setCurrentBackend] = useState<Backend | null>(null)
    const [showMoreOptions, setShowMoreOptions] = useState(false)

    const [backends, setBackends] = useState<Backend[]>([])

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

    useEffect(() => {
        getBackends().then((b) => {
            setBackends(b)
        })
    }, [])

    useEffect(() => {
        const loadRemoteConfig = async () => {
            try {
                const remoteInfo = await getRemote(remoteName)
                setConfig(remoteInfo)
                // Find the current backend based on the type
                const backend = backends.find((b) => b.Name === remoteInfo.type)
                if (backend) {
                    setCurrentBackend(backend)
                } else {
                    setCurrentBackend(null)
                }
            } catch (error) {
                console.error('Failed to load remote config:', error)
            }
        }
        loadRemoteConfig()
    }, [remoteName, backends])

    const renderField = (option: BackendOption) => {
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
                            defaultChecked={fieldValue === 'true'}
                            name={option.Name}
                            radius="sm"
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
                            isDisabled={option.Name === 'provider'}
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
                        defaultValue={fieldValue}
                        autoComplete="off"
                        autoCapitalize="off"
                        autoCorrect="off"
                        spellCheck="false"
                        description={option.Help.split('\n').slice(1).join('\n')}
                    />
                )
            }
            default:
                return null
        }
    }

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault()
        setIsSaving(true)

        const formData = new FormData(e.currentTarget)
        const data: Record<string, string | boolean> = {}
        const changedValues: Record<string, string | boolean> = {}

        // First collect all form values
        for (const [key, value] of formData.entries()) {
            if (
                e.currentTarget[key] instanceof HTMLInputElement &&
                e.currentTarget[key].type === 'checkbox'
            ) {
                data[key] = (e.currentTarget[key] as HTMLInputElement).checked
            } else {
                data[key] = value.toString()
            }
        }

        // Compare with original config and only include changed values
        for (const [key, value] of Object.entries(data)) {
            // if the value is empty and the key is not in the config, skip it
            if (!config?.[key] && value.toString().trim() === '') {
                continue
            }
            if (config[key] !== value) {
                changedValues[key] = value
            }
        }

        try {
            // Only update if there are changes
            if (Object.keys(changedValues).length > 0) {
                await updateRemote(remoteName, changedValues)
                onClose()
            } else {
                // No changes, just go back
                onClose()
            }
        } catch (error) {
            console.error('Failed to update remote:', error)
            await message(error instanceof Error ? error.message : 'Unknown error occurred', {
                title: 'Could not update remote',
                kind: 'error',
            })
        }
        setIsSaving(false)
    }

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
                        <DrawerHeader className="flex flex-col gap-1">
                            Edit {remoteName}
                        </DrawerHeader>
                        <DrawerBody>
                            <form
                                id="remote-form"
                                className="flex flex-col gap-4"
                                onSubmit={handleSubmit}
                            >
                                <Select
                                    id="edit-remote-type"
                                    name="type"
                                    label="type"
                                    labelPlacement="outside"
                                    selectionMode="single"
                                    placeholder="Select Type"
                                    selectedKeys={[config.type]}
                                    isDisabled={true}
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
                                Close
                            </Button>
                            <Button
                                color="primary"
                                type="submit"
                                form="remote-form"
                                isDisabled={isSaving}
                                data-focus-visible="false"
                            >
                                {isSaving ? 'Saving...' : 'Save Changes'}
                            </Button>
                        </DrawerFooter>
                    </>
                )}
            </DrawerContent>
        </Drawer>
    )
}
