import { expect, test } from '@playwright/test'
import type { Browser, Locator, Page } from '@playwright/test'
import { buttonKinds, buttonTags, dynamicClasses } from '../support/buttons'
import { defaultLocale, label, message } from '../support/locales'
import { openScene, recordFights, sceneList } from './support'
import type { Fights, Scene } from './support'

/**
 * The keyboard is never left on `<body>` by the control it just used, and never
 * left under the bar.
 *
 * A control that leaves the page, or turns `disabled`, because of its own action
 * takes the focus with it, and the next Tab starts again from the top of the
 * document: 22 of 214 stops, measured on 29/09/2026. One rule mends them
 * (`keepFocus`), and this file holds it from four sides. The **census** presses
 * one button of every kind in every state, the kinds coming from the disk
 * (`test/support/buttons.ts`); the **targets** ask by name where the focus goes,
 * because not on `<body>` is only the floor; the **announcer** says where a link
 * that went away with its page took the player; and the **bar** stays off the
 * stops at 360px, where it is 217px tall.
 *
 * Every press is Enter on a focused control, in a page the client has taken over:
 * a key before that runs no handler, and the walk would pass over a defect that
 * never got to happen.
 */

const CODE = defaultLocale()

/** The recorded fights of this run, made once: playing them is what costs. */
let recorded: Promise<Fights> | undefined
function fightsOf(browser: Browser, baseURL: string | undefined): Promise<Fights> {
  if (baseURL === undefined) throw new Error('the suite runs without a baseURL')
  recorded ??= recordFights(browser, baseURL)

  return recorded
}

/** A scene in a context of its own, gone when `run` is done: no route, session or save outlives its state. */
async function inScene(
  browser: Browser,
  baseURL: string | undefined,
  scene: Scene,
  run: (page: Page) => Promise<unknown>,
  viewport = { width: 1280, height: 900 },
): Promise<void> {
  const origin = new URL(baseURL ?? '').origin
  const context = await browser.newContext({ baseURL: origin, viewport, serviceWorkers: 'block' })

  try {
    const page = await context.newPage()
    await openScene(page, scene, { origin })
    await run(page)
  }
  finally {
    await context.close()
  }
}

async function sceneNamed(browser: Browser, baseURL: string | undefined, name: string): Promise<Scene> {
  const scene = sceneList(await fightsOf(browser, baseURL)).find(candidate => candidate.name === name)
  if (scene === undefined) throw new Error(`no scene is called “${name}”`)

  return scene
}

/** Focuses a control and presses Enter on it, as a keyboard does. */
async function enter(control: Locator): Promise<void> {
  await control.focus()
  await control.page().keyboard.press('Enter')
}

const button = (page: Page, name: string): Locator => page.getByRole('button', { name, exact: true })
const link = (page: Page, name: string): Locator => page.getByRole('link', { name, exact: true })

// The census ---------------------------------------------------------------

const TAGS = buttonTags()
const KINDS = buttonKinds(TAGS)
const DYNAMIC = dynamicClasses(TAGS)

/**
 * Kinds not pressed **because of what the press does**, named by a class of
 * theirs with the reason. Each has to be on a button of `app/` and to have shown
 * up on a screen unpressed: an entry for a control no state draws is one for nothing.
 */
const PRESSING_WOULD: Readonly<Record<string, string>> = {
  'login__github': 'it leaves for GitHub\'s consent screen, which needs a human',
  'settings__action--danger': 'it asks `window.confirm`, and a dialog the census dismisses makes the press nothing',
  'settings__action--destroy': 'it asks `window.confirm`, then deletes the account and signs out',
}

/**
 * Kinds **no scene draws**, so the census cannot press them — the gap, written as
 * one. The boot's notices and the restore of a saved version need a state only a
 * server or a damaged save makes, and their buttons leave the page like every
 * other; they are not mended in this PR (README, *Foco depois de uma ação*). Each
 * has to be on a button of `app/` and on no screen: once a scene draws one, the
 * census presses it and its entry goes.
 */
const NO_SCENE: Readonly<Record<string, string>> = {
  'save-notice__dismiss': 'the recovery notice needs a save that cannot be read',
  'conflict__ok': 'the conflict notice needs a write the server answers 409 to',
  'choice__use': 'the choice between two collections needs an account and a save on each side',
  'settings__action--caution': 'restoring the previous version needs an account with one on the server',
}

