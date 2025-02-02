import { Button, Card, CardBody, Checkbox, Chip, Input, Tab, Tabs } from '@nextui-org/react'
import { ask, message } from '@tauri-apps/plugin-dialog'
import { openUrl } from '@tauri-apps/plugin-opener'
import { relaunch } from '@tauri-apps/plugin-process'
import { type Update, check } from '@tauri-apps/plugin-updater'
import {
    CheckIcon,
    CogIcon,
    EyeIcon,
    MedalIcon,
    PlusIcon,
    ServerIcon,
    Trash2Icon,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { revokeLicense, validateLicense } from '../../lib/license'
import { deleteRemote } from '../../lib/rclone/api'
import { usePersistedStore, useStore } from '../../lib/store'
import { triggerTrayRebuild } from '../../lib/tray'
import RemoteCreateDrawer from '../components/RemoteCreateDrawer'
import RemoteDefaultsDrawer from '../components/RemoteDefaultsDrawer'
import RemoteEditDrawer from '../components/RemoteEditDrawer'

function Settings() {
    const settingsPass = usePersistedStore((state) => state.settingsPass)

    const [passwordCheckInput, setPasswordCheckInput] = useState('')
    const [passwordCheckPassed, setPasswordCheckPassed] = useState(false)
    const [passwordVisible, setPasswordVisible] = useState(false)

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
                    spellCheck={false}
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
        <div className="flex flex-col w-screen h-screen gap-0 overflow-hidden animate-fade-in">
            <Tabs
                aria-label="Options"
                isVertical={true}
                variant="light"
                destroyInactiveTabPanel={false}
                disableAnimation={true}
                className="flex-shrink-0 w-3/12 h-screen px-2 py-4 border-r border-neutral-700"
                classNames={{
                    tabList: 'w-full gap-3',
                }}
                size="lg"
                defaultSelectedKey="general"
                color="secondary"
            >
                <Tab
                    key="general"
                    title={
                        <div className="flex items-center space-x-2">
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
                        <div className="flex items-center space-x-2">
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
                    key="license"
                    title={
                        <div className="flex items-center space-x-2">
                            <MedalIcon className="w-5 h-5" />
                            <span>License</span>
                        </div>
                    }
                    data-focus-visible="false"
                    className="w-full max-h-screen p-0 overflow-scroll overscroll-none"
                >
                    <LicenseSection />
                </Tab>
                {/* <Tab
                    key="hosts"
                    title={
                        <div className="flex items-center space-x-2">
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

    const [updateButtonText, setUpdateButtonText] = useState('Check for updates')
    const [isWorkingUpdate, setIsWorkingUpdate] = useState(false)
    const [update, setUpdate] = useState<Update | null>(null)

    const updateCallback = useCallback(async () => {
        if (!update) {
            try {
                console.log('checking for updates')
                setIsWorkingUpdate(true)
                setUpdateButtonText('Checking...')
                const receivedUpdate = await check()
                console.log('receivedUpdate', JSON.stringify(receivedUpdate, null, 2))
                if (!receivedUpdate) {
                    setUpdateButtonText('Up to date')
                    return
                }
                console.log(
                    `found update ${receivedUpdate.version} from ${receivedUpdate.date} with notes ${receivedUpdate.body}`
                )
                setUpdate(receivedUpdate)
                setUpdateButtonText('Tap to update')
            } catch (e) {
                console.error(e)
            } finally {
                setIsWorkingUpdate(false)
            }
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
            console.error(error)
            setIsWorkingUpdate(false)
            setUpdateButtonText('Tap to retry')
            await message('An error occurred in the update process. Please try again.', {
                title: 'Update Error',
                kind: 'error',
            })
            return
        }

        const answer = await ask('Update installed. Ready to restart?', {
            title: 'Update',
            kind: 'info',
            okLabel: 'Restart',
            cancelLabel: '',
        })

        if (!answer) {
            return
        }

        await relaunch()
    }, [update])

    useEffect(() => {
        // needed since the first value from the persisted store is undefined
        setPasswordInput(settingsPass || '')
    }, [settingsPass])

    // biome-ignore lint/correctness/useExhaustiveDependencies: <explanation>
    useEffect(() => {
        triggerTrayRebuild()
    }, [disabledActions])

    return (
        <div className="flex flex-col gap-10">
            <BaseHeader title="General" />

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
                        spellCheck={false}
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
                    <Checkbox isDisabled={true}>
                        <div className="flex flex-row gap-2">
                            <p>Start on boot</p>
                            <Chip size="sm" color="primary">
                                Coming soon
                            </Chip>
                        </div>
                    </Checkbox>

                    <Checkbox
                        isSelected={!disabledActions?.includes('tray-mount')}
                        onValueChange={(value) => {
                            if (value) {
                                setDisabledActions(
                                    disabledActions?.filter((action) => action !== 'tray-mount') ||
                                        []
                                )
                            } else {
                                setDisabledActions([...(disabledActions || []), 'tray-mount'])
                            }
                        }}
                    >
                        Show <span className="font-mono text-blue-300">Mount</span> option
                    </Checkbox>
                    <Checkbox
                        isSelected={!disabledActions?.includes('tray-sync')}
                        onValueChange={(value) => {
                            if (value) {
                                setDisabledActions(
                                    disabledActions?.filter((action) => action !== 'tray-sync') ||
                                        []
                                )
                            } else {
                                setDisabledActions([...(disabledActions || []), 'tray-sync'])
                            }
                        }}
                    >
                        Show <span className="font-mono text-blue-300">Sync</span> option
                    </Checkbox>
                    <Checkbox
                        isSelected={!disabledActions?.includes('tray-copy')}
                        onValueChange={(value) => {
                            if (value) {
                                setDisabledActions(
                                    disabledActions?.filter((action) => action !== 'tray-copy') ||
                                        []
                                )
                            } else {
                                setDisabledActions([...(disabledActions || []), 'tray-copy'])
                            }
                        }}
                    >
                        Show <span className="font-mono text-blue-300">Copy</span> option
                    </Checkbox>
                </div>

                {/* <Button
			onPress={async () => {
				const enabled = await isEnabled()
				if (enabled) {
					await disable()
				} else {
					await enable()
				}
			}}
		>
			Start on boot
		</Button>

		<Button
			onPress={async () => {
				const enabled = await isEnabled()
				alert(enabled ? 'Enabled' : 'Disabled')
			}}
		>
			Get status
		</Button> */}
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
        </div>
    )
}

function LicenseSection() {
    const [isLicenseEditable, setIsLicenseEditable] = useState(false)
    const licenseKey = usePersistedStore((state) => state.licenseKey)
    const licenseValid = usePersistedStore((state) => state.licenseValid)

    const [isRevoking, setIsRevoking] = useState(false)
    const [isActivating, setIsActivating] = useState(false)
    const [licenseKeyInput, setLicenseKeyInput] = useState('')

    useEffect(() => {
        setLicenseKeyInput(licenseKey || '')
        setIsLicenseEditable(!licenseKey)
    }, [licenseKey])

    return (
        <div className="flex flex-col gap-10">
            <BaseHeader title="License" />

            <div className="flex flex-row justify-center w-full gap-8 px-8">
                <div className="flex flex-col items-end w-2/6 gap-2 bg-transparent-500">
                    <h3 className="font-medium">Activate</h3>
                </div>

                <div className="flex flex-col w-4/6 gap-2 bg-transparent-500">
                    <Input
                        placeholder="Enter license key"
                        value={licenseKeyInput}
                        onChange={(e) => setLicenseKeyInput(e.target.value)}
                        size="lg"
                        isDisabled={!isLicenseEditable || isActivating}
                        autoCapitalize="none"
                        autoComplete="off"
                        autoCorrect="off"
                        spellCheck={false}
                        endContent={
                            licenseValid && <CheckIcon className="w-5 h-5 text-green-500" />
                        }
                        data-focus-visible="false"
                    />

                    {!licenseValid && (
                        <Button
                            fullWidth={true}
                            isLoading={isActivating}
                            onPress={async () => {
                                setIsActivating(true)
                                try {
                                    await validateLicense(licenseKeyInput)
                                } catch (e) {
                                    if (e instanceof Error) {
                                        await ask(e.message, {
                                            title: 'Error',
                                            kind: 'error',
                                            okLabel: 'Ok',
                                            cancelLabel: '',
                                        })
                                        return
                                    }

                                    await ask('An error occurred. Please try again.', {
                                        title: 'Error',
                                        kind: 'error',
                                        okLabel: 'Ok',
                                        cancelLabel: '',
                                    })
                                } finally {
                                    setIsActivating(false)
                                }

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
                            fullWidth={true}
                            isLoading={isRevoking}
                            color="danger"
                            variant="ghost"
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
                                    await revokeLicense(licenseKeyInput)
                                } catch (e) {
                                    if (e instanceof Error) {
                                        await ask(e.message, {
                                            title: 'Error',
                                            kind: 'error',
                                            okLabel: 'Ok',
                                            cancelLabel: '',
                                        })
                                        return
                                    }

                                    await ask('An error occurred. Please try again.', {
                                        title: 'Error',
                                        kind: 'error',
                                        okLabel: 'Ok',
                                        cancelLabel: '',
                                    })
                                } finally {
                                    setIsRevoking(false)
                                }

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
            </div>

            <div className="flex flex-row justify-center w-full gap-8 px-8">
                <div className="flex flex-col items-end w-2/6 gap-2 bg-transparent-500">
                    <h3 className="font-medium">Buy</h3>

                    <p className="text-xs text-neutral-500 text-end">
                        Includes access to future features and updates.
                    </p>
                </div>

                <div className="flex flex-col w-4/6 gap-3 bg-transparent-500">
                    <Button
                        size="lg"
                        fullWidth={true}
                        color="primary"
                        variant="shadow"
                        onPress={async () => {
                            await openUrl('https://buy.stripe.com/test_dR67uygoIcYJ6hG4gg')
                        }}
                    >
                        Lifetime License — $7
                    </Button>
                </div>
            </div>

            {/* <div className="flex flex-row justify-center w-full gap-8 px-8">
                <div className="flex flex-col items-end w-2/6 gap-2 bg-transparent-500">
                    <h3 className="font-medium">Features</h3>
                    <p className="text-xs text-neutral-500 text-end">What you get with a license</p>
                </div>

                <div className="flex flex-col w-4/6 gap-2 bg-transparent-500">
                    <Card className="border-none bg-background/60 dark:bg-default-100/60">
                        <CardBody>
                            <ul className="flex flex-col gap-3">
                                <li className="flex items-center gap-2">
                                    <CheckIcon className="w-5 h-5 text-green-500" />
                                    <span>Work with more than 3 remotes</span>
                                </li>
                                <li className="flex items-center gap-2">
                                    <CheckIcon className="w-5 h-5 text-green-500" />
                                    <span>Runs on up to 5 devices</span>
                                </li>
                                <li className="flex items-center gap-2">
                                    <CheckIcon className="w-5 h-5 text-green-500" />
                                    <span>File Commander</span>
                                </li>
                                <li className="flex items-center gap-2">
                                    <CheckIcon className="w-5 h-5 text-green-500" />
                                    <span>Mobile Client</span>
                                </li>
                                <li className="flex items-center gap-2">
                                    <CheckIcon className="w-5 h-5 text-green-500" />
                                    <span>Supporting Open Source</span>
                                </li>
                            </ul>
                        </CardBody>
                    </Card>
                </div>
            </div> */}
        </div>
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
                >
                    Create Remote
                </Button>
            </div>
        )
    }

    return (
        <div className="flex flex-col gap-4">
            <BaseHeader
                title="Remotes"
                endContent={
                    <Button
                        onPress={async () => {
                            if (!licenseValid && remotes.length >= 3) {
                                await message(
                                    'Community version does not support adding more than 3 remotes.',
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
                }
            />
            <div className="flex flex-col gap-2 p-4">
                {remotes.map((remote) => (
                    <Card
                        key={remote}
                        shadow="sm"
                        isBlurred={true}
                        className="border-none bg-background/60 dark:bg-default-100/60"
                    >
                        <CardBody>
                            <div className="flex items-center justify-between">
                                <span>{remote}</span>
                                <div className="flex flex-row items-center gap-2">
                                    <Button
                                        onPress={() => {
                                            setPickedRemote(remote)
                                            setDefaultsDrawerOpen(true)
                                        }}
                                        // isIconOnly={true}
                                        color="primary"
                                        variant="flat"
                                        data-focus-visible="false"
                                    >
                                        {/* <CableIcon className="w-4 h-4" /> */}
                                        Edit Defaults
                                    </Button>
                                    <Button
                                        onPress={() => {
                                            setPickedRemote(remote)
                                            setEditingDrawerOpen(true)
                                        }}
                                        // isIconOnly={true}
                                        // color="primary"
                                        variant="faded"
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
                                        onPress={async () => {
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
                                        data-focus-visible="false"
                                    >
                                        <Trash2Icon className="w-4 h-4" />
                                    </Button>
                                </div>
                            </div>
                        </CardBody>
                    </Card>
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
                    setCreatingDrawerOpen(false)
                }}
            />

            {pickedRemote && (
                <RemoteDefaultsDrawer
                    isOpen={defaultsDrawerOpen}
                    onClose={() => {
                        setDefaultsDrawerOpen(false)
                        setTimeout(() => {
                            // allow for drawer effect to happen
                            setPickedRemote(null)
                        }, 100)
                    }}
                    remoteName={pickedRemote}
                />
            )}
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

//  {/* <Button
//                                 onPress={async () => {
//                                     const enabled = await isEnabled()
//                                     if (enabled) {
//                                         await disable()
//                                     } else {
//                                         await enable()
//                                     }
//                                 }}
//                             >
//                                 Start on boot
//                             </Button>

//                             <Button
//                                 onPress={async () => {
//                                     const enabled = await isEnabled()
//                                     alert(enabled ? 'Enabled' : 'Disabled')
//                                 }}
//                             >
//                                 Get status
//                             </Button> */}
