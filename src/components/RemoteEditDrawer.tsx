import { Checkbox } from '@heroui/react'
import { Drawer, DrawerBody, DrawerContent, DrawerFooter, DrawerHeader } from '@heroui/react'
import { Autocomplete, AutocompleteItem, Button, Input, Select, SelectItem } from '@heroui/react'
import { message } from '@tauri-apps/plugin-dialog'
import { ChevronDown, ChevronUp } from 'lucide-react'
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
    const [showAdvanced, setShowAdvanced] = useState(false)

    const [backends, setBackends] = useState<Backend[]>([])

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
                setCurrentBackend(backend || null)
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
        if (config.type === 's3' && option.Provider && option.Provider !== config.provider) {
            return null
        }

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
                if (option.Examples && option.Examples.length > 0) {
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
                        >
                            {(item) => (
                                <AutocompleteItem key={item.Value} textValue={item.Value}>
                                    {item.Help || item.Value}
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

        try {
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
        } finally {
            setIsSaving(false)
        }
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
                                >
                                    {backends.map((backend) => (
                                        <SelectItem
                                            className="h-12"
                                            key={backend.Name}
                                            startContent={
                                                <img
                                                    src={`/icons/${backend.Prefix}.png`}
                                                    className="object-contain w-8 h-8"
                                                    alt={backend.Name}
                                                />
                                            }
                                        >
                                            {backend.Description.includes('Compliant')
                                                ? `${backend.Description.split('Compliant')[0]} Compliant`
                                                : backend.Description || backend.Name}
                                        </SelectItem>
                                    ))}
                                </Select>

                                {/* Basic Options */}
                                {currentBackend?.Options.filter((opt) => !opt.Advanced).map(
                                    renderField
                                )}

                                {/* Advanced Options */}
                                {currentBackend?.Options.some((opt) => opt.Advanced) && (
                                    <div className="pt-4">
                                        <button
                                            type="button"
                                            onClick={() => setShowAdvanced(!showAdvanced)}
                                            className="flex items-center space-x-2 text-sm font-medium text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
                                        >
                                            {showAdvanced ? (
                                                <ChevronUp className="w-4 h-4" />
                                            ) : (
                                                <ChevronDown className="w-4 h-4" />
                                            )}
                                            <span>Advanced Options</span>
                                        </button>
                                        {config.type === 's3' && (
                                            <>
                                                <Input
                                                    key={'region'}
                                                    id={'field-region'}
                                                    name={'region'}
                                                    label={'region'}
                                                    labelPlacement="outside"
                                                    placeholder={
                                                        'Region (optional, fill only if you have a custom region)'
                                                    }
                                                    type={'text'}
                                                    value={config.region || ''}
                                                    autoComplete="off"
                                                    autoCapitalize="off"
                                                    autoCorrect="off"
                                                    spellCheck="false"
                                                    onValueChange={(value) => {
                                                        // console.log(value)
                                                        setConfig({ ...config, region: value })
                                                    }}
                                                />
                                                <Input
                                                    key={'endpoint'}
                                                    id={'field-endpoint'}
                                                    name={'endpoint'}
                                                    label={'endpoint'}
                                                    labelPlacement="outside"
                                                    placeholder={
                                                        'Endpoint (optional, fill only if you have a custom endpoint)'
                                                    }
                                                    type={'text'}
                                                    value={config.endpoint || ''}
                                                    autoComplete="off"
                                                    autoCapitalize="off"
                                                    autoCorrect="off"
                                                    spellCheck="false"
                                                    onValueChange={(value) => {
                                                        // console.log(value)
                                                        setConfig({ ...config, endpoint: value })
                                                    }}
                                                />
                                            </>
                                        )}
                                        {showAdvanced && (
                                            <div className="flex flex-col gap-4 pt-4 mt-4">
                                                {currentBackend.Options.filter(
                                                    (opt) => opt.Advanced
                                                ).map(renderField)}
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
