import {
    Avatar,
    Button,
    Card,
    CardBody,
    Checkbox,
    Chip,
    Divider,
    Dropdown,
    DropdownItem,
    DropdownMenu,
    DropdownTrigger,
    Input,
    Spinner,
    Tab,
    Tabs,
    Textarea,
    Tooltip,
    cn,
} from '@heroui/react'
import * as Sentry from '@sentry/browser'
import { getTauriVersion, getVersion as getUiVersion } from '@tauri-apps/api/app'
import { invoke } from '@tauri-apps/api/core'
import {
    appDataDir,
    appLocalDataDir,
    appLogDir,
    downloadDir,
    homeDir,
    tempDir,
} from '@tauri-apps/api/path'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { disable, enable } from '@tauri-apps/plugin-autostart'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import { ask, message, open } from '@tauri-apps/plugin-dialog'
import { readTextFile, readTextFileLines, remove, writeTextFile } from '@tauri-apps/plugin-fs'
import { openUrl, revealItemInDir } from '@tauri-apps/plugin-opener'
import { version as osVersion, type } from '@tauri-apps/plugin-os'
import { relaunch } from '@tauri-apps/plugin-process'
import { type Update, check } from '@tauri-apps/plugin-updater'
import {
    CheckIcon,
    CodeIcon,
    CogIcon,
    DownloadIcon,
    EyeIcon,
    ImportIcon,
    InfoIcon,
    MedalIcon,
    PencilIcon,
    PlusIcon,
    SatelliteDishIcon,
    ServerIcon,
    Trash2Icon,
} from 'lucide-react'
import type React from 'react'
import {
    type DetailedHTMLProps,
    type HTMLAttributes,
    startTransition,
    useEffect,
    useRef,
    useState,
} from 'react'
import { revokeMachineLicense, validateLicense } from '../../lib/license'
import {
    deleteRemote,
    getVersion as getCliVersion,
    getRemote,
    getVersion,
} from '../../lib/rclone/api'
import {
    compareVersions,
    getConfigPath,
    getDefaultPaths,
    getRcloneVersion,
} from '../../lib/rclone/common'
import { DOUBLE_BACKSLASH_REGEX } from '../../lib/rclone/constants'
import { usePersistedStore, useStore } from '../../lib/store'
import { triggerTrayRebuild } from '../../lib/tray'
import ConfigCreateDrawer from '../components/ConfigCreateDrawer'
import ConfigEditDrawer from '../components/ConfigEditDrawer'
import ConfigSyncDrawer from '../components/ConfigSyncDrawer'
import RemoteCreateDrawer from '../components/RemoteCreateDrawer'
import RemoteDefaultsDrawer from '../components/RemoteDefaultsDrawer'
import RemoteEditDrawer from '../components/RemoteEditDrawer'

declare global {
    // biome-ignore lint/style/noNamespace: <explanation>
    namespace JSX {
        interface IntrinsicElements {
            'stripe-pricing-table': DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>
        }
    }
}