/**
 * Presses that end in a new document, by scene and kind: signing out reloads the
 * page. By name, and each has to do it — a button that replaces the document and
 * is not here fails, and so does one that is here and does not. Exempting by
 * effect would let any button that reloads the page through.
 */
const LEAVES_THE_PAGE = [
  { scene: 'an account', kind: 'account__out' },
  { scene: 'an account', kind: 'bevel-control settings__action' },
]

const tokensOf = (kind: string): string[] => kind.split(' ')
const exempt = (kind: string): boolean => tokensOf(kind).some(token => token in PRESSING_WOULD || token in NO_SCENE)

interface Reachable { readonly kind: string, readonly text: string }

/**
 * What a keyboard can press in the scene — and, given a button to `pick`, the
 * press's first half: focus it, and mark the document so a new one can be told.
 * Reachable is what Tab reaches: enabled, drawn, not behind a modal that took the
 * page, not in an `inert` or `aria-hidden` subtree. `seen` is every kind on the
 * page whatever its state, for the entries that ask to be seen.
 */
function reachableButtons(page: Page, pick?: Reachable) {
  return page.evaluate(({ dynamic, pick }) => {
    const state = new Set(dynamic)
    const modal = document.querySelector('[aria-modal="true"]')
    const seen = new Set<string>()
    const found: { kind: string, text: string }[] = []
    let picked = false

    for (const button of Array.from(document.querySelectorAll('button'))) {
      const kind = Array.from(button.classList).filter(name => !state.has(name)).sort().join(' ')
      seen.add(kind)

      if (button.disabled || !button.checkVisibility()) continue
      if (modal !== null && !modal.contains(button)) continue
      if (button.closest('[inert], [aria-hidden="true"]') !== null) continue

      const text = (button.getAttribute('aria-label') ?? button.textContent ?? '').trim().replaceAll(/\s+/g, ' ').slice(0, 40)
      found.push({ kind, text })

      if (pick !== undefined && !picked && pick.kind === kind) {
        picked = true
        Reflect.set(window, 'e2eDocument', true)
        button.focus()
      }
    }

    return { found, seen: [...seen] }
  }, { dynamic: DYNAMIC, pick })
}

interface Outcome { readonly navigated: boolean, readonly lost: boolean, readonly holder: string }

/**
 * Where the focus is once the press has done everything it does: nothing in
 * flight, and the DOM quiet for a while. A press that takes the document with it
 * ends the evaluation, and that is an outcome too.
 */
async function outcomeOf(page: Page, inFlight: () => number): Promise<Outcome> {
  try {
    await expect.poll(inFlight, { message: 'a request never finished', timeout: 10_000 }).toBe(0)
    await page.evaluate(() => new Promise<void>((resolve) => {
      // Quiet for 250ms — or 5s at most: a page that never stops changing must not hold the walk.
      const cap = window.setTimeout(done, 5000)
      let timer = window.setTimeout(done, 250)
      const observer = new MutationObserver(() => {
        window.clearTimeout(timer)
        timer = window.setTimeout(done, 250)
      })
      function done(): void {
        window.clearTimeout(cap)
        window.clearTimeout(timer)
        observer.disconnect()
        resolve()
      }
      observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true })
    }))

    return await page.evaluate(() => {
      const active = document.activeElement
      const classes = active === null || active.classList.length === 0 ? '' : `.${Array.from(active.classList).join('.')}`

      return {
        navigated: Reflect.get(window, 'e2eDocument') !== true,
        lost: active === null || active === document.body || active === document.documentElement || !active.isConnected || active.matches(':disabled'),
        holder: active === null ? 'nothing' : `${active.tagName.toLowerCase()}${classes}${active.id === '' ? '' : `#${active.id}`}`,
      }
    })
  }
  catch (error) {
    if (!String(error).includes('Execution context was destroyed')) throw error

    return { navigated: true, lost: false, holder: 'a new document' }
  }
}

