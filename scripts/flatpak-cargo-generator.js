/*
# Flatpak Cargo Generator

This file contains the Flatpak Cargo generator tool.
The JS version has been created to eliminate the Python dependency.
Both versions provide the same functionality for generating Flatpak build sources from Cargo.lock files.

### Usage
First, ensure the required dependencies are installed:
```bash
npm install @iarna/toml yaml -D
```

Then, run the script and point it to your Cargo.lock file:
```bash
node flatpak-cargo-generator.js path/to/Cargo.lock [options]
```

### Options
- `-o, --output <file>` - Specify output file (default: generated-sources.json)
- `--yaml` - Output as YAML instead of JSON (default: generated-sources.yml)
- `-t, --git-tarballs` - Download git repos as tarballs instead of cloning
- `-d, --debug` - Enable debug logging
- `-h, --help` - Show help message

### Examples
```bash
# Generate JSON sources
node flatpak-cargo-generator.js ../Cargo.lock

# Generate YAML sources with custom output
node flatpak-cargo-generator.js ../Cargo.lock --yaml -o my-sources.yml

# Use git tarballs instead of git clones
node flatpak-cargo-generator.js ../Cargo.lock --git-tarballs
```
*/

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { parse as parseToml, stringify as stringifyToml } from '@iarna/toml'
import { stringify as stringifyYaml } from 'yaml'

const CRATES_IO = 'https://static.crates.io/crates'
const CARGO_HOME = 'cargo'
const CARGO_CRATES = `${CARGO_HOME}/vendor`
const VENDORED_SOURCES = 'vendored-sources'
const GIT_CACHE = 'flatpak-cargo/git'
const COMMIT_LEN = 7

let DEBUG = false

function logInfo(...args) {
    console.log(...args)
}

function logDebug(...args) {
    if (DEBUG) console.log(...args)
}

function canonicalUrl(urlStr) {
    const uStr = urlStr.replace('git+https://', 'https://')
    const u = new URL(uStr)
    u.search = ''
    u.hash = ''
    if (u.pathname.endsWith('/')) {
        u.pathname = u.pathname.replace(/\/+$/, '')
    }
    if (u.hostname === 'github.com') {
        u.protocol = 'https:'
        u.pathname = u.pathname.toLowerCase()
    }
    if (u.pathname.endsWith('.git')) {
        u.pathname = u.pathname.slice(0, -4)
    }
    return u
}

function getGitTarball(repoUrl, commit) {
    const url = canonicalUrl(repoUrl)
    const parts = url.pathname.split('/').filter(Boolean)
    if (parts.length !== 2) throw new Error('Invalid repo URL: ' + url.toString())
    const owner = parts[0]
    const repo = parts[1]
    if (url.hostname === 'github.com') {
        return `https://codeload.${url.hostname}/${owner}/${repo}/tar.gz/${commit}`
    } else if (url.hostname.split('.')[0] === 'gitlab') {
        return `https://${url.hostname}/${owner}/${repo}/-/archive/${commit}/${repo}-${commit}.tar.gz`
    } else if (url.hostname === 'bitbucket.org') {
        return `https://${url.hostname}/${owner}/${repo}/get/${commit}.tar.gz`
    }
    throw new Error(`Don't know how to get tarball for ${repoUrl}`)
}

