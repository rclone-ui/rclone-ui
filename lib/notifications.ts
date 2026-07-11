import { useQuery } from '@tanstack/react-query'
import { invoke } from '@tauri-apps/api/core'
import { message } from '@tauri-apps/plugin-dialog'
import {
    isPermissionGranted,
    requestPermission,
    sendNotification,
} from '@tauri-apps/plugin-notification'
import { type WatchedJob, useStore } from '../store/memory'
import { usePersistedStore } from '../store/persisted'
import type {
    NotificationCatalog,
    NotificationEventId,
    NotificationProvider,
    NotificationTarget,
} from '../types/notifications'
import rclone from './rclone/client'

// The TS face of the notification system. The engine lives in Rust
// (src-tauri/src/notifications/): webhook dispatch, target storage (targets.json — NOT the
// zustand store), delivery-outcome recording, and the event catalog are shared with the
// headless scheduler runner, so webhooks behave identically whether the app is open or not.
// This file keeps the thin invoke wrappers plus the parts that must stay in the webview:
// GUI OS toasts (the notification plugin), the job watcher, and provider form helpers.

// ---------------------------------------------------------------------------
// OS toasts (GUI only — the headless runner posts its own via Rust notify-rust)
// ---------------------------------------------------------------------------

export async function notify({ title, body }: { title: string; body: string }) {
    let permissionGranted = await isPermissionGranted()

    if (!permissionGranted) {
        const permission = await requestPermission()
        permissionGranted = permission === 'granted'
    }

    if (permissionGranted) {
        sendNotification({
            title,
            body,
        })
    } else {
        await message(body, {
            title,
            kind: 'info',
        })
    }
}

// ---------------------------------------------------------------------------
// Webhook engine wrappers
// ---------------------------------------------------------------------------

export type NewNotificationTarget = Omit<
    NotificationTarget,
    'id' | 'createdAt' | 'lastSentAt' | 'lastError'
>

export async function getNotificationsCatalog(): Promise<NotificationCatalog> {
    return await invoke<NotificationCatalog>('notifications_catalog')
}

export async function listNotificationTargets(): Promise<NotificationTarget[]> {
    return await invoke<NotificationTarget[]>('notifications_list_targets')
}

/** Throws with a user-facing message (e.g. duplicate URL — re-checked race-safely in Rust). */
export async function addNotificationTarget(
    target: NewNotificationTarget
): Promise<NotificationTarget> {
    return await invoke<NotificationTarget>('notifications_add_target', { target })
}

export async function updateNotificationTarget(
    id: string,
    patch: Partial<Omit<NotificationTarget, 'id' | 'createdAt' | 'lastSentAt' | 'lastError'>>
): Promise<void> {
    await invoke('notifications_update_target', { id, patch })
}

export async function removeNotificationTarget(id: string): Promise<void> {
    await invoke('notifications_remove_target', { id })
}

/**
 * Sends `eventId` to every enabled webhook target that subscribed to it. Fire-and-forget for
 * callers (never throws); delivery happens in Rust, which records lastSentAt/lastError per
 * target and reads targets at fire time.
 */
export async function dispatchNotification(
    eventId: NotificationEventId,
    payload: { title: string; body: string; data?: Record<string, unknown> }
): Promise<void> {
    try {
        await invoke('notifications_dispatch', {
            eventId,
            title: payload.title,
            body: payload.body,
            data: payload.data,
        })
    } catch (error) {
        console.error('[dispatchNotification] failed', eventId, error)
    }
}

/**
 * Sends a test payload directly to the given target (which may be unsaved drawer values).
 * Throws on failure so the UI can surface the error; Rust records the outcome when the target
 * already exists (`id` set).
 */
export async function sendTestNotification(
    target: Pick<NotificationTarget, 'provider' | 'url'> & { id?: string; name?: string }
): Promise<void> {
    await invoke('notifications_send_test', {
        provider: target.provider,
        url: target.url,
        targetId: target.id,
        name: target.name,
    })
}