function Settings() {
    const settingsPass = usePersistedStore((state) => state.settingsPass)

    const [passwordCheckInput, setPasswordCheckInput] = useState('')
    const [passwordCheckPassed, setPasswordCheckPassed] = useState(false)
    const [passwordVisible, setPasswordVisible] = useState(false)

    const [uiVersion, setUiVersion] = useState('')
    const [cliVersion, setCliVersion] = useState('')

    useEffect(() => {
        Promise.all([getUiVersion(), getCliVersion()]).then(([uiVersion, cliVersion]) => {
            setUiVersion(uiVersion.endsWith('.0') ? uiVersion.slice(0, -2) : uiVersion)
            setCliVersion(cliVersion.version.replace('v', ''))
        })
    }, [])

    if (settingsPass && !passwordCheckPassed) {
        return (
            <div className="flex flex-col items-center justify-center w-screen h-screen gap-4 overflow-hidden animate-fade-in">
                <Input
                    placeholder="Enter pin or password"
                    value={passwordCheckInput}
                    onChange={(e) => setPasswordCheckInput(e.target.value)}
                    autoCapitalize="none"
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck="false"
                    type={passwordVisible ? 'text' : 'password'}
                    fullWidth={false}
                    size="lg"
                    endContent={
                        <Button
                            onPress={() => setPasswordVisible(!passwordVisible)}
                            isIconOnly={true}
                            variant="light"
                            data-focus-visible="false"
                        >
                            <EyeIcon className="w-5 h-5" />
                        </Button>
                    }
                />
                <Button
                    onPress={async () => {
                        if (passwordCheckInput === settingsPass) {
                            setPasswordCheckPassed(true)
                            return
                        }

                        await message('The password you entered is incorrect.', {
                            title: 'Login failed',
                            kind: 'error',
                        })
                    }}
                    data-focus-visible="false"
                    color="primary"
                >
                    Open
                </Button>
            </div>
        )
    }

    return (
        <div className="relative flex flex-col w-screen h-screen gap-0 overflow-hidden">
            <Tabs
                aria-label="Options"
                isVertical={true}
                variant="light"
                destroyInactiveTabPanel={false}
                disableAnimation={true}
                className="flex-shrink-0 w-40 h-screen px-2 py-4 border-r border-neutral-700"
                classNames={{
                    tabList: 'w-full gap-3',
                    tab: 'h-14 justify-start',
                    tabContent: 'pl-4',
                }}
                size="lg"
                defaultSelectedKey="general"
                color="secondary"
                radius="sm"
            >
                <Tab
                    key="general"
                    title={
                        <div className="flex items-center gap-2">
                            <CogIcon className="w-5 h-5" />
                            <span>General</span>
                        </div>
                    }
                    data-focus-visible="false"
                    className="w-full max-h-screen p-0 overflow-scroll overscroll-none"
                >
                    <GeneralSection />
                </Tab>
                <Tab
                    key="remotes"
                    title={
                        <div className="flex items-center gap-2">
                            <ServerIcon className="w-5 h-5" />
                            <span>Remotes</span>
                        </div>
                    }
                    data-focus-visible="false"
                    className="w-full max-h-screen p-0 overflow-scroll overscroll-none"
                >
                    <RemotesSection />
                </Tab>

                <Tab
                    key="config"
                    title={
                        <div className="flex items-center gap-2">
                            <CodeIcon className="w-5 h-5" />
                            <span>Config</span>
                        </div>
                    }
                    data-focus-visible="false"
                    className="w-full max-h-screen p-0 overflow-scroll overscroll-none"
                >
                    <ConfigSection />
                </Tab>
                <Tab
                    key="proxy"
                    title={
                        <div className="flex items-center gap-2">
                            <SatelliteDishIcon className="w-5 h-5" />
                            <span>Proxy</span>
                        </div>
                    }
                    data-focus-visible="false"
                    className="w-full max-h-screen p-0 overflow-scroll overscroll-none"
                >
                    <ProxySection />
                </Tab>
                <Tab
                    key="license"
                    title={
                        <div className="flex items-center gap-2">
                            <MedalIcon className="w-5 h-5" />
                            <span>License</span>
                        </div>
                    }
                    data-focus-visible="false"
                    className="w-full max-h-screen p-0 overflow-scroll overscroll-none"
                >
                    <LicenseSection />
                </Tab>
                <Tab
                    key="about"
                    title={
                        <div className="flex items-center gap-2">
                            <InfoIcon className="w-5 h-5" />
                            <span>About</span>
                        </div>
                    }
                    data-focus-visible="false"
                    className="w-full max-h-screen p-0 overflow-scroll overscroll-none"
                >
                    <AboutSection />
                </Tab>
                {/* <Tab
                    key="hosts"
                    title={
                        <div className="flex items-center gap-2">
                            <SwatchBookIcon className="w-5 h-5" />
                            <span>Hosts</span>
                        </div>
                    }
                    data-focus-visible="false"
                    className="w-full max-h-screen p-0 overflow-scroll overscroll-none"
                >
                    <div className="flex flex-col gap-4">
                        <BaseHeader title="Hosts" />
                    </div>
                </Tab> */}
            </Tabs>
            <div className="absolute bottom-0 left-0 flex flex-col w-40 h-12 gap-4 p-4 border-t border-r bg-neutral-900 border-neutral-700">
                <p
                    className="text-[10px] text-center text-neutral-500 hover:text-neutral-400 cursor-pointer"
                    onClick={() => openUrl('https://github.com/rclone-ui/rclone-ui')}
                >
                    UI v{uiVersion}, CLI v{cliVersion}
                </p>
            </div>
        </div>
    )
}

