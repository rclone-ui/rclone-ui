import { Drawer, DrawerBody, DrawerFooter, DrawerHeader } from '@nextui-org/drawer'
import { Button, DrawerContent } from '@nextui-org/react'
import { message } from '@tauri-apps/plugin-dialog'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { createRemote } from '../../lib/rclone'
import { getBackends } from '../../lib/rclone'
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

    useEffect(() => {
        getBackends().then((b) => {
            setBackends(b)
        })
    }, [])

    const handleTypeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const newType = e.target.value
        setConfig({ type: newType })
    }

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
                    <div key={option.Name} className="space-y-2">
                        <label className="flex items-center space-x-2">
                            <input
                                type="checkbox"
                                id={fieldId}
                                name={option.Name}
                                className="form-checkbox"
                                defaultChecked={fieldValue === 'true'}
                                onChange={(e) =>
                                    setConfig({ ...config, [option.Name]: e.target.checked })
                                }
                                autoComplete="off"
                                autoCapitalize="off"
                                autoCorrect="off"
                                spellCheck={false}
                            />
                            <span className="text-sm font-medium">
                                {option.Help.split('\n')[0]}
                            </span>
                        </label>
                        {option.Help.includes('\n') && (
                            <p className="text-sm text-gray-500 dark:text-gray-400">
                                {option.Help.split('\n').slice(1).join('\n')}
                            </p>
                        )}
                    </div>
                )
            case 'string': {
                if (option.Examples && option.Examples.length > 0) {
                    return (
                        <div key={option.Name} className="space-y-2">
                            <label htmlFor={fieldId} className="block text-sm font-medium">
                                {option.Help.split('\n')[0]}
                            </label>
                            <select
                                id={fieldId}
                                name={option.Name}
                                className="w-full p-2 border rounded dark:bg-gray-800"
                                value={fieldValue}
                                onChange={(e) =>
                                    setConfig({ ...config, [option.Name]: e.target.value })
                                }
                            >
                                <option value="">Select {option.Name}</option>
                                {option.Examples.map((example) => (
                                    <option key={example.Value} value={example.Value}>
                                        {example.Help || example.Value}
                                    </option>
                                ))}
                            </select>
                            {option.Help.includes('\n') && (
                                <p className="text-sm text-gray-500 dark:text-gray-400">
                                    {option.Help.split('\n').slice(1).join('\n')}
                                </p>
                            )}
                        </div>
                    )
                }
                return (
                    <div key={option.Name} className="space-y-2">
                        <label htmlFor={fieldId} className="block text-sm font-medium">
                            {option.Help.split('\n')[0]}
                            {option.Required && <span className="ml-1 text-red-500">*</span>}
                        </label>
                        <input
                            id={fieldId}
                            name={option.Name}
                            type={option.IsPassword ? 'password' : 'text'}
                            className="w-full p-2 border rounded dark:bg-gray-800"
                            value={fieldValue || ''}
                            onChange={(e) =>
                                setConfig({ ...config, [option.Name]: e.target.value })
                            }
                            required={option.Required}
                            autoComplete="off"
                            autoCapitalize="off"
                            autoCorrect="off"
                            spellCheck={false}
                        />
                        {option.Help.includes('\n') && (
                            <p className="text-sm text-gray-500 dark:text-gray-400">
                                {option.Help.split('\n').slice(1).join('\n')}
                            </p>
                        )}
                    </div>
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

            // First collect all form values
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

            const name = data.name as string
            const type = data.type as string
            const parameters = Object.fromEntries(
                Object.entries(data).filter(([key]) => key !== 'name' && key !== 'type')
            )

            // Create the remote
            await createRemote(name, type, parameters)
            addRemote(name)
            onClose()
            await triggerTrayRebuild()
        } catch (error) {
            console.error('Failed to create remote:', error)
            await message(error instanceof Error ? error.message : 'Unknown error occurred', {
                title: 'Could not create remote',
                kind: 'error',
            })
        } finally {
            setIsSaving(false)
        }
    }

    const currentBackend = useMemo(() => {
        if (!config.type) return null
        return backends.find((b) => b.Name === config.type)
    }, [config, backends])

    const currentBackendFields = useMemo(() => {
        if (!currentBackend) return []
        const options =
            (currentBackend?.Options as BackendOption[]).filter(
                (opt) =>
                    !opt.Provider ||
                    (opt.Provider.includes(config.provider) && !opt.Provider.startsWith('!'))
            ) || []

        return options
    }, [config.provider, currentBackend])

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
                        <DrawerHeader className="flex flex-col gap-1">Create Remote</DrawerHeader>
                        <DrawerBody>
                            <form className="space-y-6" onSubmit={handleSubmit} id="create-form">
                                <div className="space-y-2">
                                    <label htmlFor="name" className="block text-sm font-medium">
                                        Remote Name <span className="text-red-500">*</span>
                                    </label>
                                    <input
                                        id="name"
                                        name="name"
                                        type="text"
                                        className="w-full p-2 border rounded dark:bg-gray-800"
                                        value={config.name || ''}
                                        onChange={(e) =>
                                            setConfig({ ...config, name: e.target.value })
                                        }
                                        required={true}
                                        autoComplete="off"
                                        autoCapitalize="off"
                                        autoCorrect="off"
                                        spellCheck={false}
                                    />
                                </div>

                                <div className="space-y-2">
                                    <label
                                        htmlFor="remote-type"
                                        className="block text-sm font-medium"
                                    >
                                        Type <span className="text-red-500">*</span>
                                    </label>
                                    <select
                                        id="remote-type"
                                        name="type"
                                        className="w-full p-2 border rounded dark:bg-gray-800"
                                        value={config.type || ''}
                                        onChange={handleTypeChange}
                                        required={true}
                                    >
                                        <option value="">Select Type</option>
                                        {backends.map((backend) => (
                                            <option key={backend.Name} value={backend.Name}>
                                                {backend.Description.includes('Compliant')
                                                    ? `${backend.Description.split('Compliant')[0]} Compliant`
                                                    : backend.Description || backend.Name}
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                {/* Normal Fields */}
                                {currentBackendFields
                                    .filter((opt) => !opt.Advanced)
                                    .map(renderField)}

                                {/* Advanced Fields */}
                                {currentBackendFields.some((opt) => opt.Advanced) && (
                                    <div className="pt-4">
                                        <button
                                            type="button"
                                            onClick={() => setShowMoreOptions(!showMoreOptions)}
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
                                            <div className="pt-4 mt-4 space-y-6 border-t dark:border-gray-700">
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
