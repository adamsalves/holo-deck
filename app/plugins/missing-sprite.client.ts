import { defineNuxtPlugin } from 'nuxt/app'
import glyph from '~~/app/assets/images/missing-sprite.svg?inline'

/**
 * A thumbnail that does not load shows the offline glyph instead — the board
 * *Offline*, "the card with and without the thumbnail". Offline, a thumbnail no
 * screen showed and nobody downloaded is not on the device; fifteen places in
 * twelve files ask for one, the board gives all of them the glyph, and this one
 * listener reaches them without touching any.
 *
 * **Capture, on the window, and the event stops here.** An image's `error` does
 * not bubble, but on its way down it passes the window before any listener on
 * the image itself, and two of those would undo the glyph: `UAvatar`, in the
 * search, swaps an image that fails for an empty `<span>`; and the battle's
 * `fallbackSprite` sets the thumbnail on its image — the very address that just
 * failed, which is the classic `onerror` loop. Stopping the event closes both:
 * the image keeps its box and its `alt`, and it falls back once — the board's
 * "once per image, never in a loop".
 *
 * **The glyph is inlined** (`?inline`): it shows at the moment a request failed,
 * and a picture of its own would be one more request, answered only if the
 * worker installed it. It is an `.svg` and not markup here because an image
 * cannot read the page's custom properties: the colour is written in the file,
 * `--color-ink-400`, which the board gives the glyph on the card. The file's
 * `viewBox` pads the board's 24-unit glyph to 34 px in every 96, as the card
 * draws it, so the proportion holds at whatever size a thumbnail is drawn.
 *
 * Installed before the app mounts. What it cannot reach is a thumbnail of a
 * prerendered page that failed before that — but offline every page comes from
 * the shell, and the shell's images are all created by the app, after this.
 */
export default defineNuxtPlugin(() => {
  window.addEventListener('error', (event) => {
    const image = event.target
    if (!(image instanceof HTMLImageElement)) return
    if (image.getAttribute('src')?.startsWith('/sprites/') !== true) return

    event.stopPropagation()
    image.src = glyph
  }, true)
})