function GeneralSection() {
    const settingsPass = usePersistedStore((state) => state.settingsPass)
    const setSettingsPass = usePersistedStore((state) => state.setSettingsPass)
    const [passwordInput, setPasswordInput] = useState('')
    const [passwordVisible, setPasswordVisible] = useState(false)

    const disabledActions = usePersistedStore((state) => state.disabledActions)
    const setDisabledActions = usePersistedStore((state) => state.setDisabledActions)

    const startOnBoot = usePersistedStore((state) => state.startOnBoot)
    const setStartOnBoot = usePersistedStore((state) => state.setStartOnBoot)

    const [updateButtonText, setUpdateButtonText] = useState('Check for updates')
    const [isWorkingUpdate, setIsWorkingUpdate] = useState(false)
    const [update, setUpdate] = useState<Update | null>(null)

    const [showServe, setShowServe] = useState(false)

    async function updateCallback() {
        if (!update) {
            try {
                console.log('checking for updates')
                setIsWorkingUpdate(true)
                setUpdateButtonText('Checking...')
                let receivedUpdate: Update | null = null
                try {
                    receivedUpdate = await check({
                        allowDowngrades: true,
                        timeout: 30000,
                    })
                } catch (e) {
                    Sentry.captureException(e)
                    console.error(e)
                    setUpdateButtonText('Failed to check')
                    setIsWorkingUpdate(false)
                    return
                }
                console.log('receivedUpdate', JSON.stringify(receivedUpdate, null, 2))
                if (!receivedUpdate) {
                    setUpdateButtonText('Up to date')
                    setIsWorkingUpdate(false)
                    return
                }
                console.log(
                    `found update ${receivedUpdate.version} from ${receivedUpdate.date} with notes ${receivedUpdate.body}`
                )
                setUpdate(receivedUpdate)
                setUpdateButtonText('Tap to update')
            } catch (e) {
                Sentry.captureException(e)
                console.error(e)
            }
            setIsWorkingUpdate(false)
            return
        }

        setIsWorkingUpdate(true)
        setUpdateButtonText('Downloading...')

        try {
            let downloaded = 0
            let contentLength = 0

            await update.downloadAndInstall((event) => {
                // biome-ignore lint/style/useDefaultSwitchClause: <explanation>
                switch (event.event) {
                    case 'Started': {
                        contentLength = event.data.contentLength || 0
                        console.log(`started downloading ${event.data.contentLength} bytes`)
                        break
                    }
                    case 'Progress': {
                        downloaded += event.data.chunkLength
                        console.log(`downloaded ${downloaded} from ${contentLength}`)
                        break
                    }
                    case 'Finished':
                        console.log('download finished')
                        break
                }
            })
        } catch (error) {
            Sentry.captureException(error)
            console.error(error)
            setIsWorkingUpdate(false)
            setUpdateButtonText('Tap to retry')
            const wantsManualDownload = await ask(
                'An error occurred in the update process. Please try again or tap "Download" to download the update manually.',
                {
                    title: 'Update Error',
                    kind: 'error',
                    okLabel: 'Download',
                    cancelLabel: 'Cancel',
                }
            )

            if (wantsManualDownload) {
                await openUrl('https://github.com/rclone-ui/rclone-ui/releases/latest')
            }

            return
        }

        const answer = await ask('Update installed. Ready to restart?', {
            title: 'Update',
            kind: 'info',
            okLabel: 'Restart',
            cancelLabel: 'Later',
        })

        if (!answer) {
            return
        }

        await getCurrentWindow().emit('relaunch-app')
    }

    function updateDisabledActions({
        name,
        value,
    }: { name: (typeof disabledActions)[number]; value: boolean }) {
        if (value) {
            setDisabledActions(disabledActions?.filter((action) => action !== name) || [])
        } else {
            setDisabledActions([...(disabledActions || []), name])
        }
        triggerTrayRebuild()
    }

    useEffect(() => {
        // needed since the first value from the persisted store is undefined
        setPasswordInput(settingsPass || '')
    }, [settingsPass])

    useEffect(() => {
        getRcloneVersion().then((version) => {
            if (version?.yours && compareVersions(version.yours, '1.70.0') === 1) {
                setShowServe(true)
            }
        })
    }, [])

    return (
        <BaseSection header={{ title: 'General' }}>
            <div className="flex flex-row justify-center w-full gap-8 px-8">
                <div className="flex flex-col items-end flex-1 gap-2 bg-transparent-500">
                    <h3 className="font-medium">Password</h3>

                    <p className="text-xs text-neutral-500 text-end">
                        Set a password to protect this settings panel
                    </p>
                </div>

                <div className="flex flex-col w-3/5 gap-2 bg-transparent-500">
                    <Input
                        placeholder="Enter password"
                        value={passwordInput}
                        onChange={(e) => setPasswordInput(e.target.value)}
                        size="lg"
                        autoCapitalize="none"
                        autoComplete="off"
                        autoCorrect="off"
                        spellCheck="false"
                        type={passwordVisible ? 'text' : 'password'}
                        endContent={
                            passwordInput && (
                                <Button
                                    onPress={() => setPasswordVisible(!passwordVisible)}
                                    isIconOnly={true}
                                    variant="light"
                                    data-focus-visible="false"
                                >
                                    <EyeIcon className="w-5 h-5" />
                                </Button>
                            )
                        }
                        data-focus-visible="false"
                    />

                    <div className="flex flex-row gap-2">
                        <Button
                            size="sm"
                            fullWidth={true}
                            onPress={async () => {
                                setSettingsPass(passwordInput)
                            }}
                            data-focus-visible="false"
                        >
                            Change password
                        </Button>

                        <Button
                            size="sm"
                            color="danger"
                            fullWidth={true}
                            onPress={async () => {
                                setPasswordInput('')
                                setSettingsPass(undefined)
                            }}
                            data-focus-visible="false"
                        >
                            Remove password
                        </Button>
                    </div>
                </div>
            </div>

            <div className="flex flex-row justify-center w-full gap-8 px-8">
                <div className="flex flex-col items-end flex-grow gap-2 bg-transparent-500">
                    <h3 className="font-medium">Options</h3>
                </div>

                <div className="flex flex-col w-3/5 gap-3 bg-transparent-500">
                    <Checkbox
                        isSelected={startOnBoot}
                        onValueChange={async (value) => {
                            // if (!licenseValid) {
                            //     await message('Community version does not support start on boot.', {
                            //         title: 'Missing license',
                            //         kind: 'error',
                            //     })
                            //     return
                            // }

                            try {
                                setStartOnBoot(value)

                                if (value) {
                                    await enable()
                                } else {
                                    await disable()
                                }
                            } catch (error) {
                                setStartOnBoot(!value)
                                await message(
                                    `An error occurred while toggling start on boot. ${error}`,
                                    {
                                        title: 'Error',
                                        kind: 'error',
                                    }
                                )
                            }
                        }}
                    >
                        <div className="flex flex-row gap-2">
                            <p>Start on boot</p>
                            <Chip size="sm" color="primary">
                                New
                            </Chip>
                        </div>
                    </Checkbox>

                    <Checkbox
                        isSelected={!disabledActions?.includes('tray-mount')}
                        onValueChange={(value) =>
                            updateDisabledActions({ name: 'tray-mount', value })
                        }
                    >
                        Show <span className="font-mono text-blue-300">Mount</span> option
                    </Checkbox>
                    <Checkbox
                        isSelected={!disabledActions?.includes('tray-sync')}
                        onValueChange={(value) =>
                            updateDisabledActions({ name: 'tray-sync', value })
                        }
                    >
                        Show <span className="font-mono text-blue-300">Sync</span> option
                    </Checkbox>
                    <Checkbox
                        isSelected={!disabledActions?.includes('tray-copy')}
                        onValueChange={(value) =>
                            updateDisabledActions({ name: 'tray-copy', value })
                        }
                    >
                        Show <span className="font-mono text-blue-300">Copy</span> option
                    </Checkbox>
                    <Checkbox
                        isSelected={!disabledActions?.includes('tray-bisync')}
                        onValueChange={(value) =>
                            updateDisabledActions({ name: 'tray-bisync', value })
                        }
                    >
                        Show <span className="font-mono text-blue-300">Bisync</span> option
                    </Checkbox>
                    <Checkbox
                        isSelected={!disabledActions?.includes('tray-move')}
                        onValueChange={(value) =>
                            updateDisabledActions({ name: 'tray-move', value })
                        }
                    >
                        Show <span className="font-mono text-blue-300">Move</span> option
                    </Checkbox>
                    <Checkbox
                        isSelected={!disabledActions?.includes('tray-download')}
                        onValueChange={(value) =>
                            updateDisabledActions({ name: 'tray-download', value })
                        }
                    >
                        Show <span className="font-mono text-blue-300">Download</span> option
                    </Checkbox>
                    <Checkbox
                        isSelected={!disabledActions?.includes('tray-serve')}
                        onValueChange={(value) =>
                            updateDisabledActions({ name: 'tray-serve', value })
                        }
                        isDisabled={!showServe}
                    >
                        Show <span className="font-mono text-blue-300">Serve</span> option
                    </Checkbox>
                    <Checkbox
                        isSelected={!disabledActions?.includes('tray-purge')}
                        onValueChange={(value) =>
                            updateDisabledActions({ name: 'tray-purge', value })
                        }
                    >
                        Show <span className="font-mono text-blue-300">Purge</span> option
                    </Checkbox>
                    <Checkbox
                        isSelected={!disabledActions?.includes('tray-delete')}
                        onValueChange={(value) =>
                            updateDisabledActions({ name: 'tray-delete', value })
                        }
                    >
                        Show <span className="font-mono text-blue-300">Delete</span> option
                    </Checkbox>
                </div>
            </div>

            <div className="flex flex-row justify-center w-full gap-8 px-8">
                <div className="flex flex-col items-end flex-grow gap-2 bg-transparent-500">
                    <h3 className="font-medium">Update</h3>
                </div>

                <div className="flex flex-col w-3/5 gap-3 bg-transparent-500">
                    <Button isLoading={isWorkingUpdate} onPress={updateCallback}>
                        {updateButtonText}
                    </Button>
                </div>
            </div>
        </BaseSection>
    )
}

