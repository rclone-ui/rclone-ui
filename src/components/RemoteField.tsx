import { Autocomplete, AutocompleteItem, Button, Checkbox, Input } from '@heroui/react'
import { openUrl } from '@tauri-apps/plugin-opener'
import { ExternalLinkIcon } from 'lucide-react'
import { useMemo } from 'react'
import type { BackendOption } from '../../types/rclone'

export default function RemoteField({
    option,
    config,
    setConfig,
    isDisabled = false,
}: {
    option: BackendOption
    config: Record<string, any>
    setConfig: (config: Record<string, any>) => void
    isDisabled?: boolean
}) {
    // Skip rendering if the field should be hidden

    // For S3 type, only show fields that match the current provider or have no provider specified
    // if (config.type === 's3' && option.Provider && option.Provider !== config.provider) {
    //     return null
    // }

    const fieldId = useMemo(() => `field-${option.Name}`, [option.Name])
    const initialFieldValue = useMemo(
        () => config?.[option.Name]?.toString() || option.DefaultStr,
        [config, option.Name, option.DefaultStr]
    )
    const helpTitle = useMemo(() => option.Help.split('\n')[0], [option.Help])
    const helpDetails = useMemo(() => option.Help.split('\n').slice(1), [option.Help])
    const helpDescription = useMemo(() => helpDetails.join('\n'), [helpDetails])

    // console.log(
    //     '[RemoteField] option',
    //     option.Name,
    //     fieldId,
    //     initialFieldValue,
    //     typeof initialFieldValue
    // )

    if (option.Hide !== 0) return null

    if (option.Type === 'bool') {
        return (
            <div className="flex flex-col gap-0.5">
                <Checkbox
                    defaultSelected={initialFieldValue === 'true'}
                    name={option.Name}
                    radius="sm"
                    onValueChange={(value) => {
                        setConfig((prev: Record<string, any>) => ({
                            ...prev,
                            [option.Name]: value,
                        }))
                    }}
                    isDisabled={isDisabled}
                >
                    {option.Name}
                </Checkbox>
                {helpDetails.length > 0 && (
                    <p className="text-xs text-foreground-400">{helpDescription}</p>
                )}
            </div>
        )
    }

    if (option.Type === 'string') {
        const shouldUseAutocomplete =
            !(config?.provider === 'Other' && option.Name === 'endpoint') &&
            option.Examples &&
            option.Examples.length > 0

        if (shouldUseAutocomplete) {
            return (
                <Autocomplete
                    id={fieldId}
                    name={option.Name}
                    defaultInputValue={initialFieldValue}
                    defaultItems={option.Examples}
                    label={option.Name}
                    labelPlacement="outside"
                    placeholder={helpTitle}
                    description={helpDescription}
                    isDisabled={isDisabled}
                    allowsCustomValue={true}
                    onSelectionChange={(value) => {
                        setConfig((prev: Record<string, any>) => ({
                            ...prev,
                            [option.Name]: value,
                        }))
                    }}
                    onInputChange={(value) => {
                        setConfig((prev: Record<string, any>) => ({
                            ...prev,
                            [option.Name]: value,
                        }))
                    }}
                    autoComplete="off"
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck="false"
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
                                        onError={(e) => {
                                            e.currentTarget.src = '/icon.png'
                                            e.currentTarget.className += ' invert dark:invert-0'
                                            e.currentTarget.onerror = null
                                        }}
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
                placeholder={helpTitle}
                type={option.IsPassword ? 'password' : 'text'}
                classNames={
                    config?.type && config.type === 'drive' && option.Name === 'client_id'
                        ? {
                              description: 'text-warning',
                              'inputWrapper': 'pr-0',
                          }
                        : undefined
                }
                onValueChange={(value) => {
                    setConfig((prev: Record<string, any>) => ({
                        ...prev,
                        [option.Name]: value,
                    }))
                }}
                endContent={
                    config?.type &&
                    config.type === 'drive' &&
                    option.Name === 'client_id' && (
                        <Button
                            size="sm"
                            className="h-full gap-1 rounded-l-none"
                            color="warning"
                            endContent={<ExternalLinkIcon className="mb-0.5 size-4 shrink-0" />}
                            onPress={() => {
                                openUrl('https://rclone.org/drive/#making-your-own-client-id')
                            }}
                        >
                            GUIDE
                        </Button>
                    )
                }
                isRequired={option.Required}
                defaultValue={initialFieldValue}
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck="false"
                description={helpDescription}
                isDisabled={isDisabled}
            />
        )
    }

    return null
}
