import { execSync } from 'child_process'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { unlink } from 'fs/promises'

// Get the project root directory
const __dirname = fileURLToPath(new URL('.', import.meta.url))
const projectRoot = join(__dirname, '..')

async function buildExternal() {
    try {
        // Compile TypeScript using local tsc
        console.log('Compiling TypeScript...')
        execSync(
            'npx tsc main.ts --target es2020 --module esnext --moduleResolution bundler --listEmittedFiles',
            {
                stdio: 'inherit',
                cwd: projectRoot,
            }
        )

        // Bundle with esbuild
        console.log('Bundling with esbuild...')
        execSync(
            'npx esbuild main.js --bundle --format=esm --target=esnext --outfile=out.js --minify --legal-comments=none',
            {
                stdio: 'inherit',
                cwd: projectRoot,
            }
        )

        // Move output file to public directory
        console.log('Moving output file to public directory...')
        execSync('mv ./out.js ./public/out.js', {
            stdio: 'inherit',
            cwd: projectRoot,
        })

        // Clean up temporary files
        console.log('Cleaning up...')
        await Promise.all([
            // Remove lib/*.js files
            execSync('rm -rf ./lib/**/**.js && rm -rf ./lib/**.js', {
                stdio: 'inherit',
                cwd: projectRoot,
            }),
            // Remove main.js
            unlink(join(projectRoot, 'main.js')).catch(() => {}), // Ignore if file doesn't exist
        ])

        console.log('Build completed successfully!')
    } catch (error) {
        console.error('Build failed:', error)
        process.exit(1)
    }
}

// If script is run directly (not imported)
if (import.meta.url === `file://${process.argv[1]}`) {
    buildExternal()
}

export default buildExternal