function LicenseSection() {
    const [isLicenseEditable, setIsLicenseEditable] = useState(false)
    const licenseKey = usePersistedStore((state) => state.licenseKey)
    const licenseValid = usePersistedStore((state) => state.licenseValid)

    const [isRevoking, setIsRevoking] = useState(false)
    const [isActivating, setIsActivating] = useState(false)
    const [licenseKeyInput, setLicenseKeyInput] = useState('')

    const [showPricingTable, setShowPricingTable] = useState(false)

    useEffect(() => {
        setLicenseKeyInput(licenseKey || '')
        setIsLicenseEditable(!licenseKey)
    }, [licenseKey])

    useEffect(() => {
        const script = document.createElement('script')
        script.src = 'https://js.stripe.com/v3/pricing-table.js'
        script.async = true
        document.body.appendChild(script)
        const cancelTimeout = setTimeout(() => {
            setShowPricingTable(true)
        }, 1000)
        return () => {
            clearTimeout(cancelTimeout)
            setShowPricingTable(false)
            document.body.removeChild(script)
        }
    }, [])

    return (
        <BaseSection
            header={{
                title: 'License',
                endContent: licenseValid ? (
                    <p className="text-large">❤️‍🔥</p>
                ) : (
                    <Tooltip
                        className="max-w-[200px]"
                        content="Why? To unlock extra features not available in rclone, and turbo-charge development ♥️"
                    >
                        <Button
                            isIconOnly={true}
                            variant="light"
                            color="primary"
                            data-focus-visible="false"
                        >
                            <InfoIcon className="w-5 h-5" />
                        </Button>
                    </Tooltip>
                ),
            }}
        >
            <div className="flex flex-row justify-center w-full gap-2 px-8 -mt-2">
                <Input
                    placeholder="Enter license key"
                    value={licenseKeyInput}
                    onChange={(e) => setLicenseKeyInput(e.target.value)}
                    size="lg"
                    isDisabled={!isLicenseEditable || isActivating}
                    autoCapitalize="none"
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck="false"
                    endContent={licenseValid && <CheckIcon className="w-5 h-5 text-success" />}
                    data-focus-visible="false"
                    fullWidth={true}
                />

                {!licenseValid && (
                    <Button
                        isLoading={isActivating}
                        size="lg"
                        onPress={async () => {
                            if (!licenseKeyInput) {
                                await message('Please enter a license key', {
                                    title: 'Error',
                                    kind: 'error',
                                })
                                return
                            }
                            setIsActivating(true)
                            try {
                                await validateLicense(licenseKeyInput)
                            } catch (e) {
                                if (e instanceof Error) {
                                    await message(e.message, {
                                        title: 'Error',
                                        kind: 'error',
                                        okLabel: 'Ok',
                                    })
                                    return
                                }

                                await message('An error occurred. Please try again.', {
                                    title: 'Error',
                                    kind: 'error',
                                    okLabel: 'Ok',
                                })
                            }
                            setIsActivating(false)

                            await message('Your license has been successfully activated.', {
                                title: 'Congrats!',
                                kind: 'info',
                            })
                        }}
                        data-focus-visible="false"
                    >
                        Activate
                    </Button>
                )}
                {licenseValid && (
                    <Button
                        isLoading={isRevoking}
                        color="danger"
                        variant="ghost"
                        size="lg"
                        onPress={async () => {
                            // usePersistedStore.setState({
                            //     licenseKey: undefined,
                            //     licenseValid: false,
                            // })
                            // return

                            const answer = await ask(
                                'Are you sure you want to deactivate your license? You can always activate it again later.',
                                {
                                    title: 'Deactivate License',
                                    kind: 'warning',
                                }
                            )

                            if (!answer) {
                                return
                            }

                            setIsRevoking(true)
                            try {
                                await revokeMachineLicense(licenseKeyInput)
                            } catch (e) {
                                if (e instanceof Error) {
                                    await message(e.message, {
                                        title: 'Error',
                                        kind: 'error',
                                        okLabel: 'Ok',
                                    })
                                    return
                                }

                                await message('An error occurred. Please try again.', {
                                    title: 'Error',
                                    kind: 'error',
                                    okLabel: 'Ok',
                                })
                            }
                            setIsRevoking(false)

                            await message('Your license has been successfully deactivated.', {
                                title: 'License deactivated',
                                kind: 'info',
                            })
                        }}
                        data-focus-visible="false"
                    >
                        Deactivate
                    </Button>
                )}
            </div>

            <Divider />

            <div
                className={cn(
                    'w-full overflow-hidden border-0 border-red-500 left-28 h-[485px] opacity-0 transition-opacity duration-300 ease-in-out',
                    showPricingTable && 'opacity-100'
                )}
            >
                <stripe-pricing-table
                    pricing-table-id="prctbl_1RvnumE0hPdsH0naQ6l8Rd86"
                    publishable-key="pk_live_51QmUqyE0hPdsH0naBICHzb0j5O5eTKyYnY72nOaS6aT99y3EBeCOyeihI2xX05D6cczifqPsX6vHhor8ozSblXPl00LqNwMxBE"
                />
            </div>
        </BaseSection>
    )
}

