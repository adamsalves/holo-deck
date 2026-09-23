import { defineNuxtPlugin } from 'nuxt/app'
import { SERVICE_WORKER_PATH } from '~~/app/utils/offline'

/**
 * Registers the worker that keeps the game playable offline — see
 * `scripts/service-worker/worker.ts` for what it keeps and how it answers.
 *
 * **After `load`.** The install downloads the whole first layer — 2.1 MB on
 * disk, about 680 KB over the wire — and starting it while the first page is
 * still arriving would make the two compete for the same connection.
 *
 * **Never in development.** The build writes the worker once the prerender is
 * done, and `yarn dev` has neither; a worker left behind by a build would answer
 * the dev server's requests with that build's code.
 *
 * **A refusal is silent, and costs only the offline mode.** A private window,
 * blocked site data, a browser without service workers — and the test suite,
 * which blocks them everywhere but `offline.spec.ts` — play exactly as the game
 * did before the worker existed.
 */
export default defineNuxtPlugin(() => {
  if (import.meta.dev || !('serviceWorker' in navigator)) return

  const register = (): void => {
    navigator.serviceWorker.register(SERVICE_WORKER_PATH).catch(() => undefined)
  }

  if (document.readyState === 'complete') register()
  else window.addEventListener('load', register, { once: true })
})
