import { nextTick } from 'vue'

/**
 * Where the keyboard goes when the control that had it is taken from under it.
 *
 * A control that leaves the page — or turns `disabled` — because of its own
 * action drops the focus on `<body>`, and the next Tab starts again from the top
 * of the document. Measured on 29/09/2026 by pressing Enter on 214 stops of the
 * game: 22 did that, among them the six of the deck and the battle. One rule
 * mends them all, and it lives here so the sites cannot disagree about it: once
 * the screen has caught up with the action, if the control that had the focus is
 * gone, the focus goes to `target` — and to the page's `#content` when there is
 * none, or when it cannot take it.
 *
 * **Only when the keyboard was on the control**, which is `:focus-visible`, and
 * not "it had the focus". The first version asked the second, reasoning from
 * Safari, where a click focuses no button. Chromium and Firefox do focus the
 * button they click, so the helper acted for every mouse and every finger, and
 * `focus()` scrolls to what it focuses: a click on the last pick of a long list
 * took the view from 5091px to the top of the page, where `main` moved it 146px
 * as the list closed up (measured on 01/10/2026, in the review of PR #82). A
 * pointer press leaves the focus and the view where the browser put them.
 *
 * `document.activeElement` is read at the call, before the DOM has caught up, so
 * call this in the same tick as the state change. An action that finishes later
 * hands its work over as `after`, the promise the screen waits for — awaited
 * whoever pressed, so a caller that awaits this finds its own work done. `target`
 * is asked last, so it can look for an element the new screen has just drawn.
 */
export async function keepFocus(
  target: () => HTMLElement | null | undefined,
  after?: Promise<unknown>,
): Promise<void> {
  const pressed = document.activeElement
  const from = pressed instanceof HTMLElement && pressed.matches(':focus-visible') ? pressed : null

  if (after !== undefined) await after
  if (from === null) return
  await nextTick()

  const active = document.activeElement
  const gone = !from.isConnected || from.matches(':disabled')
  if (!gone || (active !== from && active !== document.body)) return

  moveFocus(target())
}

/**
 * Puts the focus on `target` — on the page's `#content` when there is none, or
 * when it cannot take it — and holds the key that brought it there.
 */
export function moveFocus(target: HTMLElement | null | undefined): void {
  target?.focus()
  if (document.activeElement !== target) document.getElementById('content')?.focus()

  swallowRepeats()
}

/**
 * Keeps one key press from pressing two controls.
 *
 * The key that pressed a control is still down when the focus lands on the next
 * one, and a key held down repeats: Enter on a button presses it at every repeat.
 * Before the focus followed the action there was nothing under the key — the
 * control was gone and the focus was the page's. With a target, the repeat
 * pressed it. Measured on 01/10/2026 with Enter held for 0.8s: on a suggestion of
 * the forge it pressed FORJAR ten times (400 dust down to 200), on COMPRAR it
 * spent 1,200 coins, on the × of a slot it emptied the deck and fielded it again.
 * A press of 80ms did one thing, which is why no walk of the suite saw it.
 *
 * So whoever moves the focus calls this, and the repeats of the key that is down
 * reach nothing — neither the control nor a handler above it — until it comes
 * up. A new press ends the hold too: after a Space, which acts on the way up,
 * there is no key down to wait for, and the next one must not be swallowed.
 */
export function swallowRepeats(): void {
  const hold = new AbortController()

  window.addEventListener('keydown', (event) => {
    if (!event.repeat) {
      hold.abort()
      return
    }

    event.preventDefault()
    event.stopPropagation()
  }, { capture: true, signal: hold.signal })

  window.addEventListener('keyup', () => hold.abort(), { capture: true, signal: hold.signal })
}