function RemotesSection() {
    const licenseValid = usePersistedStore((state) => state.licenseValid)

    const remotes = useStore((state) => state.remotes)
    const removeRemote = useStore((state) => state.removeRemote)

    const [pickedRemote, setPickedRemote] = useState<string | null>(null)

    const [editingDrawerOpen, setEditingDrawerOpen] = useState(false)
    const [creatingDrawerOpen, setCreatingDrawerOpen] = useState(false)
    const [defaultsDrawerOpen, setDefaultsDrawerOpen] = useState(false)

    if (remotes.length === 0 && !creatingDrawerOpen) {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen gap-4">
                <h1 className="text-2xl font-bold">No remotes found</h1>
                <Button
                    onPress={() => setCreatingDrawerOpen(true)}
                    color="primary"
                    data-focus-visible="false"
                    variant="shadow"
                    size="lg"
                >
                    Create Remote
                </Button>
            </div>
        )
    }

    return (
        <BaseSection
            header={{
                title: 'Remotes',
                endContent: (
                    <Button
                        onPress={async () => {
                            if (!licenseValid && remotes.length >= 4) {
                                await message(
                                    'Community version does not support adding more than 4 remotes.',
                                    {
                                        title: 'Missing license',
                                        kind: 'error',
                                    }
                                )
                                return
                            }

                            setCreatingDrawerOpen(true)
                        }}
                        isIconOnly={true}
                        variant="faded"
                        color="primary"
                        data-focus-visible="false"
                        size="sm"
                    >
                        <PlusIcon className="w-4 h-4" />
                    </Button>
                ),
            }}
        >
            <div className="flex flex-col gap-2.5 px-4 pb-10">
                {remotes.map((remote) => (
                    <RemoteCard
                        key={remote}
                        remote={remote}
                        onDefaultsPress={() => {
                            setPickedRemote(remote)
                            setDefaultsDrawerOpen(true)
                        }}
                        onConfigPress={() => {
                            setPickedRemote(remote)
                            setEditingDrawerOpen(true)
                        }}
                        onDeletePress={async () => {
                            const confirmation = await ask(
                                `Are you sure you want to remove ${remote}? This action cannot be reverted.`,
                                { title: `Removing ${remote}`, kind: 'warning' }
                            )

                            if (!confirmation) {
                                return
                            }

                            await deleteRemote(remote)
                            removeRemote(remote)
                            await triggerTrayRebuild()
                        }}
                    />
                ))}
            </div>

            {pickedRemote && (
                <RemoteEditDrawer
                    isOpen={editingDrawerOpen}
                    onClose={() => {
                        setEditingDrawerOpen(false)
                        setTimeout(() => {
                            // allow for drawer effect to happen
                            setPickedRemote(null)
                        }, 100)
                    }}
                    remoteName={pickedRemote}
                />
            )}

            <RemoteCreateDrawer
                isOpen={creatingDrawerOpen}
                onClose={() => {
                    startTransition(() => {
                        setCreatingDrawerOpen(false)
                    })
                }}
            />

            {pickedRemote && (
                <RemoteDefaultsDrawer
                    isOpen={defaultsDrawerOpen}
                    onClose={() => {
                        startTransition(() => {
                            setDefaultsDrawerOpen(false)
                            setTimeout(() => {
                                // allow for drawer effect to happen
                                setPickedRemote(null)
                            }, 100)
                        })
                    }}
                    remoteName={pickedRemote}
                />
            )}
        </BaseSection>
    )
}

