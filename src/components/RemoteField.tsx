import { Autocomplete, AutocompleteItem, Button, Checkbox, Input } from '@heroui/react'
import { openUrl } from '@tauri-apps/plugin-opener'
import { ExternalLinkIcon, EyeIcon, EyeOffIcon } from 'lucide-react'
import { useMemo, useState } from 'react'
import { OWN_OAUTH_TYPES } from '../../lib/rclone/overrides'
import type { BackendOption } from '../../types/rclone'
import FilenApiKeyField from './FilenApiKeyField'
import PathPickerField from './PathPickerField'

// rclone has no "is a local path" flag, so opt fields in by name. Value = whether it's a directory.
const PATH_PICKER_FIELDS: Record<string, { directory: boolean }> = {
    service_account_file: { directory: false }, // drive, google cloud storage
    box_config_file: { directory: false }, // box
    client_certificate_path: { directory: false }, // azureblob, azurefiles
    service_principal_file: { directory: false }, // azureblob, azurefiles
    config_file: { directory: false }, // oracleobjectstorage
    sse_customer_key_file: { directory: false }, // oracleobjectstorage
    shared_credentials_file: { directory: false }, // s3
    key_file: { directory: false }, // sftp
    known_hosts_file: { directory: false }, // sftp
    pubkey_file: { directory: false }, // sftp
    kerberos_ccache: { directory: false }, // smb
    chunk_path: { directory: true }, // cache
    db_path: { directory: true }, // cache
    tmp_upload_path: { directory: true }, // cache
}

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

    // Password fields (rclone `IsPassword`) render obscured; this toggles a plaintext reveal.
    const [isRevealed, setIsRevealed] = useState(false)

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
        // Filen's api_key can be generated from the account's email + password (mirrors the
        // `filen export-api-key` CLI command), so render it with an inline "Generate" button.
        if (config?.type === 'filen' && option.Name === 'api_key') {
            return (
                <FilenApiKeyField
                    option={option}
                    config={config}
                    setConfig={setConfig}
                    isDisabled={isDisabled}
                    helpTitle={helpTitle}
                    helpDescription={helpDescription}
                />
            )
        }

        // Local-path options (service account files, certs, cache dirs, …) get a native picker.
        const pathPicker = PATH_PICKER_FIELDS[option.Name]
        if (pathPicker) {
            return (
                <PathPickerField
                    option={option}
                    config={config}
                    setConfig={setConfig}
                    isDisabled={isDisabled}
                    helpTitle={helpTitle}
                    helpDescription={helpDescription}
                    directory={pathPicker.directory}
                />
            )
        }

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

        const requiresOwnCredentials =
            OWN_OAUTH_TYPES.includes(config?.type) &&
            (option.Name === 'client_id' || option.Name === 'client_secret')

        const inputType = option.IsPassword && !isRevealed ? 'password' : 'text'

        // GUIDE button takes priority over the reveal toggle when both could apply.
        const endContent = requiresOwnCredentials ? (
            <Button
                size="sm"
                className="h-full gap-1 rounded-l-none"
                color="warning"
                endContent={<ExternalLinkIcon className="mb-0.5 size-4 shrink-0" />}
                onPress={() => {
                    openUrl(
                        `https://rclone.org/${config?.type === 'google photos' ? 'googlephotos' : 'drive'}/#making-your-own-client-id`
                    )
                }}
            >
                GUIDE
            </Button>
        ) : option.IsPassword ? (
            <button
                type="button"
                aria-label={isRevealed ? 'Hide value' : 'Reveal value'}
                className="text-foreground-400 outline-none focus:outline-none"
                onClick={() => setIsRevealed((prev) => !prev)}
            >
                {isRevealed ? (
                    <EyeOffIcon className="size-4 shrink-0" />
                ) : (
                    <EyeIcon className="size-4 shrink-0" />
                )}
            </button>
        ) : undefined

        return (
            <Input
                key={option.Name}
                id={fieldId}
                name={option.Name}
                label={option.Name}
                labelPlacement="outside"
                placeholder={helpTitle}
                type={inputType}
                classNames={
                    requiresOwnCredentials
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
                endContent={endContent}
                isRequired={option.Required || requiresOwnCredentials}
                defaultValue={initialFieldValue}
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck="false"
                description={requiresOwnCredentials ? undefined : helpDescription}
                isDisabled={isDisabled}
            />
        )
    }

    return null
}
