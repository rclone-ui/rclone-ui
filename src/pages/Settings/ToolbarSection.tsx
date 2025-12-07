import { Button, Chip, Input } from '@heroui/react'
import { useMutation } from '@tanstack/react-query'
import { message } from '@tauri-apps/plugin-dialog'
import { startTransition, useEffect, useMemo, useState } from 'react'
import { usePersistedStore } from '../../../store/persisted'
import BaseSection from './BaseSection'

const DEFAULT_TOOLBAR_SHORTCUT = 'CmdOrCtrl+Shift+/'

const KEY_CODE_DISPLAY_MAP: Record<string, string> = {
    Backquote: '`',
    Minus: '-',
    Equal: '=',
    BracketLeft: '[',
    BracketRight: ']',
    Backslash: '\\',
    Semicolon: ';',
    Quote: "'",
    Comma: ',',
    Period: '.',
    Slash: '/',
    Space: 'Space',
}

function formatShortcutFromEvent(event: KeyboardEvent): string | null {
    const modifiers: string[] = []
    if (event.metaKey) {
        modifiers.push('Command')
    }
    if (event.ctrlKey) {
        modifiers.push('Ctrl')
    }
    if (event.altKey) {
        modifiers.push('Alt')
    }
    if (event.shiftKey) {
        modifiers.push('Shift')
    }

    const codeMapped = KEY_CODE_DISPLAY_MAP[event.code]
    let key = codeMapped || event.key

    if (key === 'Meta') {
        key = 'Command'
    } else if (key === 'Control') {
        key = 'Ctrl'
    } else if (key === ' ') {
        key = 'Space'
    } else if (key && key.length === 1) {
        key = key.toUpperCase()
    } else if (key) {
        key = key.charAt(0).toUpperCase() + key.slice(1)
    }

    if (!key || ['Shift', 'Ctrl', 'Alt', 'Command'].includes(key)) {
        return null
    }

    const uniqueModifiers = Array.from(new Set(modifiers))
    return [...uniqueModifiers, key].join('+')
}

export default function ToolbarSection() {
    const toolbarShortcut = usePersistedStore((state) => state.toolbarShortcut)
    const setToolbarShortcut = usePersistedStore((state) => state.setToolbarShortcut)

    const [isRecording, setIsRecording] = useState(false)
    const [isSaving, _] = useState(false)
    const [feedback, setFeedback] = useState<string | null>(null)

    const resolvedShortcut = useMemo(
        () => toolbarShortcut ?? DEFAULT_TOOLBAR_SHORTCUT,
        [toolbarShortcut]
    )

    const updateToolbarShortcutMutation = useMutation({
        mutationFn: async (value: string) => {
            const normalizedShortcut = value === DEFAULT_TOOLBAR_SHORTCUT ? undefined : value
            await setToolbarShortcut(normalizedShortcut)
        },
        onSuccess: (_, value) => {
            startTransition(() => setFeedback(`Toolbar shortcut updated to ${value}`))
        },
        onError: async (error) => {
            console.error('[Toolbar] Failed to update shortcut', error)
            setFeedback('Failed to update toolbar shortcut')
            await message('Failed to update toolbar shortcut', {
                title: 'Toolbar',
                kind: 'error',
            })
        },
    })

    useEffect(() => {
        if (!isRecording) {
            return
        }

        const handleKeyDown = (event: KeyboardEvent) => {
            event.preventDefault()
            event.stopPropagation()

            if (isSaving) {
                return
            }

            const shortcut = formatShortcutFromEvent(event)
            if (!shortcut) {
                startTransition(() => {
                    setFeedback('Press a non-modifier key to finish recording…')
                })
                return
            }

            startTransition(() => {
                setIsRecording(false)
                setFeedback(`Saving ${shortcut}…`)
            })
            updateToolbarShortcutMutation.mutate(shortcut)
        }

        window.addEventListener('keydown', handleKeyDown, { capture: true })

        return () => {
            window.removeEventListener('keydown', handleKeyDown, { capture: true })
        }
    }, [isRecording, isSaving, updateToolbarShortcutMutation.mutate])

    return (
        <BaseSection
            header={{
                title: 'Toolbar',
                endContent: isRecording ? (
                    <Chip color="primary" size="sm">
                        Recording
                    </Chip>
                ) : null,
            }}
        >
            <div className="flex flex-row justify-center w-full gap-8 px-8">
                <div className="flex flex-col items-end flex-grow gap-2">
                    <h3 className="font-medium">Shortcut</h3>
                    <p className="text-xs text-neutral-500 text-end">
                        Press &quot;Record shortcut&quot; and then the desired key combination.
                    </p>
                </div>

                <div className="flex flex-col w-3/5 gap-3">
                    <Input
                        label="Current"
                        value={
                            toolbarShortcut
                                ? toolbarShortcut
                                : `Default (${DEFAULT_TOOLBAR_SHORTCUT})`
                        }
                        readOnly={true}
                        data-focus-visible="false"
                    />

                    <div className="flex flex-row gap-2">
                        <Button
                            color="primary"
                            onPress={() => {
                                if (isSaving) {
                                    return
                                }

                                if (isRecording) {
                                    setIsRecording(false)
                                    setFeedback(null)
                                    return
                                }

                                setFeedback('Press the new shortcut keys…')
                                setIsRecording(true)
                            }}
                            isDisabled={isSaving}
                            data-focus-visible="false"
                        >
                            {isRecording ? 'Cancel recording' : 'Record shortcut'}
                        </Button>
                        <Button
                            variant="flat"
                            onPress={() => {
                                setTimeout(() => {
                                    setIsRecording(false)
                                    setFeedback(`Resetting to ${DEFAULT_TOOLBAR_SHORTCUT}…`)
                                    updateToolbarShortcutMutation.mutate(DEFAULT_TOOLBAR_SHORTCUT)
                                }, 100)
                            }}
                            isDisabled={isSaving || resolvedShortcut === DEFAULT_TOOLBAR_SHORTCUT}
                            data-focus-visible="false"
                        >
                            Reset to default
                        </Button>
                    </div>

                    {feedback && (
                        <p className="text-xs text-neutral-400" aria-live="polite">
                            {feedback}
                        </p>
                    )}
                </div>
            </div>
        </BaseSection>
    )
}