function RemoteCard({
    remote,
    onDefaultsPress,
    onConfigPress,
    onDeletePress,
}: {
    remote: string
    onDefaultsPress: () => void
    onConfigPress: () => void
    onDeletePress: () => void
}) {
    const [type, setType] = useState<string | null>(null)
    const [provider, setProvider] = useState<string | null>(null)

    const imageUrl =
        provider && !type ? `/icons/providers/${provider}.png` : `/icons/backends/${type}.png`

    useEffect(() => {
        const loadRemoteConfig = async () => {
            try {
                const remoteInfo = await getRemote(remote)
                setType(remoteInfo.type)
                if (remoteInfo.provider) {
                    setProvider(remoteInfo.provider)
                }
            } catch (error) {
                console.error('[RemoteCard] Failed to load remote config:', error)
            }
        }
        loadRemoteConfig()
    }, [remote])

    return (
        <Card
            key={remote}
            shadow="sm"
            isBlurred={true}
            className="h-20 border-none bg-background/60 dark:bg-content2/90"
            isPressable={true}
            onPress={onConfigPress}
        >
            <CardBody>
                <div className="flex items-center justify-between h-full">
                    <div className="flex items-center gap-4">
                        <img src={imageUrl} className="object-contain w-10 h-10" alt={remote} />
                        <p className="text-large">{remote}</p>
                    </div>
                    <div className="flex flex-row items-center gap-2">
                        <Button
                            onPress={onDefaultsPress}
                            // isIconOnly={true}
                            color="primary"
                            variant="flat"
                            data-focus-visible="false"
                        >
                            {/* <CableIcon className="w-4 h-4" /> */}
                            Edit Defaults
                        </Button>
                        <Button
                            onPress={onConfigPress}
                            // isIconOnly={true}
                            // color="primary"
                            variant="bordered"
                            data-focus-visible="false"
                        >
                            {/* <PencilIcon className="w-4 h-4" /> */}
                            Config
                        </Button>
                        <Button
                            isIconOnly={true}
                            color="danger"
                            variant="light"
                            size="sm"
                            onPress={onDeletePress}
                            data-focus-visible="false"
                        >
                            <Trash2Icon className="w-4 h-4" />
                        </Button>
                    </div>
                </div>
            </CardBody>
        </Card>
    )
}

