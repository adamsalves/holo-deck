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
 * **Only when the control had the focus before the action.** Safari does not
 * focus a button on click, so there the focus is `<body>` to begin with, and
 * moving it would drag the view and the ring to a player who never touched the
 * keyboard. The same goes for a focus that went elsewhere while the action ran:
 * it is theirs now.
 *
 * `document.activeElement` is read at the call, before the DOM has caught up, so
 * call this in the same tick as the state change. An action that finishes later
 * hands its work over as `after`, the promise the screen waits for. `target` is
 * asked last, so it can look for an element the new screen has just drawn.
 */
export async function keepFocus(
  target: () => HTMLElement | null | undefined,
  after?: Promise<unknown>,
): Promise<void> {
  const from = document.activeElement
  if (!(from instanceof HTMLElement) || from === document.body) return

  if (after !== undefined) await after
  await nextTick()

  const active = document.activeElement
  const gone = !from.isConnected || from.matches(':disabled')
  if (!gone || (active !== from && active !== document.body)) return

  const next = target()
  next?.focus()
  if (document.activeElement !== next) document.getElementById('content')?.focus()
}