async function getRemoteSha256(url) {
    logInfo(`started sha256(${url})`)
    const sha256 = createHash('sha256')
    const response = await fetch(url)
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`)
    const reader = response.body.getReader()
    while (true) {
        const { value, done } = await reader.read()
        if (done) break
        if (value) sha256.update(value)
    }
    const digest = sha256.digest('hex')
    logInfo(`done sha256(${url})`)
    return digest
}

async function loadToml(tomlFile = 'Cargo.lock') {
    const text = await fs.readFile(tomlFile, 'utf-8')
    return parseToml(text)
}

function gitRepoName(gitUrl, commit) {
    const name = canonicalUrl(gitUrl).pathname.split('/').filter(Boolean).slice(-1)[0]
    return `${name}-${commit.slice(0, COMMIT_LEN)}`
}

function runGit(args, opts = {}) {
    const res = spawnSync('git', args, { cwd: opts.cwd, stdio: 'pipe', encoding: 'utf-8' })
    if (res.status !== 0) {
        const msg = res.stderr || res.stdout || `git ${args.join(' ')} failed`
        throw new Error(msg)
    }
    return res.stdout
}

function fetchGitRepo(gitUrl, commit) {
    const repoDirKey = gitUrl.replace('://', '_').replace(/\//g, '_')
    const cacheDir = process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache')
    const cloneDir = path.join(cacheDir, 'flatpak-cargo', repoDirKey)
    const gitDir = path.join(cloneDir, '.git')

    return (async () => {
        try {
            await fs.stat(gitDir)
        } catch {
            runGit(['clone', '--depth=1', gitUrl, cloneDir])
        }

        const head = runGit(['rev-parse', 'HEAD'], { cwd: cloneDir }).trim()
        if (head.slice(0, COMMIT_LEN) !== commit.slice(0, COMMIT_LEN)) {
            runGit(['fetch', 'origin', commit], { cwd: cloneDir })
            try {
                runGit(['checkout', commit], { cwd: cloneDir })
            } catch (e) {
                logInfo(`Checking out commit ${commit} failed for ${gitUrl}. Forcing checkout.`)
                runGit(['checkout', '-f', commit], { cwd: cloneDir })
            }
        }

        runGit(['submodule', 'update', '--init', '--recursive'], { cwd: cloneDir })
        return cloneDir
    })()
}

function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj))
}

function updateWorkspaceKeys(pkg, workspace) {
    for (const [key, item] of Object.entries(pkg)) {
        if (typeof item !== 'object' || item === null || Array.isArray(item)) continue

        if (key === 'target') {
            for (const target of Object.values(item)) {
                updateWorkspaceKeys(target, workspace)
            }
            continue
        } else if (key === 'dev-dependencies' || key === 'build-dependencies') {
            updateWorkspaceKeys(
                item,
                workspace && workspace.dependencies ? workspace.dependencies : undefined
            )
            continue
        }

        if (!workspace || !(key in workspace)) continue
        const workspaceItem = workspace[key]

        if (Object.prototype.hasOwnProperty.call(item, 'workspace')) {
            if (
                typeof workspaceItem === 'object' &&
                workspaceItem !== null &&
                !Array.isArray(workspaceItem)
            ) {
                delete item.workspace
                for (const [depKey, workspaceValue] of Object.entries(workspaceItem)) {
                    if (
                        depKey === 'features' &&
                        Object.prototype.hasOwnProperty.call(item, 'features')
                    ) {
                        item.features = [...item.features, ...workspaceValue]
                    } else {
                        item[depKey] = workspaceValue
                    }
                }
            } else if (Object.keys(item).length > 1) {
                delete item.workspace
                item.version = workspaceItem
            } else {
                pkg[key] = workspaceItem
            }
        } else {
            updateWorkspaceKeys(item, workspaceItem)
        }
    }
}

async function getGitRepoPackages(gitUrl, commit) {
    logInfo(`Loading packages from ${gitUrl}`)
    const gitRepoDir = await fetchGitRepo(gitUrl, commit)
    const packages = {}

    async function pathExists(p) {
        try {
            await fs.access(p)
            return true
        } catch {
            return false
        }
    }

    async function getCargoTomlPackages(absRoot, relRoot = '.', workspace) {
        const cargoTomlPath = path.join(absRoot, 'Cargo.toml')
        if (await pathExists(cargoTomlPath)) {
            const cargoToml = parseToml(await fs.readFile(cargoTomlPath, 'utf-8'))
            const currentWorkspace = cargoToml.workspace || workspace
            if (cargoToml.package) {
                const posixRel = relRoot.split(path.sep).join('/')
                packages[cargoToml.package.name] = {
                    path: posixRel,
                    package: cargoToml,
                    workspace: currentWorkspace,
                }
            }
            workspace = currentWorkspace
        }

        const dirents = await fs.readdir(absRoot, { withFileTypes: true })
        for (const d of dirents) {
            if (d.isDirectory()) {
                await getCargoTomlPackages(
                    path.join(absRoot, d.name),
                    path.join(relRoot, d.name),
                    workspace
                )
            }
        }
    }

    await getCargoTomlPackages(gitRepoDir, '.')
    if (Object.keys(packages).length === 0) {
        throw new Error(`No packages found in ${gitRepoDir}`)
    }
    logDebug(
        'Packages in',
        gitUrl,
        JSON.stringify(
            Object.fromEntries(Object.entries(packages).map(([k, v]) => [k, v.path])),
            null,
            4
        )
    )
    return packages
}

const repoPackagesCache = new Map()

function getGitRepoPackagesCached(repoUrl, commit) {
    const key = `${repoUrl}#${commit}`
    if (!repoPackagesCache.has(key)) {
        repoPackagesCache.set(key, getGitRepoPackages(repoUrl, commit))
    }
    return repoPackagesCache.get(key)
}