export function useNotificationTargets() {
    return useQuery({
        queryKey: ['notifications', 'targets'],
        queryFn: listNotificationTargets,
        // Dispatches (and their outcome recording) happen in the hidden main window and the
        // headless runner — separate queryClients that can't invalidate this window's cache.
        // Polling is what keeps lastSentAt/lastError chips honest.
        refetchInterval: 10_000,
        refetchOnWindowFocus: true,
    })
}

export function useNotificationsCatalog() {
    return useQuery({
        queryKey: ['notifications', 'catalog'],
        queryFn: getNotificationsCatalog,
        // Default staleTime, NOT Infinity: lib/query.ts persists the cache to localStorage for
        // 30 days, and a frozen catalog would hide events added by app updates.
    })
}

// ---------------------------------------------------------------------------
// Free-tier limit
// ---------------------------------------------------------------------------

/** Free (community) limit — a license removes the cap. Enforced at creation in the UI, and by
 *  the launch reconcile below when a license lapses. */
export const FREE_MAX_TARGETS = 5

/**
 * License enforcement at launch: without a valid license, only the 5 oldest enabled targets
 * stay enabled — the rest are turned off (never auto-re-enabled; the user flips them back on
 * after re-activating). Runs in the hidden main window after validateInstance(); never throws.
 */
export async function reconcileNotificationTargets(): Promise<void> {
    try {
        if (usePersistedStore.getState().licenseValid) {
            return
        }
        const targets = await listNotificationTargets()
        const extras = targets
            .filter((target) => target.isEnabled)
            .sort((a, b) => a.createdAt - b.createdAt)
            .slice(FREE_MAX_TARGETS)
        for (const target of extras) {
            await updateNotificationTarget(target.id, { isEnabled: false })
            console.warn('[reconcileNotificationTargets] disabled over-limit target', target.name)
        }
    } catch (error) {
        console.error('[reconcileNotificationTargets] failed', error)
    }
}

// ---------------------------------------------------------------------------
// Provider form helpers
// ---------------------------------------------------------------------------

export const NOTIFICATION_PROVIDERS: Record<
    NotificationProvider,
    {
        label: string
        // Noun used in drawer titles/buttons, e.g. "Add Discord Webhook" / "Add Telegram Bot".
        titleLabel: string
        description: string
        urlPlaceholder: string
        accentClass: string
    }
> = {
    discord: {
        label: 'Discord',
        titleLabel: 'Discord Webhook',
        description: 'Post to a Discord channel',
        urlPlaceholder: 'https://discord.com/api/webhooks/1234567890/AbCdEf...',
        accentClass: 'text-indigo-500',
    },
    slack: {
        label: 'Slack',
        titleLabel: 'Slack Webhook',
        description: 'Post to a Slack channel',
        urlPlaceholder: 'https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXX',
        accentClass: 'text-emerald-500',
    },
    telegram: {
        label: 'Telegram',
        titleLabel: 'Telegram Bot',
        description: 'Message a chat via your bot',
        urlPlaceholder: 'https://api.telegram.org/bot123456:ABC-DEF...',
        accentClass: 'text-sky-500',
    },
    webhook: {
        label: 'Webhook',
        titleLabel: 'Webhook',
        description: 'POST JSON to any endpoint',
        urlPlaceholder: 'https://example.com/hooks/rclone',
        accentClass: 'text-primary',
    },
}

// Accepts discord.com, legacy discordapp.com, and the ptb./canary. test clients.
const RE_DISCORD_WEBHOOK =
    /^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/
