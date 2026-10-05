import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * The Vercel function, running — so the probe can ask it what it answers.
 *
 * `.vercel/output/functions/__fallback.func/index.mjs` exports a plain Node
 * handler, `(req, res) => …`, which Vercel calls once per request. This puts a
 * `node:http` server in front of it, in a child process, and hands the caller its
 * address. **The server is Node's and the handler is the build's**: whatever the
 * handler does with a request — read the dex it ships, render a page, throw — is
 * what Vercel runs.
 *
 * **From a working directory that is not the project's, and that is the point.**
 * It is the shape `test/e2e/server-runtime.spec.ts` uses for the Node preset and
 * the one that reproduces a deploy: the function's own folder is where its files
 * are, and nothing the build left under the project root is within reach. A
 * function that reads the disk through `process.cwd()` works from the root and
 * breaks from here, which is the defect this exists to catch.
 *
 * The child listens on port 0 and prints the port it got, which doubles as the
 * readiness signal and collides with nothing. A child that dies first becomes an
 * error carrying its own `stderr`; one that never says anything is given up on.
 *
 * It runs in plain `node` for `scripts/check-vercel-bundle.ts`, so it imports
 * only `node:` modules and nothing that needs a bundler.
 */

/** How long the function has to start listening: a cold import of its bundle. */
const START_TIMEOUT_MS = 30_000

/** Runs in the child. `process.argv[1]` is the URL of the function's entry file. */
const HARNESS = `
import http from 'node:http'
const { default: handler } = await import(process.argv[1])
http.createServer((req, res) => handler(req, res)).listen(0, '127.0.0.1', function () {
  console.log('listening ' + this.address().port)
})
`

/** Resolves with the server's address once the child says which port it has. */
function listening(child: ChildProcess): Promise<string> {
  return new Promise((resolve, reject) => {
    let printed = ''
    let errors = ''

    const fail = (reason: string): void => {
      clearTimeout(timer)
      reject(new Error(`the Vercel function ${reason}\n${errors.trim().slice(-2000)}`))
    }
    const timer = setTimeout(() => fail(`did not start listening within ${START_TIMEOUT_MS / 1000} s`), START_TIMEOUT_MS)

    child.stdout?.on('data', (chunk: unknown) => {
      printed += String(chunk)
      const port = /listening (\d+)/.exec(printed)?.[1]
      if (port === undefined) return

      clearTimeout(timer)
      resolve(`http://127.0.0.1:${port}`)
    })
    child.stderr?.on('data', (chunk: unknown) => {
      errors += String(chunk)
    })
    child.on('error', error => fail(`could not be started: ${error.message}`))
    child.on('exit', (code, signal) => fail(`exited before it was ready (${signal ?? `code ${String(code)}`})`))
  })
}

/**
 * Starts the function in `functionDir`, calls `run` with its address and the
 * working directory it was started from, and always stops it and removes that
 * directory afterwards — the caller cannot forget to.
 *
 * The working directory goes to `run` because it is one of the things a response
 * must never contain.
 */
export async function withFunctionServer<T>(
  functionDir: string,
  run: (base: string, cwd: string) => Promise<T>,
): Promise<T> {
  const cwd = await mkdtemp(join(tmpdir(), 'holo-deck-function-'))
  const entry = pathToFileURL(join(functionDir, 'index.mjs')).href
  const child = spawn(process.execPath, ['--input-type=module', '-e', HARNESS, entry], {
    cwd,
    env: { ...process.env, NODE_ENV: 'production' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  try {
    return await run(await listening(child), cwd)
  }
  finally {
    child.kill('SIGTERM')
    await rm(cwd, { recursive: true, force: true })
  }
}
