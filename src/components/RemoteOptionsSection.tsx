import { Tab, Tabs } from '@heroui/react'
import { useQueries, useQuery } from '@tanstack/react-query'
import { startTransition, useEffect, useMemo, useState } from 'react'
import { getRemoteName } from '../../lib/format'
import rclone from '../../lib/rclone/client'
import type { FlagValue } from '../../types/rclone'
import OptionsSection from '../components/OptionsSection'

const IGNORED_OPTIONS = [
    'account',
    'key',
    'endpoint',
    'description',
    'provider',
    'env_auth',
    'region',
    'acl',
    'access_key_id',
    'secret_access_key',
    'location_constraint',
    'sse_kms_key_id',
    'sse_customer_key',
    'sse_customer_algorithm',
    'sse_customer_key_base64',
    'sse_customer_key_md5',
]

export default function RemoteOptionsSection({
    selectedRemotes,
    remoteOptionsLocked,
    remoteOptionsJsonString,
    setRemoteOptionsJsonString,
    setRemoteOptionsLocked,
}: {
    selectedRemotes: string[]
    remoteOptionsLocked: boolean
    remoteOptionsJsonString: string
    setRemoteOptionsJsonString: (value: string) => void
    setRemoteOptionsLocked: (value: boolean) => void
}) {
    const [optionsJsonStrings, setOptionsJsonStrings] = useState<Record<string, string>>({})
    const [options, setOptions] = useState<Record<string, Record<string, FlagValue[]>>>({})
    // @ts-ignore
    const [jsonError, setJsonError] = useState<string | null>(null)

    const backendsQuery = useQuery({
        queryKey: ['backends'],
        queryFn: async () => {
            const backends = await rclone('/config/providers')
            return backends.providers
        },
        experimental_prefetchInRender: true,
    })

    const backends = useMemo(() => backendsQuery.data ?? [], [backendsQuery.data])

    const remoteNamesQueries = useQueries({
        queries: selectedRemotes.map((remote) => ({
            queryKey: ['remote', remote, 'name'],
            queryFn: () => getRemoteName(remote),
        })),
    })

    const uniqueRemotes = useMemo(
        () =>
            Array.from(
                remoteNamesQueries.reduce((acc, curr) => {
                    if (curr.data) {
                        acc.add(curr.data)
                    }
                    return acc
                }, new Set<string>())
            ),
        [remoteNamesQueries]
    )

    const remoteConfigQueries = useQueries({
        queries: uniqueRemotes.map((remote) => ({
            queryKey: ['remote', remote, 'config', 'withName'],
            queryFn: async () => {
                const remoteConfig = await rclone('/config/get', {
                    params: {
                        query: {
                            name: remote,
                        },
                    },
                })
                return {
                    name: remote,
                    config: remoteConfig,
                }
            },
        })),
    })

    const remoteConfigs = useMemo(
        () =>
            remoteConfigQueries
                .map((query) => query.data)
                .map((data) => {
                    if (!data) return null

                    const { config, name } = data

                    if (config.type === 's3') {
                        if (config.provider) {
                            const backendOptions =
                                backends.find((b) => b.Name === config.type)?.Options || []
                            const providerOptions = backendOptions
                                .filter(
                                    (o) =>
                                        (!o.Provider || o.Provider.includes(config.provider!)) &&
                                        !IGNORED_OPTIONS.includes(o.Name) &&
                                        !!o.Help
                                )
                                .map((o) => {
                                    const newName = `s3_${o.Name}`
                                    return {
                                        ...o,
                                        Name: newName,
                                        FieldName: newName,
                                    }
                                })
                                .filter(Boolean)
                            console.log('[RemoteOptionsSection] providerOptions', providerOptions)
                            return {
                                name,
                                config,
                                options: providerOptions,
                            }
                        }
                        return null
                    }

                    return {
                        name,
                        config,
                        options: [
                            ...(backends.find((b) => b.Name === config.type)?.Options || [])
                                .filter((o) => !IGNORED_OPTIONS.includes(o.Name) && !!o.Help)
                                .map((o) => {
                                    const newName = `${config.type}_${o.Name}`
                                    return {
                                        ...o,
                                        Name: newName,
                                        FieldName: newName,
                                    }
                                })
                                .filter(Boolean),
                        ],
                    }
                })
                .filter(Boolean),
        [remoteConfigQueries, backends]
    )

    useEffect(() => {
        console.log('[RemoteOptionsSection] optionsJsonStrings', optionsJsonStrings)
    }, [optionsJsonStrings])

    useEffect(() => {
        if (Object.keys(optionsJsonStrings).length === uniqueRemotes.length) {
            console.log('[RemoteOptionsSection] optionsJsonStrings already set')
            return
        }
        console.log(
            '[RemoteOptionsSection] setting optionsJsonStrings, parsing remoteOptionsJsonString: ',
            remoteOptionsJsonString
        )
        const parsed = JSON.parse(remoteOptionsJsonString) as Record<string, string>
        console.log('[RemoteOptionsSection] setting optionsJsonStrings parsed', parsed)
        const jsonStrings: Record<string, string> = uniqueRemotes.reduce(
            (acc, curr) => {
                console.log('[RemoteOptionsSection] curr', curr)
                console.log('[RemoteOptionsSection] parsed[curr]', parsed[curr])
                acc[curr] = parsed[curr] ?? '{}'
                return acc
            },
            {} as Record<string, string>
        )
        console.log('[RemoteOptionsSection] setting optionsJsonStrings to: ', jsonStrings)
        startTransition(() => {
            setOptionsJsonStrings(jsonStrings)
        })
    }, [uniqueRemotes, optionsJsonStrings, remoteOptionsJsonString])

    useEffect(() => {
        const stringified = JSON.stringify(
            Object.entries(options).reduce(
                (acc, [r, o]) => {
                    acc[r] = JSON.stringify(o, null, 2)
                    return acc
                },
                {} as Record<string, string>
            )
        )
        console.log('[RemoteOptionsSection] stringified', stringified)
        startTransition(() => {
            setRemoteOptionsJsonString(stringified)
        })
    }, [options, setRemoteOptionsJsonString])

    useEffect(() => {
        let remote: string | null = null
        let parseError: string | null = null
        const entries = Object.entries(optionsJsonStrings)
        const newOptions: Record<string, Record<string, FlagValue[]>> = {}

        for (const [r, o] of entries) {
            remote = r
            try {
                newOptions[r] = JSON.parse(o) as Record<string, FlagValue[]>
            } catch (e) {
                console.error(`Error parsing ${remote} options:`, e)
                parseError = e instanceof Error ? e.message : 'Unknown error'
                break
            }
        }

        if (parseError) {
            console.log('[RemoteOptionsSection] parseError', parseError)
            setJsonError(`${remote}: ${parseError}`)
            return
        }

        console.log('[RemoteOptionsSection] setting options to: ', newOptions)

        startTransition(() => {
            setOptions(newOptions)
            setJsonError(null)
        })
    }, [optionsJsonStrings])

    return (
        <Tabs
            items={remoteConfigs.map((data) => ({
                id: data.name,
                label: data.name.toUpperCase(),
                options: data.options,
                config: data.config,
            }))}
            fullWidth={true}
            variant="bordered"
            destroyInactiveTabPanel={false}
            size="sm"
        >
            {(item) => (
                <Tab key={item.id} title={item.label}>
                    <OptionsSection
                        optionsJson={optionsJsonStrings[item.id]}
                        setOptionsJson={(json) =>
                            setOptionsJsonStrings((prev) => ({
                                ...prev,
                                [item.id]: json,
                            }))
                        }
                        globalOptions={item.config}
                        availableOptions={item.options}
                        isLocked={remoteOptionsLocked}
                        setIsLocked={setRemoteOptionsLocked}
                    />
                </Tab>
            )}
        </Tabs>
    )
}
