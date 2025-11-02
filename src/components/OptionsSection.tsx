import { Chip, Textarea, Tooltip } from '@heroui/react'
import { LockKeyholeIcon, LockOpenIcon } from 'lucide-react'
import { startTransition, useEffect, useState } from 'react'
import { replaceSmartQuotes } from '../../lib/format'

export default function OptionsSection({
    optionsJson,
    setOptionsJson,
    globalOptions,
    getAvailableOptions,
    isLocked,
    setIsLocked,
}: {
    optionsJson: string
    setOptionsJson: (value: string) => void
    globalOptions: any[]
    getAvailableOptions: () => Promise<any>
    isLocked?: boolean
    setIsLocked?: (value: boolean) => void
}) {
    const [availableOptions, setAvailableOptions] = useState<any[]>([])

    const [options, setOptions] = useState<any>({})
    const [isJsonValid, setIsJsonValid] = useState(true)

    useEffect(() => {
        getAvailableOptions()
            .then((flags) => {
                return flags
            })
            .then((flags) => {
                startTransition(() => {
                    setAvailableOptions(flags)
                })
            })
    }, [getAvailableOptions])

    useEffect(() => {
        startTransition(() => {
            try {
                const parsedOptions = JSON.parse(optionsJson)
                setOptions(parsedOptions)
                setIsJsonValid(true)
            } catch {
                setIsJsonValid(false)
            }
        })
    }, [optionsJson])

    function isOptionAdded(option: string) {
        return options[option] !== undefined
    }

    return (
        <div className="flex flex-row gap-2 h-[400px]">
            <Textarea
                classNames={{
                    'base': 'w-1/2',
                    inputWrapper: '!h-full !ring-0 !outline-none',
                }}
                label="Custom Options"
                description="Tap an option to add it. Scroll to see more. Hover to see details."
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
                disableAutosize={true}
                rows={14}
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
                                    className="size-3 !ring-0 !outline-none !cursor-pointer"
                                    onClick={() => setIsLocked(false)}
                                />
                            ) : (
                                <LockOpenIcon
                                    className="size-3 !ring-0 !outline-none !cursor-pointer"
                                    onClick={() => setIsLocked(true)}
                                />
                            )}
                        </Tooltip>
                    )
                }
                data-focus-visible="false"
            />

            <div className="flex flex-row flex-wrap items-start content-start justify-start w-1/2 overflow-y-auto gap-x-2.5 gap-y-3 rounded-medium">
                {availableOptions.map((option) => {
                    const alreadyAdded = isOptionAdded(option.FieldName)

                    return (
                        <Tooltip
                            key={option.Name}
                            delay={500}
                            content={
                                <div className="flex flex-col w-full gap-1 overflow-y-auto max-w-52 max-h-80 overscroll-y-none">
                                    <p className="sticky top-0 font-mono font-bold truncate bg-foreground shrink-0">
                                        {option.Name}
                                    </p>
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
                                color={alreadyAdded ? 'primary' : 'default'}
                                onClick={() => {
                                    startTransition(() => {
                                        if (alreadyAdded) {
                                            const newOptions = {
                                                ...options,
                                            }
                                            newOptions[option.FieldName] = undefined
                                            setOptionsJson(JSON.stringify(newOptions, null, 2))

                                            return
                                        }

                                        let value: string | number | boolean = ''

                                        const defaultGlobalValue =
                                            globalOptions[
                                                option.FieldName as keyof typeof globalOptions
                                            ]

                                        if (
                                            defaultGlobalValue !== null &&
                                            defaultGlobalValue !== undefined
                                        ) {
                                            value = defaultGlobalValue
                                        } else {
                                            value = availableOptions.find(
                                                (o) => o.FieldName === option.FieldName
                                            )?.DefaultStr
                                        }

                                        const valueType =
                                            availableOptions.find(
                                                (o) => o.FieldName === option.FieldName
                                            )?.Type || 'string'

                                        if (valueType === 'bool') {
                                            value = Boolean(value || false)
                                        } else if (
                                            valueType.includes('int') ||
                                            valueType.includes('float')
                                        ) {
                                            value = Number(value || 0)
                                        }

                                        const newOptions = {
                                            ...options,
                                            [option.FieldName]: value,
                                        }

                                        setOptionsJson(JSON.stringify(newOptions, null, 2))
                                    })
                                }}
                                classNames={{
                                    base: alreadyAdded
                                        ? 'border-primary border-1 text-primary-900'
                                        : undefined,
                                    content: '!cursor-pointer',
                                }}
                                size="sm"
                            >
                                {option.Name}
                            </Chip>
                        </Tooltip>
                    )
                })}
            </div>
        </div>
    )
}
