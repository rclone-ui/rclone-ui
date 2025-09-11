import { Chip, Textarea, Tooltip } from '@heroui/react'
import { LockKeyholeIcon, LockOpenIcon, XIcon } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { replaceSmartQuotes } from '../../lib/format'

export default function OptionsSection({
    optionsJson,
    setOptionsJson,
    globalOptions,
    getAvailableOptions,
    rows = 14,
    isLocked,
    setIsLocked,
}: {
    optionsJson: string
    setOptionsJson: (value: string) => void
    globalOptions: any[]
    getAvailableOptions: () => Promise<any>
    rows?: number
    isLocked?: boolean
    setIsLocked?: (value: boolean) => void
}) {
    const [availableOptions, setAvailableOptions] = useState<any[]>([])

    const [options, setOptions] = useState<any>({})
    const [isJsonValid, setIsJsonValid] = useState(true)

    console.log('[OptionsSection] globalOptions', globalOptions)

    useEffect(() => {
        getAvailableOptions()
            .then((flags) => {
                console.log(JSON.stringify(flags, null, 2))
                return flags
            })
            .then((flags) => setAvailableOptions(flags))
    }, [getAvailableOptions])

    useEffect(() => {
        try {
            const parsedOptions = JSON.parse(optionsJson)
            setOptions(parsedOptions)
            setIsJsonValid(true)
        } catch {
            setIsJsonValid(false)
        }
    }, [optionsJson])

    const isOptionAdded = useCallback(
        (option: string) => {
            return options[option] !== undefined
        },
        [options]
    )

    return (
        <div className="flex flex-row gap-2">
            <Textarea
                className="w-1/2"
                label="Custom Options"
                description="Tap on an option to add it to the config. Hover to see info."
                value={optionsJson}
                onValueChange={(value) => {
                    console.log(value)
                    //weird curly apostrophe alternatives on macos, replace to normal apostrophe
                    const cleanedJson = replaceSmartQuotes(value)
                    setOptionsJson(cleanedJson)
                }}
                onKeyDown={(e) => {
                    //if it's tab key, add 2 spaces at the current text cursor position
                    if (e.key === 'Tab') {
                        e.preventDefault()
                        const text = e.currentTarget.value
                        const cursorPosition = e.currentTarget.selectionStart
                        const newText =
                            text.slice(0, cursorPosition) + '  ' + text.slice(cursorPosition)
                        e.currentTarget.value = newText
                        e.currentTarget.selectionStart = cursorPosition + 2
                        e.currentTarget.selectionEnd = cursorPosition + 2
                    }
                }}
                autoCapitalize="off"
                autoComplete="off"
                autoCorrect="off"
                spellCheck="false"
                isInvalid={!isJsonValid}
                errorMessage={isJsonValid ? '' : 'Invalid JSON'}
                minRows={rows}
                rows={rows}
                maxRows={rows}
                disableAutosize={true}
                size="lg"
                onClear={() => {
                    setOptionsJson('{}')
                }}
                endContent={
                    setIsLocked && (
                        <Tooltip
                            content="Lock to prevent changes when switching paths"
                            className="max-w-48"
                            color="foreground"
                        >
                            {isLocked ? (
                                <LockKeyholeIcon
                                    className="w-3 h-3 cursor-pointer"
                                    onClick={() => setIsLocked(false)}
                                />
                            ) : (
                                <LockOpenIcon
                                    className="w-3 h-3 cursor-pointer"
                                    onClick={() => setIsLocked(true)}
                                />
                            )}
                        </Tooltip>
                    )
                }
                data-focus-visible="false"
            />

            <div className="flex flex-wrap w-1/2 gap-2">
                {availableOptions.map((option) => {
                    const alreadyAdded = isOptionAdded(option.FieldName)

                    return (
                        <Tooltip
                            key={option.FieldName}
                            delay={500}
                            content={
                                <div className="flex flex-col w-full gap-1 max-w-52">
                                    <p className="font-mono font-bold truncate ">{option.Name}</p>
                                    <p>
                                        {
                                            availableOptions.find(
                                                (o) => o.FieldName === option.FieldName
                                            )?.Help
                                        }
                                    </p>
                                </div>
                            }
                            closeDelay={0}
                            className="pt-1.5 max-w-52"
                            color="foreground"
                        >
                            <Chip
                                isDisabled={!isJsonValid}
                                variant={alreadyAdded ? 'flat' : 'solid'}
                                onClick={() => {
                                    if (alreadyAdded) {
                                        const newOptions = {
                                            ...options,
                                        }
                                        delete newOptions[option.FieldName]
                                        setOptionsJson(JSON.stringify(newOptions, null, 2))

                                        return
                                    }

                                    const defaultGlobalValue =
                                        globalOptions[
                                            option.FieldName as keyof typeof globalOptions
                                        ]

                                    const defaultValue =
                                        availableOptions.find(
                                            (o) => o.FieldName === option.FieldName
                                        )?.DefaultStr || ''

                                    const newOptions = {
                                        ...options,
                                        [option.FieldName]: defaultGlobalValue || defaultValue,
                                    }

                                    setOptionsJson(JSON.stringify(newOptions, null, 2))
                                }}
                                className="cursor-pointer"
                                size="sm"
                                endContent={
                                    alreadyAdded ? (
                                        <XIcon className="w-3.5 h-3.5 mr-1 stroke-1" />
                                    ) : undefined
                                }
                            >
                                {option.FieldName}
                            </Chip>
                        </Tooltip>
                    )
                })}
            </div>
        </div>
    )
}
