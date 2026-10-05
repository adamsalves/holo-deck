import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import { readdirSync, readFileSync, readlinkSync, rmSync } from 'node:fs'
import { cp, mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { REPO_ROOT } from './source-tree.ts'

/**
 * A server the build made, running outside the repository — so the probe can ask
 * it what it answers.
 *
 * Two of them, one per preset, and one way of running both:
 *
 * - **the Vercel function** (`.vercel/output/functions/__fallback.func`), which
 *   exports a plain Node handler, `(req, res) => …`, that Vercel calls once per
 *   request. A `node:http` server goes in front of it: the server is Node's and
 *   the handler is the build's, so whatever the handler does with a request —
 *   read the dex it ships, render a page, throw — is what Vercel runs;
 * - **the Node server** (`.output/server`), which listens on its own.
 *
 * **It runs a copy, in a temporary folder, and that is the point.** A deploy gets
 * the build's folder and nothing else: on Vercel the function is unpacked alone
 * at `/var/task`, which is also its working directory. Started where the build
 * left it, with only the working directory moved, it still had the whole
 * repository within reach — Node resolves a bare import by walking up the parent
 * folders, so a function with no `node_modules` of its own found the project's
 * and passed. Measured: with the function's `node_modules` renamed away the gate
 * stayed green, and the same folder copied out of the repository died importing
 * `better-auth`.
 *
 * **And nothing in it may name the repository**, which the copy alone does not
 * catch: a build that stops tracing its dependencies writes
 * `file:///<repository>/node_modules/…` into its chunks, and that path exists on
 * the machine that built it wherever the copy runs. So every file of the copy is
 * read for the repository's own path, and every link for a target outside the
 * copy, before anything is started.
 *
 * **The child says when it is ready, and the child is the one that was started.**
 * It prints a line with the port it listens on, and that line is what is waited
 * for — not the port answering, which any older server left on it would do just
 * as well. A child that dies first becomes an error carrying its own `stderr`,
 * and so does one that dies while it is being asked; one that never says
 * anything is given up on.
 *
 * **It cannot outlive whoever started it.** The child leaves when its `stdin`
 * closes, which is what happens when the parent goes away for any reason; a
 * child that ignores `SIGTERM` is killed; and the folder is removed on the way
 * out, on a signal too. It gets an environment of its own instead of this
 * process's, so what it answers does not depend on the shell it was run from.
 *
 * It runs in plain `node` for `scripts/check-vercel-bundle.ts`, so it imports
 * only `node:` modules and `.ts` files by their full name.
 */

/**
 * How long a server has to say it is listening: a cold import of its bundle.
 * Under the 30 s a Playwright test is given, so that a server that never starts
 * fails with the reason printed here and not with the test's bare timeout.
 */
const START_TIMEOUT_MS = 20_000

/** How long a child that was told to leave has before it is made to. */
const STOP_TIMEOUT_MS = 5_000

/** How many file names one message spells out before it gives the count. */
const LIST_LIMIT = 5

/** The entry file both presets write at the top of their server folder. */
const ENTRY = 'index.mjs'

/** The repository's own path: what nothing a deploy carries may name. */
const REPOSITORY = resolve(REPO_ROOT)

/**
 * Runs first in every child. Its `stdin` is a pipe only the parent holds, so the
 * end of it is the parent being gone — by whatever means, a `SIGKILL` included.
 */
const LEAVES_WITH_PARENT = `
process.stdin.resume()
process.stdin.on('end', () => process.exit(0))
`

/** What the function's child prints once it listens: no handler prints this by accident. */
const FUNCTION_READY = 'holo-deck function listening on port'

/** Puts a `node:http` server in front of the handler. `process.argv[1]` is the URL of the entry file. */
const FUNCTION_BOOTSTRAP = `
import http from 'node:http'
const { default: handler } = await import(process.argv[1])
http.createServer((req, res) => handler(req, res)).listen(0, '127.0.0.1', function () {
  console.log('${FUNCTION_READY} ' + this.address().port)
})
`

/** The Node server listens when it is imported, and says so itself. */
const NODE_BOOTSTRAP = `
await import(process.argv[1])
`

/**
 * The port the Node server is given. Not 0: Nitro reads it as
 * `destr(process.env.PORT) || 3000`, so a 0 becomes 3000. A fixed port can be
 * taken, and then the child dies of `EADDRINUSE` and the run fails saying so —
 * which is the answer, where the port merely answering used to be a pass.
 */
const NODE_PORT = 3311

interface Build {
  /** What the messages call it. */
  readonly name: string
  /** Lays the build out under `root` and returns the folder its code was copied to. */
  readonly place: (root: string) => Promise<string>
  /** What the child runs, after `LEAVES_WITH_PARENT`. */
  readonly bootstrap: string
  /** The child's whole environment, besides `NODE_ENV`. */
  readonly env: Readonly<Record<string, string>>
  /** The line the child prints once it listens; its one group is the port. */
  readonly ready: RegExp
}

/**
 * Copies a folder of the build out of the repository.
 *
 * `verbatimSymlinks`, because the build's `node_modules` holds relative links
 * (`zod -> .nitro/zod@4.6.1`) and without it `cp` rewrites each one as an
 * absolute path into the folder it was copied **from**: the copy would run on
 * the repository's files after all.
 */
async function copyOut(from: string, to: string): Promise<void> {
  await cp(from, to, { recursive: true, verbatimSymlinks: true })
}

/**
 * How many files of `folder` were read, and which of them name the repository —
 * or, for a link, point out of the folder.
 */
function outsideReferences(folder: string): { read: number, naming: string[] } {
  const naming: string[] = []
  let read = 0

  for (const entry of readdirSync(folder, { withFileTypes: true, recursive: true })) {
    const path = join(entry.parentPath, entry.name)
    let names = false

    if (entry.isSymbolicLink()) {
      names = !resolve(entry.parentPath, readlinkSync(path)).startsWith(`${folder}${sep}`)
    }
    else if (entry.isFile()) {
      read += 1
      names = readFileSync(path).includes(REPOSITORY)
    }

    if (names) naming.push(relative(folder, path).replaceAll(sep, '/'))
  }

  return { read, naming }
}

interface Started {
  readonly base: string
  /** The tail of what the child has written to `stderr` so far. */
  readonly errors: () => string
}

/** Resolves with the server's address once the child says which port it has. */
function started(build: Build, child: ChildProcess): Promise<Started> {
  return new Promise((succeed, reject) => {
    let printed = ''
    let errors = ''
    let settled = false
    const tail = (): string => errors.trim().slice(-2000)

    const fail = (reason: string): void => {
      if (settled) return

      settled = true
      clearTimeout(timer)
      reject(new Error(`${build.name} ${reason}\n${tail()}`))
    }
    const timer = setTimeout(() => fail(`did not start listening within ${START_TIMEOUT_MS / 1000} s`), START_TIMEOUT_MS)

    child.stdout?.on('data', (chunk: unknown) => {
      if (settled) return

      printed += String(chunk)
      const port = build.ready.exec(printed)?.[1]
      if (port === undefined) return

      settled = true
      clearTimeout(timer)
      succeed({ base: `http://127.0.0.1:${port}`, errors: tail })
    })
    child.stderr?.on('data', (chunk: unknown) => {
      errors = `${errors}${String(chunk)}`.slice(-4000)
    })
    child.on('error', error => fail(`could not be started: ${error.message}`))
    child.on('exit', (code, signal) => fail(`exited before it was ready (${signal ?? `code ${String(code)}`})`))
  })
}

function hasLeft(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null
}

/**
 * Tells the child to leave and, past `STOP_TIMEOUT_MS`, makes it: a server that
 * traps `SIGTERM` must not hang the gate.
 */
async function stop(child: ChildProcess): Promise<void> {
  if (hasLeft(child)) return

  const left = new Promise<void>((succeed) => {
    child.once('exit', () => succeed())
  })
  child.kill('SIGTERM')
  const force = setTimeout(() => child.kill('SIGKILL'), STOP_TIMEOUT_MS)

  await left
  clearTimeout(force)
}

/**
 * Removes `root` if this process is told to leave while the server is up — a
 * `finally` does not run on a signal — and then sends the signal again, to
 * whatever would have handled it. Returns what takes the handlers back off.
 */
function removeOnSignal(root: string): () => void {
  const handlers = (['SIGINT', 'SIGTERM'] as const).map((signal) => {
    const handler = (): void => {
      rmSync(root, { recursive: true, force: true })
      process.kill(process.pid, signal)
    }
    process.once(signal, handler)

    return { signal, handler }
  })

  return () => {
    for (const { signal, handler } of handlers) process.removeListener(signal, handler)
  }
}

async function withServer<T>(build: Build, run: (base: string, root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), 'holo-deck-server-'))
  const forget = removeOnSignal(root)

  try {
    const code = await build.place(root)

    // The other side first: a copy with nothing in it names no path either.
    const { read, naming } = outsideReferences(code)
    if (read === 0) throw new Error(`${build.name}: its copy has no file in it, so there was nothing to read for the repository's path`)
    if (naming.length > 0) {
      const shown = `${naming.slice(0, LIST_LIMIT).join(', ')}${naming.length > LIST_LIMIT ? `, … and ${naming.length - LIST_LIMIT} more` : ''}`
      throw new Error(`${build.name} names the repository's own path, or links out of the build, in ${naming.length} place(s) among the ${read} file(s) it carries — ${shown} — so it only runs on the machine that built it`)
    }

    const child = spawn(process.execPath, ['--input-type=module', '-e', `${LEAVES_WITH_PARENT}${build.bootstrap}`, pathToFileURL(join(code, ENTRY)).href], {
      cwd: code,
      env: { NODE_ENV: 'production', ...build.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    try {
      const { base, errors } = await started(build, child)
      const result = await run(base, root)

      // A server that died while it was being asked answers nothing, and all the
      // caller saw was "no answer": the reason is in what it wrote on its way out.
      if (hasLeft(child)) {
        throw new Error(`${build.name} exited while it was being asked (${child.signalCode ?? `code ${String(child.exitCode)}`})\n${errors()}`)
      }

      return result
    }
    finally {
      await stop(child)
    }
  }
  finally {
    forget()
    await rm(root, { recursive: true, force: true })
  }
}

/**
 * Starts the Vercel function of `functionDir` from a copy of it, calls `run` with
 * its address and the temporary folder it all lives in, and always stops it and
 * removes that folder afterwards — the caller cannot forget to.
 *
 * The folder goes to `run` because it is one of the things a response must never
 * contain. The function's working directory is its own folder, as on Vercel.
 */
export function withFunctionServer<T>(functionDir: string, run: (base: string, root: string) => Promise<T>): Promise<T> {
  return withServer({
    name: 'the Vercel function',
    place: async (root) => {
      const code = join(root, 'function')
      await copyOut(functionDir, code)

      return code
    },
    bootstrap: FUNCTION_BOOTSTRAP,
    env: {},
    ready: new RegExp(`^${FUNCTION_READY} (\\d+)\\n`, 'm'),
  }, run)
}

/**
 * The same for the Node server of `outputDir`, which is `.output`.
 *
 * Its code is copied. `public/` is linked beside the copy, where the server looks
 * for it: it is 143 MB of files the server only hands out, and no import is ever
 * resolved through it.
 */
export function withNodeServer<T>(outputDir: string, run: (base: string, root: string) => Promise<T>): Promise<T> {
  return withServer({
    name: 'the Node server',
    place: async (root) => {
      const code = join(root, 'server')
      await copyOut(join(outputDir, 'server'), code)
      await symlink(join(outputDir, 'public'), join(root, 'public'))

      return code
    },
    bootstrap: NODE_BOOTSTRAP,
    env: { PORT: String(NODE_PORT), NITRO_HOST: '127.0.0.1' },
    ready: /^Listening on http:\/\/127\.0\.0\.1:(\d+)\/?\n/m,
  }, run)
}
