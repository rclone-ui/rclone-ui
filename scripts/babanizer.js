import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const releaseMdPath = join(__dirname, '..', 'release.md')
const content = readFileSync(releaseMdPath, 'utf-8')

const escaped = content.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')

console.log(escaped)