/** Scenes that exist to press something, by name: one that lost its buttons must not go quiet. */
const PRESSES_SOMETHING = [
  'the fight', '/deck', '/collection', '/packs', '/pokedex/1', '/settings', 'an account',
  'the Hub with a fight on', 'a gym while another fight is on', 'the forge with a search typed',
  'the search palette', 'the account invite', 'a fight whose lead faints on the first move',
  'a fight one move from its end', 'a fight asking for a switch', 'a fight that was lost',
  'a pack opening, turning', 'a pack opening, all revealed', 'the deck with room for more',
  'the forge with a card chosen and the dust to make it',
]

test('no button a keyboard can press drops the focus on the page', async ({ browser, baseURL }) => {
  test.setTimeout(900_000)

  const pressed = new Map<string, string[]>()
  const seen = new Set<string>()

  for (const scene of sceneList(await fightsOf(browser, baseURL))) {
    let found: Reachable[] = []

    await inScene(browser, baseURL, scene, async (page) => {
      const read = await reachableButtons(page)
      found = read.found
      for (const kind of read.seen) seen.add(kind)

      // A page that takes the focus as it loads is one the skip link no longer reaches.
      if (scene.open === undefined && scene.invite === undefined) {
        const holder = await page.evaluate(() => (document.activeElement === document.body ? '' : document.activeElement?.className ?? 'something'))
        expect.soft(holder, `${scene.name}: the page took the focus as it loaded`).toBe('')
      }
    })

    for (const kind of new Set(found.map(item => item.kind))) {
      const target = found.find(item => item.kind === kind)
      if (target === undefined || exempt(kind)) continue

      await inScene(browser, baseURL, scene, async (page) => {
        const inFlight = new Set<unknown>()
        page.on('request', request => inFlight.add(request))
        page.on('requestfinished', request => inFlight.delete(request))
        page.on('requestfailed', request => inFlight.delete(request))

        await reachableButtons(page, target)
        await page.keyboard.press('Enter')
        const outcome = await outcomeOf(page, () => inFlight.size)
        pressed.set(kind, [...(pressed.get(kind) ?? []), scene.name])

        const expected = LEAVES_THE_PAGE.some(entry => entry.scene === scene.name && entry.kind === kind)
        const press = `${scene.name}: Enter on \`${kind}\` (“${target.text}”)`
        expect.soft(outcome.navigated, `${press} ${expected ? 'did not replace the document, and its entry says it does' : 'replaced the document'}`).toBe(expected)
        if (!outcome.navigated) expect.soft(outcome.lost, `${press} left the focus on ${outcome.holder}`).toBe(false)
      })
    }
  }

  // The other side, by name: a count over the sum stays green with a whole scene gone quiet.
  const pressedIn = new Set([...pressed.values()].flat())
  expect.soft(PRESSES_SOMETHING.filter(name => !pressedIn.has(name)), 'scenes that pressed nothing').toEqual([])
  for (const { scene, kind } of LEAVES_THE_PAGE) {
    expect.soft(pressed.get(kind)?.includes(scene), `\`${kind}\` was not pressed in “${scene}”`).toBe(true)
  }

  // The disk: every kind of button of `app/` was pressed, or is named with its reason.
  expect(
    [...KINDS].filter(([kind]) => !pressed.has(kind) && !exempt(kind))
      .map(([kind, tags]) => `${kind} — ${tags.map(tag => `${tag.file}:${tag.line}`).join(', ')}`),
    'kinds of button no scene presses: draw the state, or name the kind with its reason',
  ).toEqual([])

  const shown = (token: string): boolean => [...seen].some(kind => tokensOf(kind).includes(token))
  const written = (token: string): boolean => [...KINDS.keys()].some(kind => tokensOf(kind).includes(token))
  for (const [token, reason] of Object.entries(PRESSING_WOULD)) {
    expect.soft(written(token), `\`${token}\` is on no button of app/: ${reason}`).toBe(true)
    expect.soft(shown(token), `\`${token}\` never showed up on a screen: ${reason}`).toBe(true)
  }
  for (const [token, reason] of Object.entries(NO_SCENE)) {
    expect.soft(written(token), `\`${token}\` is on no button of app/: ${reason}`).toBe(true)
    expect.soft(shown(token), `\`${token}\` is on a screen now: the census presses it, and the entry goes (${reason})`).toBe(false)
  }
})

