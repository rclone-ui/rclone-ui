import { Button, Spinner, Textarea } from '@heroui/react'
import { useQuery } from '@tanstack/react-query'
import { getTauriVersion, getVersion as getUiVersion } from '@tauri-apps/api/app'
import {
    appDataDir,
    appLocalDataDir,
    appLogDir,
    downloadDir,
    homeDir,
    tempDir,
} from '@tauri-apps/api/path'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import { message } from '@tauri-apps/plugin-dialog'
import { readTextFileLines } from '@tauri-apps/plugin-fs'
import { openUrl, revealItemInDir } from '@tauri-apps/plugin-opener'
import { version as osVersion, type } from '@tauri-apps/plugin-os'
import { useMemo } from 'react'
import rclone from '../../../lib/rclone/client'
import { getDefaultPaths } from '../../../lib/rclone/common'
import { DOUBLE_BACKSLASH_REGEX } from '../../../lib/rclone/constants'
import { useHostStore } from '../../../store/host'
import BaseSection from './BaseSection'

export default function AboutSection() {
    const currentConfig = useHostStore((state) => state.activeConfigFile)

    const defaultPathsQuery = useQuery({
        queryKey: ['about', 'defaultPaths'],
        queryFn: async () => {
            return await getDefaultPaths()
        },
    })

    const cliVersionQuery = useQuery({
        queryKey: ['versions', 'cli', 'full'],
        queryFn: async () => await rclone('/core/version'),
    })

    const uiVersionQuery = useQuery({
        queryKey: ['versions', 'ui'],
        queryFn: async () => {
            const uiVersion = await getUiVersion()
            return uiVersion.endsWith('.0') ? uiVersion.slice(0, -2) : uiVersion
        },
    })

    const tauriVersionQuery = useQuery({
        queryKey: ['versions', 'tauri'],
        queryFn: async () => {
            return await getTauriVersion()
        },
    })

    const dirsQuery = useQuery({
        queryKey: ['about', 'dirs'],
        queryFn: async () => ({
            home: await homeDir(),
            appLocalData: await appLocalDataDir(),
            temp: await tempDir(),
            appLog: await appLogDir(),
            download: await downloadDir(),
            appData: await appDataDir(),
        }),
    })

    const info = useMemo(
        () => ({
            versions: {
                ...(cliVersionQuery.data ?? {}),
                ui: uiVersionQuery.data ?? '',
                tauri: tauriVersionQuery.data ?? '',
                osVersion: osVersion(),
                osFamily: type(),
            },
            paths: defaultPathsQuery.data,
            dirs: dirsQuery.data,
            config: {
                id: currentConfig?.id,
                label: currentConfig?.label,
                sync: currentConfig?.sync,
                isEncrypted: currentConfig?.isEncrypted,
            },
        }),
        [
            cliVersionQuery.data,
            uiVersionQuery.data,
            tauriVersionQuery.data,
            currentConfig,
            defaultPathsQuery.data,
            dirsQuery.data,
        ]
    )

    const logsQuery = useQuery({
        queryKey: ['last30LogLines'],
        queryFn: async () => {
            const logFilePath = info.dirs!.appLog + '/Rclone UI.log'
            const logLines = await readTextFileLines(logFilePath)

            const lines: string[] = []
            const iterator = logLines[Symbol.asyncIterator]()
            let result = await iterator.next()

            while (!result.done) {
                lines.push(result.value)
                if (lines.length > 35) {
                    lines.splice(0, 5)
                }
                result = await iterator.next()
            }

            return lines
        },
        enabled: !!info?.dirs?.appLog,
    })

    const jsonStringified = useMemo(
        () => (info ? JSON.stringify(info, null, 2).replace(DOUBLE_BACKSLASH_REGEX, '\\') : ''),
        [info]
    )

    return (
        <BaseSection header={{ title: 'About' }} className="-mt-2">
            {(dirsQuery.isLoading ||
                defaultPathsQuery.isLoading ||
                cliVersionQuery.isLoading ||
                uiVersionQuery.isLoading ||
                tauriVersionQuery.isLoading) && (
                <Spinner size="lg" color="secondary" className="py-20" />
            )}

            {info.paths && info.dirs && info.config && (
                <div className="flex flex-col px-4 gap-2.5">
                    <div className="flex flex-row justify-center w-full gap-2.5">
                        <Button
                            fullWidth={true}
                            color="primary"
                            onPress={async () => {
                                await openUrl('https://github.com/rclone-ui/rclone-ui/issues/18')
                            }}
                        >
                            Request Feature
                        </Button>
                        <Button
                            fullWidth={true}
                            color="secondary"
                            onPress={async () => {
                                if (!info.dirs?.appLog) {
                                    await message('No logs folder found', {
                                        title: 'Error',
                                        kind: 'warning',
                                        okLabel: 'OK',
                                    })
                                    return
                                }
                                await revealItemInDir(info.dirs.appLog + '/Rclone UI.log')
                            }}
                        >
                            Open Logs Folder
                        </Button>

                        <Button
                            fullWidth={true}
                            color="default"
                            onPress={async () => {
                                await writeText(jsonStringified)
                            }}
                        >
                            Copy Debug Info
                        </Button>
                        <Button
                            fullWidth={true}
                            color="danger"
                            onPress={async () => {
                                if (!info.dirs?.appLog) {
                                    await message('No logs folder found', {
                                        title: 'Error',
                                        kind: 'warning',
                                        okLabel: 'OK',
                                    })
                                    return
                                }

                                const body = `ENTER YOUR DESCRIPTION OF THE ISSUE HERE

							
Debug Info:
\`\`\`json
${jsonStringified}
\`\`\`

Logs (last 30 lines):
\`\`\`
${logsQuery.data?.join('\n')}
\`\`\`
`
                                openUrl(
                                    `https://github.com/rclone-ui/rclone-ui/issues/new?body=${encodeURIComponent(
                                        body
                                    )}`
                                )
                            }}
                        >
                            Open Github Issue
                        </Button>
                    </div>

                    <Textarea
                        value={jsonStringified}
                        size="lg"
                        label="Debug"
                        minRows={40}
                        maxRows={50}
                        disableAutosize={false}
                        isReadOnly={false}
                        variant="faded"
                        className="pb-10"
                        autoCapitalize="false"
                        autoComplete="false"
                        autoCorrect="false"
                        spellCheck="false"
                    />
                </div>
            )}
        </BaseSection>
    )
}