function ConfigSection() {
    const licenseValid = usePersistedStore((state) => state.licenseValid)

    const configFiles = usePersistedStore((state) => state.configFiles)
    const activeConfigFile = usePersistedStore((state) => state.activeConfigFile)

    const [isCreateDrawerOpen, setIsCreateDrawerOpen] = useState(false)
    const [isSyncDrawerOpen, setIsSyncDrawerOpen] = useState(false)
    const [isEditDrawerOpen, setIsEditDrawerOpen] = useState(false)
    const [focusedConfigId, setFocusedConfigId] = useState<string | null>(null)

    const [isExportingId, setIsExportingId] = useState('')

    async function exportConfig({ id, label }: { id: string; label: string }) {
        setIsExportingId(id)
        try {
            const configPath = await getConfigPath({ id: id, validate: true })
            const text = await readTextFile(configPath)

            await getCurrentWindow().setFocus()
            const selectedPath = await open({
                title: `Select a directory to export "${label}"`,
                multiple: false,
                directory: true,
            })

            if (!selectedPath) {
                return
            }

            console.log('[exportConfig] selectedPath', selectedPath)

            // allow spaces, dashes, and underscores
            const exportPath = `${selectedPath}/${label.replace(/[^a-zA-Z0-9\s\-_]/g, '')}.conf`

            await writeTextFile(exportPath, text)
        } catch (error) {
            console.error('[exportConfig] failed to export config', error)
            await message(error instanceof Error ? error.message : 'An unknown error occurred', {
                title: 'Failed to export config',
                kind: 'error',
                okLabel: 'OK',
            })
        }
        setIsExportingId('')
    }

    return (
        <BaseSection
            header={{
                title: 'Config',
                endContent: (
                    <Dropdown>
                        <DropdownTrigger>
                            <Button variant="faded" color="primary" data-focus-visible="false">
                                Add Config
                            </Button>
                        </DropdownTrigger>
                        <DropdownMenu
                            onAction={(key) => {
                                setTimeout(async () => {
                                    if (key === 'import') {
                                        setIsCreateDrawerOpen(true)
                                    } else {
                                        if (!licenseValid) {
                                            await message(
                                                'Community version does not support syncing configs.\n\nIf you do not wish to update it outside of Rclone UI, you can simply import.',
                                                {
                                                    title: 'Missing license',
                                                    kind: 'error',
                                                }
                                            )
                                            return
                                        }
                                        setIsSyncDrawerOpen(true)
                                    }
                                }, 100)
                            }}
                            variant="faded"
                        >
                            <DropdownItem
                                key="import"
                                description="Edit using the CLI or UI"
                                startContent={<PlusIcon />}
                            >
                                Import Config
                            </DropdownItem>
                            <DropdownItem
                                key="sync"
                                description="Update using Git or similar"
                                startContent={<ImportIcon />}
                            >
                                Sync Config
                            </DropdownItem>
                        </DropdownMenu>
                    </Dropdown>
                ),
            }}
        >
            <div className="flex flex-col gap-2.5 px-4">
                {configFiles.map((configFile, configFileIndex) => (
                    <Card
                        key={configFile.id}
                        isPressable={true}
                        className={`h-24 gap-2 bg-content2 ${configFile.id === activeConfigFile?.id ? 'border-2 border-primary' : ''}`}
                        // color={configFile.id === activeConfigFile?.id ? 'primary' : 'default'}
                        onPress={() => {
                            if (configFile.id === activeConfigFile?.id) {
                                return
                            }

                            setTimeout(async () => {
                                const confirmed = await ask(
                                    'This will cancel any active jobs or transfers and restart the app',
                                    {
                                        title: `Switch to config ${configFile.label}?`,
                                        kind: 'info',
                                        okLabel: 'OK',
                                        cancelLabel: 'Cancel',
                                    }
                                )

                                if (!confirmed) {
                                    return
                                }

                                usePersistedStore.getState().setActiveConfigFile(configFile.id!)
                                await new Promise((resolve) => setTimeout(resolve, 500))

                                await relaunch()
                            }, 100)
                        }}
                    >
                        <CardBody className="flex flex-row items-center justify-start w-full gap-2.5">
                            <Avatar
                                fallback={`#${configFileIndex + 1}`}
                                size="lg"
                                color={'default'}
                            />
                            <div className="flex flex-col gap-1">
                                <p className="text-large">{configFile.label}</p>
                                <div className="flex flex-row gap-2">
                                    {configFile.id === activeConfigFile?.id && (
                                        <Chip color="primary" size="sm">
                                            ACTIVE
                                        </Chip>
                                    )}
                                    {!!configFile.sync && <Chip size="sm">SYNCED</Chip>}
                                    {configFile.isEncrypted && (
                                        <Chip color="success" size="sm">
                                            ENCRYPTED
                                        </Chip>
                                    )}
                                    {!configFile.isEncrypted && (
                                        <Chip color="warning" size="sm">
                                            UNENCRYPTED
                                        </Chip>
                                    )}
                                </div>
                            </div>
                            <div className="flex-1" />
                            <div className="flex flex-row items-center gap-2">
                                <Button
                                    isIconOnly={true}
                                    variant="light"
                                    size="lg"
                                    onPress={() => {
                                        setFocusedConfigId(configFile.id!)
                                        setIsEditDrawerOpen(true)
                                    }}
                                    isDisabled={
                                        configFile.id === 'default' ||
                                        configFile.id === activeConfigFile?.id ||
                                        Boolean(configFile.sync)
                                    }
                                >
                                    <PencilIcon className="w-5 h-5" />
                                </Button>
                                <Button
                                    isIconOnly={true}
                                    variant="light"
                                    size="lg"
                                    onPress={() => {
                                        setTimeout(async () => {
                                            const confirmed = await ask(
                                                `Are you sure you want to delete config ${configFile.label}?`,
                                                {
                                                    title: 'Delete Config',
                                                    kind: 'warning',
                                                    okLabel: 'Delete',
                                                    cancelLabel: 'Cancel',
                                                }
                                            )

                                            if (!confirmed) {
                                                return
                                            }

                                            if (configFile.id === 'default') {
                                                await message('Default config cannot be deleted', {
                                                    title: 'Error',
                                                    kind: 'warning',
                                                    okLabel: 'OK',
                                                })
                                                return
                                            }

                                            if (!configFile.sync) {
                                                const path = await getConfigPath({
                                                    id: configFile.id!,
                                                    validate: true,
                                                })

                                                await remove(path.replace('rclone.conf', ''), {
                                                    recursive: true,
                                                })
                                            }

                                            if (activeConfigFile?.id === configFile.id) {
                                                usePersistedStore
                                                    .getState()
                                                    .setActiveConfigFile('default')
                                            }

                                            usePersistedStore
                                                .getState()
                                                .removeConfigFile(configFile.id!)
                                        }, 100)
                                    }}
                                    isDisabled={configFile.id === 'default'}
                                >
                                    <Trash2Icon className="w-5 h-5" />
                                </Button>
                                <Button
                                    isIconOnly={true}
                                    variant="light"
                                    size="lg"
                                    onPress={() => {
                                        exportConfig({
                                            id: configFile.id!,
                                            label: configFile.label,
                                        })
                                    }}
                                    isLoading={isExportingId === configFile.id}
                                >
                                    <DownloadIcon className="w-5 h-5" />
                                </Button>
                            </div>
                        </CardBody>
                    </Card>
                ))}
            </div>

            <ConfigCreateDrawer
                isOpen={isCreateDrawerOpen}
                onClose={() => {
                    setIsCreateDrawerOpen(false)
                }}
            />

            <ConfigEditDrawer
                isOpen={isEditDrawerOpen}
                onClose={() => {
                    setIsEditDrawerOpen(false)
                    setFocusedConfigId(null)
                }}
                id={focusedConfigId}
            />

            <ConfigSyncDrawer
                isOpen={isSyncDrawerOpen}
                onClose={() => {
                    setIsSyncDrawerOpen(false)
                }}
            />
        </BaseSection>
    )
}

