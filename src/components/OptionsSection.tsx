import { Chip, Textarea, Tooltip } from '@heroui/react'
import { LockKeyholeIcon, LockOpenIcon } from 'lucide-react'
import { startTransition, useCallback, useEffect, useState } from 'react'
import { replaceSmartQuotes } from '../../lib/format'

export default function OptionsSection({
    optionsJson,
    setOptionsJson,
    globalOptions,
    availableOptions,
    isLocked,
    setIsLocked,
}: {
    optionsJson: string
    setOptionsJson: (value: string) => void
    globalOptions: Record<string, unknown>
    availableOptions: any[]
    isLocked?: boolean
    setIsLocked?: (value: boolean) => void
}) {
    const [options, setOptions] = useState<any>({})
    const [isJsonValid, setIsJsonValid] = useState(true)

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

    const isOptionAdded = useCallback(
        (option: string) => {
            return options[option] !== undefined
        },
        [options]
    )

    return (
        <div className="flex flex-row gap-2 h-[350px]">
            <Textarea
                classNames={{
                    'base': 'w-1/2',
                    inputWrapper: '!h-full !ring-0 !outline-offset-0 !outline-0',
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
                    if (e.key === 'Tab') {
                        e.preventDefault()
                        const text = e.currentTarget.value
                        const cursorPosition = e.currentTarget.selectionStart

                        const lineStart = text.lastIndexOf('\n', cursorPosition - 1) + 1
                        const lineEnd = text.indexOf('\n', cursorPosition)
                        const actualLineEnd = lineEnd === -1 ? text.length : lineEnd
                        const lineText = text.slice(lineStart, actualLineEnd)
                        const relCursor = cursorPosition - lineStart

                        const quoteIndices: number[] = []
                        for (let i = 0; i < lineText.length; i++) {
                            if (lineText[i] === '"' && (i === 0 || lineText[i - 1] !== '\\')) {
                                quoteIndices.push(i)
                            }
                        }

                        if (quoteIndices.length >= 3) {
                            const startKey = quoteIndices[0]
                            const endKey = quoteIndices[1]
                            const startValue = quoteIndices[2]

                            if (relCursor > startKey && relCursor <= endKey) {
                                const newCursorPosition = lineStart + startValue + 1
                                e.currentTarget.selectionStart = newCursorPosition
                                e.currentTarget.selectionEnd = newCursorPosition
                                return
                            }
                        }

                        const newText =
                            text.slice(0, cursorPosition) + '  ' + text.slice(cursorPosition)
                        // add 2 spaces
                        const newCursorPosition = cursorPosition + 2
                        setOptionsJson(newText)
                        e.currentTarget.value = newText
                        e.currentTarget.selectionStart = newCursorPosition
                        e.currentTarget.selectionEnd = newCursorPosition
                    }
                    if (e.key === '"') {
                        const text = e.currentTarget.value
                        const cursorPosition = e.currentTarget.selectionStart
                        // Check if there's already a closing quote immediately after cursor
                        const nextChar = text[cursorPosition]
                        if (nextChar !== '"') {
                            e.preventDefault()
                            const newText =
                                text.slice(0, cursorPosition) + '""' + text.slice(cursorPosition)
                            setOptionsJson(newText)
                            e.currentTarget.value = newText
                            // Position cursor between the quotes
                            e.currentTarget.selectionStart = cursorPosition + 1
                            e.currentTarget.selectionEnd = cursorPosition + 1
                        }
                    }
                    if (e.key === 'Enter') {
                        e.preventDefault()
                        const text = e.currentTarget.value
                        const cursorPosition = e.currentTarget.selectionStart
                        const textBeforeCursor = text.slice(0, cursorPosition)
                        const textAfterCursor = text.slice(cursorPosition)

                        const trimmedBefore = textBeforeCursor.trimEnd()
                        const lastChar = trimmedBefore[trimmedBefore.length - 1]

                        // Don't add comma if we're after an opening brace/bracket or existing comma
                        const needsComma = lastChar && !['{', '[', ','].includes(lastChar)

                        let newText = textBeforeCursor
                        let moveCursor = 4

                        if (needsComma) {
                            newText += ','
                            moveCursor += 1
                        }

                        newText += '\n  "": ""'

                        if (textAfterCursor.startsWith('}')) {
                            newText += '\n'
                        }

                        newText += textAfterCursor
                        const newCursorPosition = cursorPosition + moveCursor

                        setOptionsJson(newText)
                        e.currentTarget.value = newText
                        e.currentTarget.selectionStart = newCursorPosition
                        e.currentTarget.selectionEnd = newCursorPosition
                    }
                }}
                autoCapitalize="off"
                autoComplete="off"
                autoCorrect="off"
                spellCheck="false"
                isInvalid={!isJsonValid}
                errorMessage={isJsonValid ? '' : 'Invalid JSON'}
                disableAutosize={true}
                rows={12}
                size="lg"
                onClear={() => {
                    setOptionsJson(JSON.stringify({}, null, 2))
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
                    const alreadyAdded = isOptionAdded(option.Name)

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
                                        {availableOptions.find((o) => o.Name === option.Name)?.Help}
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
                                            newOptions[option.Name] = undefined
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
                                            value = defaultGlobalValue as typeof value
                                        } else {
                                            value = availableOptions.find(
                                                (o) => o.Name === option.Name
                                            )?.DefaultStr
                                        }

                                        const valueType =
                                            availableOptions.find((o) => o.Name === option.Name)
                                                ?.Type || 'string'

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
                                            [option.Name]: value,
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