// The targets, by name -------------------------------------------------------

const pickName = (name: string, number: string): string => message('deck.collection.pickLabel', CODE, { number, name })
const removeName = (name: string, slot: number): string => message('deck.slot.removeLabel', CODE, { name, slot })
const swapName = (name: string): string => message('battle.bench.swap', CODE, { name })

test('the deck sends the focus to the card it fielded, or to the next in line', async ({ browser, baseURL }) => {
  const room = await sceneNamed(browser, baseURL, 'the deck with room for more')
  const status = (page: Page): Locator => page.locator('.deck > [role="status"]')

  // The team is Bulbasaur, Charmander and Squirtle; the picks are 2, 5, 10, 16 and 25.
  await inScene(browser, baseURL, room, async (page) => {
    await enter(button(page, pickName('Ivysaur', '#0002')))
    await expect(button(page, pickName('Charmeleon', '#0005')), 'fielding the first pick').toBeFocused()
    await expect(status(page), 'the status says who joined').toHaveText(message('deck.status.joined', CODE, { name: 'Ivysaur', slot: 4 }))
  })
  await inScene(browser, baseURL, room, async (page) => {
    await enter(button(page, pickName('Pikachu', '#0025')))
    await expect(button(page, pickName('Pidgey', '#0016')), 'fielding the last pick goes back one').toBeFocused()
  })
  await inScene(browser, baseURL, room, async (page) => {
    await enter(button(page, removeName('Bulbasaur', 1)))
    await expect(button(page, removeName('Charmander', 2)), 'removing the first goes to the next slot\'s ×').toBeFocused()
    await expect(status(page), 'the status says who left').toHaveText(message('deck.status.left', CODE, { name: 'Bulbasaur', slot: 1 }))
  })
  await inScene(browser, baseURL, room, async (page) => {
    await enter(button(page, removeName('Squirtle', 3)))
    await expect(button(page, removeName('Charmander', 2)), 'removing the last goes back one slot').toBeFocused()
  })
  await inScene(browser, baseURL, { ...room, save: { ...room.save, deck: [1, null, null, null, null, null] } }, async (page) => {
    await enter(button(page, removeName('Bulbasaur', 1)))
    await expect(button(page, pickName('Bulbasaur', '#0001')), 'removing the only card goes back to the list').toBeFocused()
  })
  // The sixth card leaves nothing to field: the card that just arrived is the answer.
  await inScene(browser, baseURL, await sceneNamed(browser, baseURL, '/deck'), async (page) => {
    await enter(button(page, pickName('Ivysaur', '#0002')))
    const sixth = page.locator('.deck__slots > li').nth(5).locator('.poke-card__link')
    await expect(sixth, 'the sixth card completes the team').toBeFocused()
    await expect(sixth).toHaveAttribute('aria-label', /^Ivysaur, slot 6,/)
    await expect(status(page)).toHaveText(`${message('deck.status.joined', CODE, { name: 'Ivysaur', slot: 6 })} ${label('deck.status.complete', CODE)}`)
  })
})

test('the battle sends the focus by the phase the action left', async ({ browser, baseURL }) => {
  const firstMove = (page: Page): Locator => page.locator('.move').first()
  const again = label('battle.result.againLost', CODE)
  const inFight = async (name: string, run: (page: Page) => Promise<unknown>): Promise<void> =>
    inScene(browser, baseURL, await sceneNamed(browser, baseURL, name), run)

  await inFight('the fight', async (page) => {
    await enter(page.locator('.battle__item'))
    await expect(firstMove(page), 'the last potion goes to the first move').toBeFocused()
  })
  // Squirtle takes the hit and stays up (seed 7): Charmander would faint, and the bench would be the answer.
  await inFight('the fight', async (page) => {
    await enter(button(page, swapName('Squirtle')))
    await expect(firstMove(page), 'a switch goes to the first move').toBeFocused()
  })
  await inFight('a fight whose lead faints on the first move', async (page) => {
    await enter(firstMove(page))
    await expect(button(page, swapName('Weedle')), 'a faint goes to the first card that can come in').toBeFocused()
  })
  await inFight('a fight asking for a switch', async (page) => {
    await enter(button(page, swapName('Weedle')))
    await expect(firstMove(page), 'the forced switch goes back to the moves').toBeFocused()
  })
  await inFight('a fight one move from its end', async (page) => {
    await enter(firstMove(page))
    await expect(button(page, again), 'the end of the fight goes to the rematch').toBeFocused()
  })
  await inFight('a fight that was lost', async (page) => {
    await enter(button(page, again))
    await expect(firstMove(page), 'a new fight goes to the first move').toBeFocused()
  })
  await inFight('a gym while another fight is on', async (page) => {
    await enter(button(page, label('battle.standing.busyDrop', CODE)))
    await expect(firstMove(page), 'dropping the other fight goes to the first move').toBeFocused()
  })
})