function AboutSection() {
    const currentConfig = usePersistedStore((state) => state.activeConfigFile)
    const [info, setInfo] = useState<{ versions: any; paths: any; config: any; dirs: any } | null>(
        null
    )

    const isLoadingLogs = useRef(false)
    const [last30Lines, setLast30Lines] = useState<string[]>([])

    const jsonStringified = info
        ? JSON.stringify(info, null, 2).replace(DOUBLE_BACKSLASH_REGEX, '\\')
        : ''

    async function fetchInfo() {
        if (!currentConfig) return
        const defaultPaths = await getDefaultPaths()
        const version = await getVersion()
        const dirs = {
            home: await homeDir(),
            appLocalData: await appLocalDataDir(),
            temp: await tempDir(),
            appLog: await appLogDir(),
            download: await downloadDir(),
            appData: await appDataDir(),
        }
        return {
            versions: {
                ...version,
                ui: await getUiVersion(),
                tauri: await getTauriVersion(),
                osVersion: osVersion(),
                osFamily: type(),
            },
            paths: defaultPaths,
            dirs,
            config: {
                id: currentConfig.id,
                label: currentConfig.label,
                sync: currentConfig.sync,
                isEncrypted: currentConfig.isEncrypted,
            },
        }
    }

    async function fetchLogs(logFilePath: string) {
        if (isLoadingLogs.current) {
            return []
        }
        isLoadingLogs.current = true
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

        isLoadingLogs.current = false
        return lines
    }

    useEffect(() => {
        if (!currentConfig) return
        fetchInfo().then((info) => setInfo(info || null))
        // biome-ignore lint/correctness/useExhaustiveDependencies: <compiler>
    }, [fetchInfo, currentConfig])

    useEffect(() => {
        if (!info) {
            return
        }
        if (last30Lines.length > 0) {
            return
        }
        fetchLogs(info.dirs.appLog + '/Rclone UI.log').then(setLast30Lines)
        // biome-ignore lint/correctness/useExhaustiveDependencies: <compiler>
    }, [fetchLogs, info, last30Lines.length])

    return (
        <BaseSection header={{ title: 'About' }} className="-mt-2">
            {!info && <Spinner size="lg" color="secondary" className="py-20" />}

            {info && (
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
                                if (!info || !info.dirs.appLog) {
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
                                if (!info || !info.dirs.appLog) {
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
${last30Lines.join('\n')}
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
                        maxRows={40}
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

function ProxySection() {
    const proxy = usePersistedStore((state) => state.proxy)

    const [proxyUrl, setProxyUrl] = useState('')
    const [newHost, setNewHost] = useState('')
    const [isTestingProxy, setIsTestingProxy] = useState(false)

    useEffect(() => {
        setProxyUrl(proxy?.url || '')
    }, [proxy?.url])

    const ignoredHosts = proxy?.ignoredHosts || []

    const handleAddHost = (host: string) => {
        if (host.trim() && !ignoredHosts.includes(host.trim())) {
            // updateProxy({ hosts: [...ignoredHosts, newHost.trim()] })
            usePersistedStore.setState((state) => ({
                proxy: {
                    url: state.proxy?.url || '',
                    ignoredHosts: [...(state.proxy?.ignoredHosts || []), newHost.trim()],
                },
            }))
            setNewHost('')
        }
    }

    const handleRemoveHost = (hostToRemove: string) => {
        // updateProxy({ hosts: ignoredHosts.filter((host) => host !== hostToRemove) })
        usePersistedStore.setState((state) => ({
            proxy: {
                url: state.proxy?.url || '',
                ignoredHosts: ignoredHosts.filter((host) => host !== hostToRemove),
            },
        }))
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
            const result = await invoke<string>('test_proxy_connection', { proxy_url: url })

            // If test successful, save the proxy URL
            usePersistedStore.setState((state) => ({
                proxy: {
                    url: url,
                    ignoredHosts: state.proxy?.ignoredHosts || [],
                },
            }))

            await message(`Proxy test successful! ${result}`, {
                title: 'Proxy Connected',
                kind: 'info',
            })
        } catch (error) {
            const saveAnyway = await ask(
                `Test failed, do you want to save the URL anyway?\n\nError: ${error}`,
                {
                    title: 'Error',
                    kind: 'warning',
                    okLabel: 'Save Anyway',
                    cancelLabel: 'Cancel',
                }
            )

            if (saveAnyway) {
                usePersistedStore.setState((state) => ({
                    proxy: {
                        url: url,
                        ignoredHosts: state.proxy?.ignoredHosts || [],
                    },
                }))
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
                                    usePersistedStore.setState(() => ({
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

function BaseSection({
    children,
    header,
    className,
}: { children: React.ReactNode; header: Parameters<typeof BaseHeader>[0]; className?: string }) {
    return (
        <div className="flex flex-col gap-8">
            <BaseHeader {...header} />
            <div className={cn('flex flex-col gap-10', className)}>{children}</div>
        </div>
    )
}

function BaseHeader({ title, endContent }: { title: string; endContent?: React.ReactNode }) {
    return (
        <div className="sticky top-0 z-50 flex items-center justify-between p-4 h-14 bg-neutral-900/50 backdrop-blur-lg">
            <h2 className="text-xl font-semibold">{title}</h2>
            {endContent}
        </div>
    )
}

export default Settings