const RE_SLACK_WEBHOOK = /^https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/\w+$/
// Standard Bot API endpoint: the path carries "bot<botid>:<token>"; chat_id rides the query.
// This is the STORED shape — the form collects only the pure bot URL (below) and the
// /sendMessage method is appended by buildTelegramUrl.
const RE_TELEGRAM_SEND_MESSAGE = /^https:\/\/api\.telegram\.org\/bot\d+:[\w-]+\/sendMessage(\?.*)?$/
// What the form accepts: the pure bot URL. A pasted full endpoint or trailing slash is
// tolerated (normalized away when the URL is built) rather than rejected.
const RE_TELEGRAM_BOT_URL = /^https:\/\/api\.telegram\.org\/bot\d+:[\w-]+(\/sendMessage)?\/?$/
const RE_TELEGRAM_SEND_MESSAGE_SUFFIX = /\/sendMessage$/
const RE_TRAILING_SLASHES = /\/+$/

export function validateWebhookUrl(provider: NotificationProvider, url: string): string | null {
    const trimmed = url.trim()

    if (!trimmed) {
        return 'A webhook URL is required'
    }

    if (provider === 'discord') {
        if (!RE_DISCORD_WEBHOOK.test(trimmed)) {
            return "This doesn't look like a Discord webhook URL — expected https://discord.com/api/webhooks/…"
        }
        return null
    }

    if (provider === 'slack') {
        if (!RE_SLACK_WEBHOOK.test(trimmed)) {
            return "This doesn't look like a Slack webhook URL — expected https://hooks.slack.com/services/…"
        }
        return null
    }

    if (provider === 'telegram') {
        if (!RE_TELEGRAM_SEND_MESSAGE.test(trimmed)) {
            return "This doesn't look like a Telegram Bot API URL — expected https://api.telegram.org/bot<token>/sendMessage"
        }
        const { chatId } = splitTelegramUrl(trimmed)
        if (validateTelegramChatId(chatId)) {
            return 'The Telegram URL is missing a valid chat_id'
        }
        return null
    }

    let parsed: URL
    try {
        parsed = new URL(trimmed)
    } catch {
        return 'This is not a valid URL'
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return 'The URL must use http:// or https://'
    }

    return null
}

// Integer chat id (negative for groups/supergroups) or a public @channelusername.
const RE_TELEGRAM_CHAT_ID = /^(-?\d+|@\w{5,})$/

export const TELEGRAM_CHAT_ID_HELP =
    'Message @userinfobot on Telegram for your own ID, add @getidsbot to a group for its ID, or use @channelname for a public channel.'

/**
 * The Telegram form collects the pure bot URL and the chat id separately; the /sendMessage
 * method and the chat_id are both OURS to add — they are merged into one stored URL
 * (…/sendMessage?chat_id=…) so the dispatcher and the NotificationTarget shape stay
 * provider-agnostic. The UI never lets users type query params directly.
 */
export function buildTelegramUrl(baseUrl: string, chatId: string): string {
    const parsed = new URL(baseUrl.trim())
    parsed.search = ''
    const base = parsed
        .toString()
        .replace(RE_TRAILING_SLASHES, '')
        .replace(RE_TELEGRAM_SEND_MESSAGE_SUFFIX, '')
    return `${base}/sendMessage?chat_id=${encodeURIComponent(chatId.trim())}`
}

/** Inverse of buildTelegramUrl, for seeding the edit form from a stored URL. */
export function splitTelegramUrl(url: string): { baseUrl: string; chatId: string } {
    try {
        const parsed = new URL(url)
        const chatId = parsed.searchParams.get('chat_id') ?? ''
        parsed.search = ''
        const baseUrl = parsed
            .toString()
            .replace(RE_TRAILING_SLASHES, '')
            .replace(RE_TELEGRAM_SEND_MESSAGE_SUFFIX, '')
        return { baseUrl, chatId }
    } catch {
        return { baseUrl: url, chatId: '' }
    }
}

/** Validates the drawer's Telegram URL field: the pure bot URL, no query params. */
export function validateTelegramBotUrl(url: string): string | null {
    const trimmed = url.trim()
    if (!trimmed) {
        return 'A bot URL is required'
    }
    if (trimmed.includes('?')) {
        return "Don't include query parameters — enter the Chat ID in its own field below"
    }
    if (!RE_TELEGRAM_BOT_URL.test(trimmed)) {
        return "This doesn't look like a Telegram Bot API URL — expected https://api.telegram.org/bot<token>"
    }
    return null
}