test('Enter on move N leaves the focus and the highlight on N', async ({ browser, baseURL }) => {
  const fight = await sceneNamed(browser, baseURL, 'the fight')

  // The other side: the fight has the four moves the loop below asks for.
  await inScene(browser, baseURL, fight, page => expect(page.locator('.move'), 'a fight has four moves').toHaveCount(4))

  for (let index = 0; index < 4; index++) {
    await inScene(browser, baseURL, fight, async (page) => {
      const move = page.locator('.move').nth(index)
      await enter(move)

      // The highlight follows the focus: a reset to the first move on every action
      // left the focus on the third and lit the first.
      await expect(move, `Enter on move ${index + 1} keeps the focus on it`).toBeFocused()
      await expect(page.locator('.move--focused'), `Enter on move ${index + 1} lights only it`).toHaveCount(1)
      await expect(move, `Enter on move ${index + 1} lights it`).toHaveClass(/move--focused/)
    })
  }
})

test('the shop and the forge send the focus where the plan says', async ({ browser, baseURL }) => {
  const shop = await sceneNamed(browser, baseURL, '/packs')
  const skip = (page: Page): Locator => button(page, label('packs.opening.skip', CODE))
  const back = (page: Page): Locator => button(page, label('packs.opening.backToShop', CODE))
  const primary = (page: Page): Locator => page.locator('.packs__skip--primary')

  await inScene(browser, baseURL, shop, async (page) => {
    await enter(page.locator('.packs__buy--gift'))
    await expect(primary(page), 'opening a pack goes to the primary action').toBeFocused()
    await enter(skip(page))
    await expect(primary(page), 'skipping goes to the primary action').toBeFocused()
    await enter(back(page))
    await expect(page.locator('.packs__buy--gift'), 'the way back goes to the button that opened').toBeFocused()
  })
  await inScene(browser, baseURL, shop, async (page) => {
    await enter(page.locator('.packs__buy--daily'))
    await enter(skip(page))
    await enter(back(page))
    await expect(page.locator('#content'), 'the way back goes to the content when the button that opened is gone').toBeFocused()
  })
  // The reveal ends by itself, and the button that skips it goes with it.
  await inScene(browser, baseURL, shop, async (page) => {
    await enter(page.locator('.packs__buy--gift'))
    await skip(page).focus()
    await expect(primary(page), 'the end of the reveal goes to the primary action').toBeFocused({ timeout: 30_000 })
  })

  // The forge: the button when the dust is there, the field when it is not.
  const forge = await sceneNamed(browser, baseURL, 'the forge with a search typed')
  await inScene(browser, baseURL, forge, async (page) => {
    await enter(page.locator('.collection__suggestion').first())
    await expect(page.locator('#forge-search'), 'a card chosen with no dust goes to the field').toBeFocused()
  })
  await inScene(browser, baseURL, { ...forge, save: { ...forge.save, dust: 100_000 } }, async (page) => {
    await enter(page.locator('.collection__suggestion').first())
    await expect(button(page, label('collection.forge.action', CODE)), 'a card chosen with dust goes to the button').toBeFocused()
  })
  await inScene(browser, baseURL, await sceneNamed(browser, baseURL, 'the forge with a card chosen and the dust to make it'), async (page) => {
    await enter(button(page, label('collection.forge.action', CODE)))
    await expect(page.locator('#forge-search'), 'the last of the dust goes to the field').toBeFocused()
  })
})

