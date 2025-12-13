import { sep } from '@tauri-apps/api/path'
import { getToolbarAction, getToolbarActions } from './actions'
import type {
    ToolbarActionArgs,
    ToolbarActionContext,
    ToolbarActionDefinition,
    ToolbarActionPath,
    ToolbarActionResult,
    ToolbarCommandId,
} from './types'

export interface ResolvedToolbarResult {
    id: string
    actionId: ToolbarCommandId
    label: string
    description?: string
    args: ToolbarActionArgs
    score: number
    resolve: () => ToolbarActionDefinition
}

export function runToolbarEngine(
    query: string,
    remotes: string[],
    remoteTypes?: Record<string, string>
) {
    const actions = getToolbarActions()

    const trimmed = query.trim()

    const parsedPaths = extractPaths(trimmed, remotes, remoteTypes)

    const cleanedQuery = trimmed.replace(parsedPaths.map((path) => path.full).join(' '), '').trim()

    const results = trimmed
        ? collectActionResults(actions, {
              query: cleanedQuery,
              fullQuery: trimmed,
              paths: parsedPaths,
              remotes,
          })
        : buildDefaultResults(actions, remotes)

    const finalResults = results.length > 0 ? results : buildDefaultResults(actions, remotes)

    return {
        results: finalResults.sort((a, b) => b.score - a.score),
    }
}

function collectActionResults(
    actions: ToolbarActionDefinition[],
    context: ToolbarActionContext
): ResolvedToolbarResult[] {
    const collected: ResolvedToolbarResult[] = []

    for (const action of actions) {
        const results = action.getResults(context)
        for (const result of results) {
            collected.push(mapResult(action, result))
        }
    }

    return dedupeResults(collected)
}

function buildDefaultResults(
    actions: ToolbarActionDefinition[],
    remotes: string[]
): ResolvedToolbarResult[] {
    return actions
        .map((action) =>
            action.getDefaultResult ? mapResult(action, action.getDefaultResult({ remotes })) : null
        )
        .filter((result): result is ResolvedToolbarResult => result !== null)
}

function mapResult(
    action: ToolbarActionDefinition,
    result: ToolbarActionResult
): ResolvedToolbarResult {
    return {
        id: serializeResult(action.id, result.args),
        actionId: action.id,
        label: result.label ?? action.label,
        description: result.description ?? action.description,
        args: result.args ?? {},
        score: result.score ?? 0,
        resolve: () => getToolbarAction(action.id),
    }
}

function dedupeResults(results: ResolvedToolbarResult[]): ResolvedToolbarResult[] {
    const bestById = new Map<string, ResolvedToolbarResult>()

    for (const result of results) {
        const key = `${result.actionId}:${JSON.stringify(result.args)}`
        const existing = bestById.get(key)
        if (!existing || result.score > existing.score) {
            bestById.set(key, result)
        }
    }

    return Array.from(bestById.values())
}

function serializeResult(actionId: ToolbarCommandId, args: ToolbarActionArgs) {
    return `${actionId}:${JSON.stringify(args)}`
}

