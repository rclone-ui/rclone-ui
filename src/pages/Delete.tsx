import { Accordion, AccordionItem, Avatar, Button } from '@heroui/react'
import { message } from '@tauri-apps/plugin-dialog'
import {} from '@tauri-apps/plugin-fs'
import cronstrue from 'cronstrue'
import { AlertOctagonIcon, ClockIcon, FilterIcon, FoldersIcon, PlayIcon } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { getRemoteName } from '../../lib/format'
import { getFilterFlags, getGlobalFlags, startDelete } from '../../lib/rclone/api'
import { usePersistedStore } from '../../lib/store'
import CronEditor from '../components/CronEditor'
import OptionsSection from '../components/OptionsSection'
import { PathField } from '../components/PathFinder'

export default function Delete() {
    const [searchParams] = useSearchParams()

    const [sourceFs, setSourceFs] = useState<string | undefined>(
        searchParams.get('initialSource') ? searchParams.get('initialSource')! : undefined
    )
    // @ts-ignore
    const [rmDirs, setRmDirs] = useState(false)

    const [cronExpression, setCronExpression] = useState<string | null>(null)

    const [isStarted, setIsStarted] = useState(false)
    const [isLoading, setIsLoading] = useState(false)
    const [jsonError, setJsonError] = useState<'filter' | null>(null)

    const [filterOptionsLocked, setFilterOptionsLocked] = useState(false)
    const [filterOptions, setFilterOptions] = useState<Record<string, string>>({})
    const [filterOptionsJson, setFilterOptionsJson] = useState<string>('{}')

    const [globalOptions, setGlobalOptions] = useState<any[]>([])

    // biome-ignore lint/correctness/useExhaustiveDependencies: when unlocking, we don't want to re-run the effect
    useEffect(() => {
        const storeData = usePersistedStore.getState()

        const sourceRemote = getRemoteName(sourceFs?.[0])

        let mergedFilterDefaults = {}

        // Helper function to merge defaults from a remote
        const mergeRemoteDefaults = (remote: string | null) => {
            if (!remote || !(remote in storeData.remoteConfigList)) return

            const remoteConfig = storeData.remoteConfigList[remote]

            if (remoteConfig.filterDefaults) {
                mergedFilterDefaults = {
                    ...mergedFilterDefaults,
                    ...remoteConfig.filterDefaults,
                }
            }
        }

        // Only merge defaults for remote paths
        if (sourceRemote) mergeRemoteDefaults(sourceRemote)

        if (Object.keys(mergedFilterDefaults).length > 0 && !filterOptionsLocked) {
            setFilterOptionsJson(JSON.stringify(mergedFilterDefaults, null, 2))
        }
    }, [sourceFs])

    useEffect(() => {
        getGlobalFlags().then((flags) => setGlobalOptions(flags))
    }, [])

    useEffect(() => {
        try {
            setFilterOptions(JSON.parse(filterOptionsJson))

            setJsonError(null)
        } catch (error) {
            setJsonError('filter')
            console.error('Error parsing filter options:', error)
        }
    }, [filterOptionsJson])

    const handleStartDelete = useCallback(async () => {
        setIsLoading(true)

        if (!sourceFs) {
            await message('Please select a source path', {
                title: 'Error',
                kind: 'error',
            })
            return
        }

        if (cronExpression) {
            try {
                cronstrue.toString(cronExpression)
            } catch {
                await message('Invalid cron expression', {
                    title: 'Error',
                    kind: 'error',
                })
                setIsLoading(false)
                return
            }
            usePersistedStore.getState().addScheduledTask({
                'type': 'delete',
                'cron': cronExpression,
                'args': {
                    'fs': sourceFs,
                    'rmDirs': rmDirs,
                    '_filter': filterOptions,
                },
            })
        }

        try {
            await startDelete({
                fs: sourceFs,
                rmDirs,
                _filter: filterOptions,
            })

            setIsStarted(true)

            await message('Delete job started', {
                title: 'Success',
                okLabel: 'OK',
            })
        } catch (error) {
            await message(`Failed to start delete job, ${error}`, {
                title: 'Error',
                kind: 'error',
                okLabel: 'OK',
            })
        } finally {
            setIsLoading(false)
        }
    }, [sourceFs, filterOptions, rmDirs, cronExpression])

    const buttonText = useMemo(() => {
        if (isLoading) return 'STARTING...'
        if (!sourceFs || sourceFs.length === 0) return 'Please select a source path'
        if (jsonError) return 'Invalid JSON for ' + jsonError.toUpperCase() + ' options'
        return 'START DELETE'
    }, [isLoading, jsonError, sourceFs])

    const buttonIcon = useMemo(() => {
        if (isLoading) return
        if (!sourceFs || sourceFs.length === 0) return <FoldersIcon className="w-5 h-5" />
        if (jsonError) return <AlertOctagonIcon className="w-5 h-5" />
        return <PlayIcon className="w-5 h-5" />
    }, [isLoading, jsonError, sourceFs])

    return (
        <div className="flex flex-col h-screen gap-10 pt-10">
            {/* Main Content */}
            <div className="flex flex-col flex-1 w-full max-w-3xl gap-6 mx-auto">
                {/* Path Display */}
                <PathField
                    path={sourceFs || ''}
                    setPath={setSourceFs}
                    label="Path"
                    placeholder="Enter a remote:/path"
                    showPicker={false}
                />

                {/* <div className="flex flex-col gap-2 pt-2 -mb-5">
                    <Switch isSelected={rmDirs} onValueChange={setRmDirs}>
                        Delete empty source directories after delete
                    </Switch>
                </div> */}

                <Accordion>
                    <AccordionItem
                        key="filters"
                        startContent={
                            <Avatar color="danger" radius="lg" fallback={<FilterIcon />} />
                        }
                        indicator={<FilterIcon />}
                        subtitle="Tap to toggle filtering options for this operation"
                        title="Filters"
                    >
                        <OptionsSection
                            globalOptions={globalOptions['filter' as keyof typeof globalOptions]}
                            optionsJson={filterOptionsJson}
                            setOptionsJson={setFilterOptionsJson}
                            optionsFetcher={getFilterFlags}
                            rows={4}
                            isLocked={filterOptionsLocked}
                            setIsLocked={setFilterOptionsLocked}
                        />
                    </AccordionItem>
                    <AccordionItem
                        key="cron"
                        startContent={
                            <Avatar color="warning" radius="lg" fallback={<ClockIcon />} />
                        }
                        indicator={<ClockIcon />}
                        subtitle="Tap to toggle cron options for this operation"
                        title="Cron"
                    >
                        <CronEditor expression={cronExpression} onChange={setCronExpression} />
                    </AccordionItem>
                </Accordion>
            </div>

            <div className="sticky bottom-0 z-50 flex items-center justify-center flex-none gap-2 p-4 border-t border-neutral-500/20 bg-neutral-900/50 backdrop-blur-lg">
                {isStarted ? (
                    <>
                        <Button
                            fullWidth={true}
                            size="lg"
                            onPress={() => {
                                setFilterOptionsJson('{}')
                                setSourceFs(undefined)
                                setIsStarted(false)
                            }}
                            data-focus-visible="false"
                        >
                            New Delete
                        </Button>

                        {/* <Button
                            fullWidth={true}
                            size="lg"
                            color="primary"
                            onPress={async () => {
                                await openWindow({ name: 'Jobs', url: '/jobs' })
                                // await getCurrentWindow().hide()

                                // await getCurrentWindow().destroy()
                            }}
                            data-focus-visible="false"
                        >
                            Show Jobs
                        </Button> */}
                    </>
                ) : (
                    <Button
                        onPress={handleStartDelete}
                        size="lg"
                        fullWidth={true}
                        type="button"
                        color="primary"
                        isDisabled={isLoading || !!jsonError || !sourceFs || sourceFs.length === 0}
                        isLoading={isLoading}
                        endContent={buttonIcon}
                        className="max-w-2xl"
                        data-focus-visible="false"
                    >
                        {buttonText}
                    </Button>
                )}
            </div>
        </div>
    )
}
