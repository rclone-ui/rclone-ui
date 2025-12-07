import { Button, Input } from '@heroui/react'
import { invoke } from '@tauri-apps/api/core'
import { ask, message } from '@tauri-apps/plugin-dialog'
import { PlusIcon, Trash2Icon } from 'lucide-react'
import { startTransition, useEffect, useMemo, useState } from 'react'
import { useHostStore } from '../../../store/host'
import BaseSection from './BaseSection'

export default function ProxySection() {
    const proxy = useHostStore((state) => state.proxy)

    const [proxyUrl, setProxyUrl] = useState('')
    const [newHost, setNewHost] = useState('')
    const [isTestingProxy, setIsTestingProxy] = useState(false)

    useEffect(() => {
        startTransition(() => {
            setProxyUrl(proxy?.url || '')
        })
    }, [proxy?.url])

    const ignoredHosts = useMemo(() => proxy?.ignoredHosts || [], [proxy?.ignoredHosts])

    const handleAddHost = (host: string) => {
        const addingHost = host.trim()

        if (addingHost && !ignoredHosts.includes(addingHost)) {
            useHostStore.setState((state) => ({
                proxy: {
                    url: state.proxy?.url || '',
                    ignoredHosts: [...(state.proxy?.ignoredHosts || []), addingHost],
                },
            }))
            setNewHost('')
        }
    }

    const handleRemoveHost = (host: string) => {
        const removingHost = host.trim()

        if (removingHost) {
            useHostStore.setState((state) => ({
                proxy: {
                    url: state.proxy?.url || '',
                    ignoredHosts: ignoredHosts.filter((host) => host !== removingHost),
                },
            }))
        }
    }

    const handleUpdateProxyUrl = async (url: string) => {
        if (!url.trim()) {
            await message('Please enter a proxy URL', {
                title: 'Error',
                kind: 'error',
            })
            return
        }

        setIsTestingProxy(true)

        try {
            await invoke<string>('test_proxy_connection', { proxy_url: url })

            // If test successful, save the proxy URL
            useHostStore.setState((state) => ({
                proxy: {
                    url: url,
                    ignoredHosts: state.proxy?.ignoredHosts || [],
                },
            }))

            await message('The proxy has been saved!\n\nRestart the app to apply the changes.', {
                title: 'Proxy Saved',
                kind: 'info',
            })
        } catch (error) {
            const saveAnyway = await ask(
                `The proxy test failed. Do you want to save the URL anyway?\n\nError: ${error}`,
                {
                    title: 'Error',
                    kind: 'warning',
                    okLabel: 'Save Anyway',
                    cancelLabel: 'Cancel',
                }
            )

            if (saveAnyway) {
                useHostStore.setState((state) => ({
                    proxy: {
                        url: url,
                        ignoredHosts: state.proxy?.ignoredHosts || [],
                    },
                }))

                await message(
                    'The proxy has been saved!\n\nRestart the app to apply the changes.',
                    {
                        title: 'Proxy Saved',
                        kind: 'info',
                    }
                )
            }
        }
        setIsTestingProxy(false)
    }

    return (
        <BaseSection header={{ title: 'Proxy' }}>
            <div className="flex flex-row justify-center w-full gap-8 px-8">
                <div className="flex flex-col items-end flex-1 gap-2">
                    <h3 className="font-medium">Proxy URL</h3>
                    <p className="text-xs text-neutral-500 text-end">
                        Set the proxy server URL for network requests
                    </p>
                </div>

                <div className="flex flex-col w-3/5 gap-2">
                    <Input
                        placeholder="http://user:pass@address:port"
                        value={proxyUrl}
                        onChange={(e) => setProxyUrl(e.target.value)}
                        size="lg"
                        data-focus-visible="false"
                        autoCapitalize="off"
                        autoComplete="off"
                        autoCorrect="off"
                        spellCheck="false"
                    />

                    <div className="flex flex-row gap-2">
                        <Button
                            size="sm"
                            onPress={() => handleUpdateProxyUrl(proxyUrl)}
                            data-focus-visible="false"
                            isDisabled={!proxyUrl || isTestingProxy}
                            isLoading={isTestingProxy}
                            fullWidth={true}
                        >
                            {isTestingProxy ? 'Testing...' : 'Save Proxy URL'}
                        </Button>

                        {proxy?.url && (
                            <Button
                                size="sm"
                                color="danger"
                                variant="ghost"
                                onPress={() => {
                                    useHostStore.setState(() => ({
                                        proxy: undefined,
                                    }))
                                    setProxyUrl('')
                                }}
                                data-focus-visible="false"
                                isDisabled={isTestingProxy}
                            >
                                Clear
                            </Button>
                        )}
                    </div>
                </div>
            </div>

            <div className="flex flex-row justify-center w-full gap-8 px-8">
                <div className="flex flex-col items-end flex-1 gap-2">
                    <h3 className="font-medium">Ignored Hosts</h3>
                    <p className="text-xs text-neutral-500 text-end">
                        Hosts that should bypass the proxy server
                    </p>
                </div>

                <div className="flex flex-col w-3/5 gap-3">
                    <div className="flex flex-row gap-2">
                        <Input
                            placeholder="example.com"
                            value={newHost}
                            onChange={(e) => setNewHost(e.target.value)}
                            size="lg"
                            data-focus-visible="false"
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    handleAddHost(newHost)
                                }
                            }}
                            endContent={
                                <Button
                                    size="sm"
                                    onPress={() => handleAddHost(newHost)}
                                    data-focus-visible="false"
                                    isIconOnly={true}
                                    variant="faded"
                                    isDisabled={!proxyUrl}
                                >
                                    <PlusIcon className="w-5 h-5" />
                                </Button>
                            }
                            autoCapitalize="off"
                            autoComplete="off"
                            autoCorrect="off"
                            spellCheck="false"
                            isDisabled={!proxyUrl}
                        />
                    </div>

                    <div className="flex flex-col gap-2 overflow-y-auto rounded-medium max-h-96">
                        {ignoredHosts.map((host) => (
                            <div
                                key={host}
                                className="flex items-center justify-between p-2 pl-3.5 border rounded-medium border-divider bg-content2"
                            >
                                <span className="text-small">{host}</span>
                                <Button
                                    size="sm"
                                    color="danger"
                                    variant="light"
                                    isIconOnly={true}
                                    onPress={() => handleRemoveHost(host)}
                                    data-focus-visible="false"
                                >
                                    <Trash2Icon className="w-4 h-4" />
                                </Button>
                            </div>
                        ))}
                        {ignoredHosts.length === 0 && (
                            <p className="py-4 text-center text-small text-neutral-500">
                                No ignored hosts configured
                            </p>
                        )}
                    </div>
                </div>
            </div>
        </BaseSection>
    )
}