async function getGitRepoSources(url, commit, tarball = false) {
    const name = gitRepoName(url, commit)
    if (tarball) {
        const tarballUrl = getGitTarball(url, commit)
        return [
            {
                type: 'archive',
                'archive-type': 'tar-gzip',
                url: tarballUrl,
                sha256: await getRemoteSha256(tarballUrl),
                dest: `${GIT_CACHE}/${name}`,
            },
        ]
    }
    return [
        {
            type: 'git',
            url,
            commit,
            dest: `${GIT_CACHE}/${name}`,
        },
    ]
}

async function getGitPackageSources(pkg, gitRepoCommits) {
    const name = pkg.name
    const source = pkg.source
    const u = new URL(source.replace('git+https://', 'https://'))
    const commit = u.hash ? u.hash.slice(1) : ''
    if (!commit) throw new Error('The commit needs to be indicated in the fragment part')
    const canonical = canonicalUrl(source)
    const repoUrl = canonical.toString()

    if (!gitRepoCommits.has(repoUrl)) gitRepoCommits.set(repoUrl, new Set())
    gitRepoCommits.get(repoUrl).add(commit)

    const packages = await getGitRepoPackagesCached(repoUrl, commit)
    const gitPkg = packages[name]
    if (!gitPkg) throw new Error(`Package ${name} not found in repo ${repoUrl}@${commit}`)

    const normalizedPkg = (() => {
        const cloned = deepClone(gitPkg.package)
        if (gitPkg.workspace) updateWorkspaceKeys(cloned, gitPkg.workspace)
        return cloned
    })()

    const pkgRepoDir = path.posix.join(GIT_CACHE, gitRepoName(repoUrl, commit), gitPkg.path)

    const gitSources = [
        {
            type: 'shell',
            commands: [`cp -r --reflink=auto "${pkgRepoDir}" "${CARGO_CRATES}/${name}"`],
        },
        {
            type: 'inline',
            contents: stringifyToml(normalizedPkg),
            dest: `${CARGO_CRATES}/${name}`,
            'dest-filename': 'Cargo.toml',
        },
        {
            type: 'inline',
            contents: JSON.stringify({ package: null, files: {} }),
            dest: `${CARGO_CRATES}/${name}`,
            'dest-filename': '.cargo-checksum.json',
        },
    ]

    const cargoVendoredEntry = {
        [repoUrl]: {
            git: repoUrl,
            'replace-with': VENDORED_SOURCES,
        },
    }
    const rev = u.searchParams.get('rev')
    const tag = u.searchParams.get('tag')
    const branch = u.searchParams.get('branch')
    if (rev) cargoVendoredEntry[repoUrl].rev = rev
    else if (tag) cargoVendoredEntry[repoUrl].tag = tag
    else if (branch) cargoVendoredEntry[repoUrl].branch = branch

    logInfo(`Adding package ${name} from ${repoUrl}`)
    return [gitSources, cargoVendoredEntry]
}

