import { Button, Input, Select, SelectItem } from '@heroui/react'
import cronstrue from 'cronstrue'
import { ClockIcon, XIcon } from 'lucide-react'
import type React from 'react'
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react'

interface CronEditorProps {
    expression: string | null
    onChange: (newExpression: string | null) => void
    /** Platform-specific validation error from scheduler_validate_cron. */
    error?: string | null
}

interface CronFieldProps {
    label: string
    value: string
    onChange: (value: string) => void
    options: string[]
}

const DEFAULT_OPTIONS = ['*', '*/5', '*/10', '*/15', '*/30']

export default function CronEditor({ expression, onChange, error }: CronEditorProps) {
    const [cronExpression, setCronExpression] = useState(expression)

    const [minute, hour, dayOfMonth, month, dayOfWeek] = useMemo(
        () => (cronExpression || '* * * * *').split(' '),
        [cronExpression]
    )

    const readableDescription = useMemo(() => {
        if (!cronExpression)
            return 'Enter a cron expression to have this task run at regular intervals'
        let description: string
        try {
            description = cronstrue.toString(cronExpression)
            description += '. Runs even when the app is closed.'
        } catch {
            description = 'Invalid cron expression'
        }
        return description
    }, [cronExpression])

    const handleFieldChange = useCallback(
        (field: string, value: string) => {
            const parts = (cronExpression || '* * * * *').split(' ')
            const index = ['minute', 'hour', 'dayOfMonth', 'month', 'dayOfWeek'].indexOf(field)
            if (index !== -1) {
                parts[index] = value
                setCronExpression(parts.join(' '))
            }
        },
        [cronExpression]
    )

    const hasMounted = useRef(false)
    useEffect(() => {
        if (!hasMounted.current) {
            hasMounted.current = true
            return
        }
        onChange(cronExpression)
    }, [cronExpression, onChange])

    // Re-sync when the parent changes `expression` out from under us (the edit drawer coercing a
    // cleared field to '* * * * *', or an Advanced-section reset to null). Without this the
    // control keeps its stale internal value — showing "not scheduled" while the parent saves a
    // real cron. Echoes of our own emitted value set the same string and no-op.
    useEffect(() => {
        setCronExpression(expression)
    }, [expression])

    return (
        <div className="flex flex-col w-full gap-2">
            <Input
                value={cronExpression || ''}
                onChange={(e) => {
                    const expression = e.target.value

                    if (expression.length > 0) {
                        setCronExpression(expression)
                    } else {
                        setCronExpression(null)
                    }
                }}
                placeholder="Enter cron expression (e.g. 0 0 * * *)"
                size="lg"
                startContent={<ClockIcon className="text-default-400" />}
                isClearable={true}
                onClear={() => setCronExpression(null)}
                autoCapitalize="off"
                autoComplete="off"
                autoCorrect="off"
                spellCheck="false"
            />

            <div className="grid grid-cols-5 gap-2">
                <CronField
                    label="Minute"
                    value={minute}
                    onChange={(v) => handleFieldChange('minute', v)}
                    options={generateOptions(0, 59)}
                />
                <CronField
                    label="Hour"
                    value={hour}
                    onChange={(v) => handleFieldChange('hour', v)}
                    options={generateOptions(0, 23)}
                />
                <CronField
                    label="Day (Month)"
                    value={dayOfMonth}
                    onChange={(v) => handleFieldChange('dayOfMonth', v)}
                    options={generateOptions(1, 31)}
                />
                <CronField
                    label="Month"
                    value={month}
                    onChange={(v) => handleFieldChange('month', v)}
                    options={generateOptions(1, 12)}
                />
                <CronField
                    label="Day (Week)"
                    value={dayOfWeek}
                    onChange={(v) => handleFieldChange('dayOfWeek', v)}
                    options={generateOptions(0, 7)}
                />
            </div>

            <div className="text-sm text-neutral-500">{readableDescription}</div>
            {!!error && <div className="text-sm text-danger-500">{error}</div>}
        </div>
    )
}

function CronField({ label, value, onChange, options }: CronFieldProps) {
    const [isCustom, setIsCustom] = useState(false)

    useEffect(() => {
        const isCustom =
            !DEFAULT_OPTIONS.includes(value) &&
            !options.includes(value) &&
            value !== '*' &&
            value !== 'custom'

        startTransition(() => {
            setIsCustom(isCustom)
        })
    }, [value, options])

    const handleCustomChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        onChange(e.target.value)
    }

    return (
        <div>
            {isCustom ? (
                <Input
                    label={label}
                    value={value}
                    onChange={handleCustomChange}
                    className="max-w-xs"
                    endContent={
                        <Button
                            isIconOnly={true}
                            size="sm"
                            variant="light"
                            onPress={() => setIsCustom(false)}
                        >
                            <XIcon className="w-4 h-4 text-default-400" />
                        </Button>
                    }
                    autoCapitalize="off"
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck="false"
                />
            ) : (
                <Select
                    label={label}
                    selectedKeys={[value]}
                    onSelectionChange={(key) => {
                        const item = key.currentKey
                        if (!item) return
                        if (item === 'custom') {
                            setIsCustom(true)
                        } else {
                            onChange(item)
                        }
                    }}
                    className="max-w-xs"
                    items={[
                        ...DEFAULT_OPTIONS.map((option) => ({ key: option, label: option })),
                        ...options.map((option) => ({ key: option, label: option })),
                        { key: 'custom', label: 'Custom' },
                    ]}
                >
                    {(item) => (
                        <SelectItem key={item.key} title={item.label}>
                            {item.key}
                        </SelectItem>
                    )}
                </Select>
            )}
        </div>
    )
}

function generateOptions(start: number, end: number): string[] {
    return Array.from({ length: end - start + 1 }, (_, i) => (start + i).toString())
}