/**
 * The one case the helper must leave alone: a click that did not focus its button.
 * Safari does not focus a button on click, so there the focus is the page's to
 * begin with, and taking it to a target would drag the view and the ring to
 * somebody who never touched the keyboard. A script's `click()` is that press in
 * Chromium: it runs the handler and moves no focus.
 */
test('a press that did not focus its control takes nothing from the page', async ({ browser, baseURL }) => {
  await inScene(browser, baseURL, await sceneNamed(browser, baseURL, 'the deck with room for more'), async (page) => {
    const picks = page.locator('.deck__pick')
    const before = await picks.count()

    await picks.first().evaluate(pick => pick instanceof HTMLElement && pick.click())
    // The pick leaving the list is the handler's own effect, and the helper decides in the same tick.
    await expect(picks, 'the press ran its handler').toHaveCount(before - 1)
    expect(await page.evaluate(() => document.activeElement === document.body), 'the focus is still the page\'s').toBe(true)
  })
})

// The announcer, and the bar ---------------------------------------------------

test('a route change is announced, and the announcement changes with the page', async ({ browser, baseURL }) => {
  await inScene(browser, baseURL, await sceneNamed(browser, baseURL, '/'), async (page) => {
    const region = page.locator('.nuxt-route-announcer [role="status"]')
    // The title is written first and the announcer follows it: waiting for the two
    // to agree is the signal that comes after the change.
    const heard = async (): Promise<string> => {
      await expect.poll(async () => (await region.textContent()) === (await page.title()), { message: 'the announcer never caught up with the title' }).toBe(true)

      return (await region.textContent()) ?? ''
    }

    // Two links that go away with their page: the daily pack's, and the opening's.
    await enter(link(page, label('hub.daily.open', CODE)))
    const shop = await heard()
    await enter(link(page, label('packs.opening.toCollection', CODE)))
    const binder = await heard()

    expect(shop, 'the shop is announced').not.toBe('')
    expect(binder, 'the binder is announced').not.toBe('')
    expect(binder, 'the announcement changes with the page').not.toBe(shop)
  })
})

/**
 * The bar sticks and wraps to 217px at 360 (263 with an account), and a control
 * that focus scrolls to the top of the screen ended up entirely under it: 22 stops
 * in 9 states, walked with Shift+Tab. `scroll-padding-top` of the bar's measured
 * height keeps them out. The bar's own stops, and the skip link that slides in
 * over it, are not what is asked.
 */
test('at 360px the bar never hides a keyboard stop', async ({ browser, baseURL }) => {
  test.setTimeout(600_000)

  let walked = 0
  for (const scene of sceneList(await fightsOf(browser, baseURL))) {
    await inScene(browser, baseURL, scene, async (page) => {
      const seen = new Set<string>()
      const hidden: string[] = []

      for (let step = 0; step < 400; step++) {
        await page.keyboard.press('Shift+Tab')
        const stop = await page.evaluate(() => {
          const element = document.activeElement
          const bar = document.querySelector('header.nav')
          if (!(element instanceof HTMLElement) || element === document.body) return null

          let key = ''
          for (let node: Element | null = element; node !== null; node = node.parentElement) {
            key = `${node.tagName}:${node.parentElement === null ? 0 : Array.from(node.parentElement.children).indexOf(node)}/${key}`
          }

          const box = element.getBoundingClientRect()
          const band = bar?.getBoundingClientRect()
          const covering = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
          const under = bar !== null && band !== undefined && !bar.contains(element) && !element.matches('.shell__skip')
            && box.top >= band.top - 0.5 && box.bottom <= band.bottom + 0.5 && covering !== null && bar.contains(covering)

          return { key, under, name: `${element.tagName.toLowerCase()}.${Array.from(element.classList).join('.')} “${(element.getAttribute('aria-label') ?? element.textContent ?? '').trim().slice(0, 30)}”` }
        })

        if (stop === null || seen.has(stop.key)) break
        seen.add(stop.key)
        if (stop.under) hidden.push(stop.name)
      }

      walked += seen.size
      expect.soft(seen.size, `${scene.name}: no keyboard stop was walked`).toBeGreaterThan(0)
      expect.soft(hidden, `${scene.name}: stops whole under the bar`).toEqual([])
    }, { width: 360, height: 800 })
  }

  expect(walked, 'no stop was walked in any scene').toBeGreaterThan(0)
})
