import { startTransition, useEffect, useState } from 'react'
import { getRemoteName } from '../../lib/format'
import { getBackends, getRemote } from '../../lib/rclone/api'
import type { Backend } from '../../types/rclone'
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
    remoteOptionsJson,
    setRemoteOptionsJson,
    setRemoteOptionsLocked,
}: {
    selectedRemotes: string[]
    remoteOptionsLocked: boolean
    remoteOptionsJson: string
    setRemoteOptionsJson: (value: string) => void
    setRemoteOptionsLocked: (value: boolean) => void
}) {
    const [backends, setBackends] = useState<Backend[]>([])
    useEffect(() => {
        getBackends().then((b) => {
            startTransition(() => {
                setBackends(b)
            })
        })
    }, [])

    const uniqueRemotes = (() => {
        if (selectedRemotes.length === 0) return []
        const remotes = new Set<string>()

        for (const source of selectedRemotes) {
            const backend = getRemoteName(source)
            if (backend) {
                remotes.add(backend)
            }
        }

        return Array.from(remotes)
    })()

    console.log('[Copy] uniqueRemotes', uniqueRemotes)
    // console.log('[Copy] backends', backends)

    const getAvailableRemoteOptions = async () => {
        const mergedOptions = []
        const addedKeys = new Set<string>()

        for (const remote of uniqueRemotes) {
            const remoteInfo = await getRemote(remote)
            console.log('[Copy] remoteInfo', remoteInfo?.provider, remoteInfo?.type)

            if (remoteInfo.type === 's3') {
                if (remoteInfo.provider) {
                    const backendOptions =
                        backends.find((b) => b.Name === remoteInfo.type)?.Options || []
                    const providerOptions = backendOptions
                        .filter(
                            (o) =>
                                (!o.Provider || o.Provider.includes(remoteInfo.provider!)) &&
                                !IGNORED_OPTIONS.includes(o.Name) &&
                                !!o.Help
                        )
                        .map((o) => {
                            const newName = `s3_${o.Name}`
                            const newFieldName = o.FieldName ? `S3${o.FieldName}` : `s3_ ${o.Name}`
                            if (addedKeys.has(newName)) return null
                            addedKeys.add(newName)
                            return {
                                ...o,
                                Name: newName,
                                FieldName: newFieldName,
                            }
                        })
                        .filter(Boolean)
                    console.log('[Copy] providerOptions', providerOptions)
                    mergedOptions.push(...providerOptions)
                }
                continue
            }
            mergedOptions.push(
                ...(backends.find((b) => b.Name === remoteInfo.type)?.Options || [])
                    .filter((o) => !IGNORED_OPTIONS.includes(o.Name) && !!o.Help)
                    .map((o) => {
                        const newName = `${remoteInfo.type}_${o.Name}`
                        const newFieldName = o.FieldName
                            ? `${remoteInfo.type.toUpperCase()}${o.FieldName}`
                            : `${remoteInfo.type}_${o.Name}`
                        if (addedKeys.has(newName)) return null
                        addedKeys.add(newName)
                        return {
                            ...o,
                            Name: newName,
                            FieldName: newFieldName,
                        }
                    })
                    .filter(Boolean)
            )
        }

        return mergedOptions
    }

    return (
        <OptionsSection
            globalOptions={[]}
            optionsJson={remoteOptionsJson}
            setOptionsJson={setRemoteOptionsJson}
            getAvailableOptions={getAvailableRemoteOptions}
            isLocked={remoteOptionsLocked}
            setIsLocked={setRemoteOptionsLocked}
        />
    )
}