export function validateTelegramChatId(chatId: string): string | null {
    const trimmed = chatId.trim()
    if (!trimmed) {
        return 'A chat ID is required'
    }
    if (!RE_TELEGRAM_CHAT_ID.test(trimmed)) {
        return 'Enter a numeric chat ID (negative for groups) or a public @channelname'
    }
    return null
}

const MAX_MASK_SEGMENT_LENGTH = 10

// Webhook URLs are credentials (Telegram's first path segment IS the bot token) — the list view
// renders this instead of the full URL.
export function maskWebhookUrl(url: string): string {
    try {
        const parsed = new URL(url)
        const segments = parsed.pathname.split('/').filter(Boolean)
        if (segments.length === 0) {
            return parsed.host
        }
        const firstSegment =
            segments[0].length > MAX_MASK_SEGMENT_LENGTH
                ? `${segments[0].slice(0, MAX_MASK_SEGMENT_LENGTH)}…`
                : segments[0]
        if (segments.length === 1 && !parsed.search) {
            return `${parsed.host}/${firstSegment}`
        }
        return `${parsed.host}/${firstSegment}/…${url.slice(-4)}`
    } catch {
        return url.length > 24 ? `${url.slice(0, 24)}…` : url
    }
}

// ---------------------------------------------------------------------------
// Job watcher
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 5000
// A jobid that can't be fetched this many consecutive ticks is gone (daemon restarted and
// forgot it) — drop it silently instead of emitting a bogus outcome. This is also what bounds
// the watch list: rclone expires finished jobs after 24h, and a still-running job stays
// legitimately watchable for as long as it runs.
const MAX_STATUS_FAILURES = 6

let initialized = false
let pollTimer: ReturnType<typeof setInterval> | null = null
let ticking = false
// Guards against a broadcast echo re-adding a job we already handled. Module-local, so a main
// window reload can re-emit job.started for still-running jobs — acceptable edge case.
const seenJobIds = new Set<number>()
const handledJobIds = new Set<number>()
const statusFailures = new Map<number, number>()

/**
 * Observes watchedJobs (registered by lib/rclone/api.ts from any window) and emits the
 * job.started/completed/failed notifications. Must be initialized
 * ONLY in the hidden main window — a second watcher would double-post webhooks.
 */
export function initJobWatcher() {
    if (initialized) {
        return
    }
    initialized = true

    console.log('[jobWatcher] initialized')

    useStore.subscribe((state) => onWatchedJobsChange(state.watchedJobs))

    // The rclone client is bound to the current host, so after a host switch the watched jobids
    // belong to a daemon we can no longer (safely) query — polling the new host could even match
    // an unrelated job with the same id. Drop them.
    let lastHostId = usePersistedStore.getState().currentHostId
    usePersistedStore.subscribe((state) => {
        if (state.currentHostId !== lastHostId) {
            console.warn('[jobWatcher] host changed, dropping watched jobs')
            lastHostId = state.currentHostId
            clearWatchedJobs()
        }
    })

    onWatchedJobsChange(useStore.getState().watchedJobs)
}

/**
 * Forget all watched jobs — jobids do not survive a daemon restart or crash. The dedupe sets
 * must go too: a fresh daemon issues jobids from 1 again, guaranteed to collide with old ones.
 */
export function clearWatchedJobs() {
    statusFailures.clear()
    seenJobIds.clear()
    handledJobIds.clear()
    useStore.setState({ watchedJobs: {} })
}

function onWatchedJobsChange(watchedJobs: Record<number, WatchedJob>) {
    for (const job of Object.values(watchedJobs)) {
        if (seenJobIds.has(job.jobid) || handledJobIds.has(job.jobid)) {
            continue
        }
        seenJobIds.add(job.jobid)

        dispatchNotification('job.started', {
            title: 'Transfer started',
            body: describeJob(job),
            data: baseJobData(job),
        })
    }

    const hasJobs = Object.keys(watchedJobs).length > 0
    if (hasJobs && !pollTimer) {
        pollTimer = setInterval(tick, POLL_INTERVAL_MS)
    } else if (!hasJobs && pollTimer) {
        clearInterval(pollTimer)
        pollTimer = null
    }
}