async function getPackageSources(pkg, cargoLock, gitRepoCommits) {
    const metadata = cargoLock.metadata
    const name = pkg.name
    const version = pkg.version

    if (!Object.prototype.hasOwnProperty.call(pkg, 'source')) {
        logDebug(`${name} has no source`)
        return null
    }
    const source = pkg.source

    if (source.startsWith('git+')) {
        return await getGitPackageSources(pkg, gitRepoCommits)
    }

    const key = `checksum ${name} ${version} (${source})`
    let checksum
    if (metadata && Object.prototype.hasOwnProperty.call(metadata, key)) {
        checksum = metadata[key]
    } else if (Object.prototype.hasOwnProperty.call(pkg, 'checksum')) {
        checksum = pkg.checksum
    } else {
        console.warn(`${name} doesn't have checksum`)
        return null
    }

    const crateSources = [
        {
            type: 'archive',
            'archive-type': 'tar-gzip',
            url: `${CRATES_IO}/${name}/${name}-${version}.crate`,
            sha256: checksum,
            dest: `${CARGO_CRATES}/${name}-${version}`,
        },
        {
            type: 'inline',
            contents: JSON.stringify({ package: checksum, files: {} }),
            dest: `${CARGO_CRATES}/${name}-${version}`,
            'dest-filename': '.cargo-checksum.json',
        },
    ]
    return [crateSources, { 'crates-io': { 'replace-with': VENDORED_SOURCES } }]
}

async function generateSources(cargoLock, gitTarballs = false) {
    const gitRepoCommits = new Map()
    const sources = []
    const packageSources = []
    const cargoVendoredSources = {
        [VENDORED_SOURCES]: { directory: `${CARGO_CRATES}` },
    }

    const pkgPromises = cargoLock.package.map((p) =>
        getPackageSources(p, cargoLock, gitRepoCommits)
    )
    const pkgResults = await Promise.all(pkgPromises)
    for (const pkg of pkgResults) {
        if (!pkg) continue
        const [pkgSrc, cargoVendoredEntry] = pkg
        packageSources.push(...pkgSrc)
        Object.assign(cargoVendoredSources, cargoVendoredEntry)
    }

    logDebug(
        'Adding collected git repos:\n' + JSON.stringify(Array.from(gitRepoCommits.keys()), null, 4)
    )
    const gitRepoCoros = []
    for (const [gitUrl, commits] of gitRepoCommits.entries()) {
        for (const commit of commits) {
            gitRepoCoros.push(getGitRepoSources(gitUrl, commit, gitTarballs))
        }
    }
    const gitRepoSourcesNested = await Promise.all(gitRepoCoros)
    for (const arr of gitRepoSourcesNested) {
        sources.push(...arr)
    }

    sources.push(...packageSources)

    logDebug('Vendored sources:\n' + JSON.stringify(cargoVendoredSources, null, 4))
    sources.push({
        type: 'inline',
        contents: stringifyToml({ source: cargoVendoredSources }),
        dest: CARGO_HOME,
        'dest-filename': 'config',
    })
    return sources
}

function printUsageAndExit() {
    console.error(
        'Usage: node flatpak-cargo-generator.js <Cargo.lock> [-o OUT] [--yaml] [-t|--git-tarballs] [-d|--debug]'
    )
    process.exit(1)
}

async function main() {
    const argv = process.argv.slice(2)
    let output = null
    let yaml = false
    let gitTarballs = false
    let debug = false
    let cargoLockPath = null

    for (let i = 0; i < argv.length; i++) {
        const a = argv[i]
        if (a === '-o' || a === '--output') {
            i++
            output = argv[i]
        } else if (a === '--yaml') {
            yaml = true
        } else if (a === '-t' || a === '--git-tarballs') {
            gitTarballs = true
        } else if (a === '-d' || a === '--debug') {
            debug = true
        } else if (!a.startsWith('-') && !cargoLockPath) {
            cargoLockPath = a
        } else {
            printUsageAndExit()
        }
    }

    if (!cargoLockPath) printUsageAndExit()

    DEBUG = debug
    const cargoLock = await loadToml(cargoLockPath)

    let outfile
    if (output) outfile = output
    else if (yaml) outfile = 'generated-sources.yml'
    else outfile = 'generated-sources.json'

    const generatedSources = await generateSources(cargoLock, gitTarballs)

    if (yaml) {
        await fs.writeFile(outfile, stringifyYaml(generatedSources))
    } else {
        await fs.writeFile(outfile, JSON.stringify(generatedSources, null, 4))
    }
}

if (
    import.meta.url === `file://${process.argv[1]}` ||
    process.argv[1].endsWith('flatpak-cargo-generator.js')
) {
    main().catch((err) => {
        console.error(err)
        process.exit(1)
    })
}