const TOKEN_TRIM_REGEX = /^[\"'`]+|[\"'`.,;!?]+$/g
const REMOTE_PATH_REGEX = /^([^:\s]+):(.*)$/
const WINDOWS_DRIVE_REGEX = /^[a-zA-Z]:[\\/]/
const ALPHA_REGEX = /[a-zA-Z]/
const WINDOWS_PREFIX_REGEX = /^([a-zA-Z]:)(.*)$/
const QUOTED_STRING_REGEX = /^(["'`])(.+?)\1/
const WHITESPACE_OR_COLON_REGEX = /[\s:]/
const NON_WHITESPACE_TOKEN_REGEX = /^(\S+)/

function extractPaths(
    input: string,
    remotes: string[],
    remoteTypes?: Record<string, string>
): ToolbarActionPath[] {
    const seen = new Set<string>()
    const results: ToolbarActionPath[] = []
    const separator = sep()

    const remoteLowerToOriginal = new Map<string, string>()
    for (const remote of remotes) {
        remoteLowerToOriginal.set(remote.toLowerCase(), remote)
    }

    console.log('remotes', remotes)

    const tokens = tokenizeInput(input, remotes)

    for (const raw of tokens) {
        const cleaned = stripToken(raw)
        if (!cleaned) continue
        let remoteName: string | undefined
        let remoteType: string | undefined
        let isLocal: boolean = false

        const matchedRemote = remoteLowerToOriginal.get(cleaned.toLowerCase())

        // eagerly match remotes (case-insensitive)
        if (matchedRemote) {
            remoteName = matchedRemote
            remoteType = remoteTypes?.[matchedRemote]
        } else if (isRemotePath(cleaned)) {
            // remote path match (e.g., "rct:/path/to/file")
            const match = REMOTE_PATH_REGEX.exec(cleaned)
            if (match) {
                const matchedPathRemote = remoteLowerToOriginal.get(match[1].toLowerCase())
                if (matchedPathRemote) {
                    remoteName = matchedPathRemote
                    remoteType = remoteTypes?.[matchedPathRemote]
                } else {
                    continue
                }
            } else {
                continue
            }
        } else if (isLocalPath(cleaned)) {
            isLocal = true
        } else {
            continue
        }

        // Use the original remote name for the full path if matched
        const fullPath = remoteName && !isRemotePath(cleaned) ? remoteName : cleaned
        if (!seen.has(fullPath.toLowerCase())) {
            seen.add(fullPath.toLowerCase())
            results.push({
                full: fullPath,
                readable: createReadablePath(fullPath, isLocal, separator),
                isLocal,
                remoteName,
                remoteType,
            })
        }
    }

    return results
}

function createReadablePath(full: string, isLocal: boolean, separator: string): string {
    return isLocal ? createLocalReadable(full, separator) : createRemoteReadable(full)
}

function createRemoteReadable(full: string): string {
    const match = REMOTE_PATH_REGEX.exec(full)
    if (!match) {
        return full
    }
    const remote = match[1]
    let remainder = match[2] ?? ''
    if (!remainder || remainder === '/') {
        return `${remote}:/`
    }
    if (remainder.startsWith('/')) {
        remainder = remainder.slice(1)
    }
    const segments = remainder.split('/').filter(Boolean)
    if (segments.length === 0) {
        return `${remote}:/`
    }
    const last = segments[segments.length - 1]
    if (segments.length === 1) {
        return `${remote}:/${last}`
    }
    if (segments.length === 2) {
        return `${remote}:/${segments[0]}/${last}`
    }
    const secondToLast = segments[segments.length - 2]
    return `${remote}:/${segments[0]}/.../${secondToLast}/${last}`
}

function createLocalReadable(full: string, separator: string): string {
    const normalized = full.replace(/[/\\]+/g, separator)

    const windowsMatch = WINDOWS_PREFIX_REGEX.exec(normalized)
    if (windowsMatch) {
        const drive = windowsMatch[1]
        const remainder = windowsMatch[2] ?? ''
        const segments = remainder.split(separator).filter(Boolean)
        if (segments.length === 0) {
            return `${drive}${separator}`
        }
        const last = segments.pop() ?? ''
        if (segments.length === 0) {
            return `${drive}${separator}${last}`
        }
        if (segments.length === 1) {
            return `${drive}${separator}${segments[0]}${separator}${last}`
        }
        const secondToLast = segments.pop() ?? ''
        const first = segments.shift() ?? ''
        return `${drive}${separator}${first}${separator}...${separator}${secondToLast}${separator}${last}`
    }

    const isAbsolute =
        normalized.startsWith(separator) ||
        normalized.startsWith('/') ||
        normalized.startsWith('\\')
    const segments = normalized.split(separator).filter(Boolean)
    if (segments.length === 0) {
        return isAbsolute ? separator : normalized
    }
    const last = segments.pop() ?? ''
    if (!isAbsolute && segments.length === 0) {
        return last || normalized
    }
    const first = segments.shift()
    if (!first) {
        return isAbsolute ? `${separator}${last}` : last
    }
    if (segments.length === 0) {
        return isAbsolute
            ? `${separator}${first}${separator}${last}`
            : `${first}${separator}${last}`
    }
    if (segments.length === 1) {
        return isAbsolute
            ? `${separator}${first}${separator}${segments[0]}${separator}${last}`
            : `${first}${separator}${segments[0]}${separator}${last}`
    }
    const secondToLast = segments.pop() ?? ''
    return isAbsolute
        ? `${separator}${first}${separator}...${separator}${secondToLast}${separator}${last}`
        : `${first}${separator}...${separator}${secondToLast}${separator}${last}`
}

function stripToken(token: string): string {
    return token.replace(TOKEN_TRIM_REGEX, '')
}

function tokenizeInput(input: string, remotes: string[]): string[] {
    const tokens: string[] = []
    let remaining = input.trim()

    const sortedRemotes = [...remotes].sort((a, b) => b.length - a.length)
    const remotesWithSpaces = sortedRemotes.filter((r) => r.includes(' '))

    while (remaining.length > 0) {
        remaining = remaining.trimStart()
        if (!remaining) break

        //quoted strings first
        const quoteMatch = QUOTED_STRING_REGEX.exec(remaining)
        if (quoteMatch) {
            tokens.push(quoteMatch[2])
            remaining = remaining.slice(quoteMatch[0].length)
            continue
        }

        let matchedRemoteWithSpace = false
        for (const remote of remotesWithSpaces) {
            if (remaining.toLowerCase().startsWith(remote.toLowerCase())) {
                const nextChar = remaining[remote.length]
                if (!nextChar || WHITESPACE_OR_COLON_REGEX.test(nextChar)) {
                    tokens.push(remote)
                    remaining = remaining.slice(remote.length)
                    matchedRemoteWithSpace = true
                    break
                }
            }
        }
        if (matchedRemoteWithSpace) continue

        // fallback
        const wsMatch = NON_WHITESPACE_TOKEN_REGEX.exec(remaining)
        if (wsMatch) {
            tokens.push(wsMatch[1])
            remaining = remaining.slice(wsMatch[0].length)
        }
    }

    return tokens
}

function isRemotePath(token: string): boolean {
    if (!token.includes(':')) return false
    if (token.includes('://')) return false

    const match = REMOTE_PATH_REGEX.exec(token)
    if (!match) return false

    if (isWindowsDrive(match[1], match[2])) {
        return false
    }

    return true
}

function isLocalPath(token: string): boolean {
    if (token.startsWith('/')) return true
    if (token.startsWith('~/')) return true
    if (token.startsWith('./') || token.startsWith('../')) return true
    if (WINDOWS_DRIVE_REGEX.test(token)) return true
    return false
}

function isWindowsDrive(prefix: string, remainder: string): boolean {
    return (
        prefix.length === 1 &&
        ALPHA_REGEX.test(prefix) &&
        (remainder.startsWith('\\') || remainder.startsWith('/'))
    )
}