async function tick() {
    if (ticking) {
        return
    }
    ticking = true
    try {
        for (const job of Object.values(useStore.getState().watchedJobs)) {
            await checkJob(job)
        }
    } finally {
        ticking = false
    }
}

async function checkJob(job: WatchedJob) {
    // A broadcast echo can resurrect a job another write raced with — never process one twice.
    if (handledJobIds.has(job.jobid)) {
        unwatch(job.jobid)
        return
    }

    let jobStatus: any
    try {
        jobStatus = await rclone('/job/status', {
            params: {
                query: {
                    jobid: job.jobid,
                },
            },
        })
        statusFailures.delete(job.jobid)
    } catch (error) {
        const failures = (statusFailures.get(job.jobid) ?? 0) + 1
        statusFailures.set(job.jobid, failures)
        if (failures >= MAX_STATUS_FAILURES) {
            console.warn('[jobWatcher] dropping unreachable job', job.jobid, error)
            unwatch(job.jobid)
        }
        return
    }

    // Re-check after the await: JobDetailsDrawer un-watches user-stopped jobs so the forced
    // "context canceled" finish must not surface as a bogus failure notification.
    if (!useStore.getState().watchedJobs[job.jobid]) {
        return
    }

    if (!jobStatus?.finished) {
        return
    }

    unwatch(job.jobid)

    if (useStore.getState().dryRunJobIds.includes(job.jobid)) {
        console.log('[jobWatcher] skipping dry run job', job.jobid)
        return
    }

    // Same failure detection as fetchJob: the top-level error plus per-result errors, which is
    // where batch partial failures live.
    let failedResults = 0
    let totalResults = 0
    if (
        jobStatus.output &&
        typeof jobStatus.output === 'object' &&
        'results' in jobStatus.output &&
        Array.isArray(jobStatus.output.results)
    ) {
        totalResults = jobStatus.output.results.length
        failedResults = jobStatus.output.results.filter((result: any) => !!result?.error).length
    }

    const errorMessage: string =
        jobStatus.error ||
        (failedResults > 0 ? `${failedResults} of ${totalResults} operations failed` : '')

    const data = {
        ...baseJobData(job),
        durationSeconds:
            typeof jobStatus.duration === 'number' ? Math.round(jobStatus.duration) : undefined,
        ...(errorMessage ? { error: errorMessage } : {}),
    }

    console.log('[jobWatcher] job finished', job.jobid, errorMessage || 'success')

    if (errorMessage) {
        dispatchNotification('job.failed', {
            title: 'Transfer failed',
            body: `${describeJob(job)} — ${errorMessage}`,
            data,
        })
    } else {
        dispatchNotification('job.completed', {
            title: 'Transfer completed',
            body: describeJob(job),
            data,
        })
    }
}

function unwatch(jobid: number) {
    handledJobIds.add(jobid)
    statusFailures.delete(jobid)
    useStore.setState((state) => {
        const watchedJobs = { ...state.watchedJobs }
        delete watchedJobs[jobid]
        return { watchedJobs }
    })
}

function describeJob(job: WatchedJob): string {
    const sources = job.sources ?? []
    const sourceLabel =
        sources.length > 2
            ? `${sources.slice(0, 2).join(', ')} and ${sources.length - 2} more`
            : sources.join(', ')

    let description = job.operation
    if (sourceLabel) {
        description += ` of ${sourceLabel}`
    }
    if (job.destination) {
        description += ` to ${job.destination}`
    }
    return description
}

function baseJobData(job: WatchedJob) {
    return {
        jobid: job.jobid,
        operation: job.operation,
        sources: job.sources,
        destination: job.destination,
    }
}
