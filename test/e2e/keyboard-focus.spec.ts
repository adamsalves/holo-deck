import { expect, test } from '@playwright/test'
import type { Browser, Locator, Page } from '@playwright/test'
import { ENGINE_VERSION } from '../../shared/game/battle.ts'
import { buttonKinds, buttonTags, dynamicClasses } from '../support/buttons'
import { defaultLocale, label, message } from '../support/locales'
import { pageLayouts } from '../support/source-tree'
import { DEX_VERSION, hydrated, openScene, recordFights, saveWith, sceneList } from './support'
import type { Fights, Scene } from './support'

/**
 * The keyboard is never left on `<body>` by the control it just used, never
 * presses two controls with one key, and is never left under the bar.
 *
 * A control that leaves the page, or turns `disabled`, because of its own action
 * takes the focus with it, and the next Tab starts again from the top of the
 * document: 22 of 214 stops, measured on 29/09/2026. One rule mends them
 * (`keepFocus`), and this file holds it from five sides. The **census** presses
 * one button of every kind in every state, the kinds coming from the disk
 * (`test/support/buttons.ts`), and keeps the key down: where the focus ends, and
 * what a repeat of the key goes on to press. The **targets** ask by name where the
 * focus goes, because not on `<body>` is only the floor. The **pointer** is the
 * other half of the rule: a click moves no focus and no view. The **announcer**
 * says where a link that went away with its page took the player; and the **bar**
 * stays off the stops at 360px, where it is 217px tall.
 *
 * Every key press is Enter on a focused control, in a page the client has taken
 * over: a key before that runs no handler, and the walk would pass over a defect
 * that never got to happen.
 */

const CODE = defaultLocale()

// A test here opens up to eight scenes, each in a context of its own, after two
// recorded fights: with six workers and the trace on, the deck's took 28.0s of
// the default 30.
test.describe.configure({ timeout: 90_000 })

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
 * other; they are not mended in this PR (`docs/accessibility.md`, *Foco depois de uma ação*). Each
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

/**
 * Presses that leave the focus on the page's content, by scene and kind, each with
 * its reason.
 *
 * `#content` is where the focus is put when the target of a transition cannot
 * take it — so a target that stopped matching anything ends there as well. "Not on
 * `<body>`" was all the census asked, and it stayed green over three of them
 * planted at once: the Hub's, the scrap's and the invite's. Ending on the content
 * is now a loss unless it is named here, and each of these has to end there.
 */
const ENDS_ON_THE_CONTENT = [
  { scene: 'the account invite', kind: 'invite__later', why: 'the invite opened over a page nobody had the focus on, and there is nobody to give it back to' },
]

/**
 * Scenes with nothing for the census to press, by name and with the reason: every
 * other scene has to press something.
 *
 * The list this replaced named the scenes that *did* press — twenty of the
 * twenty-seven, by hand —, and two more with a button a keyboard reaches were
 * outside it: either could lose every button and the walk would stay green. Each
 * of these has to be a scene, and to press nothing.
 */
const PRESSES_NOTHING: Readonly<Record<string, string>> = {
  '/': 'the Hub is links: the daily pack, the next challenge, the league',
  '/league': 'every gym is a link',
  '/login': 'its one button leaves for GitHub (`PRESSING_WOULD`)',
  '/rules': 'the rules are text',
  'the League with a deck to finish': 'the gyms are links, and so is the way to the deck',
}

/**
 * Scenes where the census presses a button no tag of `app/` writes: a library
 * draws it, so the disk cannot say it has to be pressed, and it could go from
 * every walk without a word. The scenes that pressed one are compared with these,
 * as a set.
 */
const FROM_A_LIBRARY: Readonly<Record<string, string>> = {
  '/pokemon/pikachu': 'the tabs of the detail page (Reka)',
  'the search palette': 'the palette\'s Close (Nuxt UI)',
}

const tokensOf = (kind: string): string[] => kind.split(' ')
const exempt = (kind: string): boolean => tokensOf(kind).some(token => token in PRESSING_WOULD || token in NO_SCENE)

interface Reachable { readonly kind: string, readonly text: string }

/**
 * What a keyboard can press in the scene — and, given a button to `pick`, the
 * press's first half: focus it, mark the document so a new one can be told, and
 * start writing down every other control that gets pressed from here on.
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

        // In capture, on the window: a click is counted before anything can stop it.
        const others: string[] = []
        Reflect.set(window, 'e2eOthers', others)
        window.addEventListener('click', (event) => {
          const control = event.target instanceof Element ? event.target.closest('button, a, input') : null
          if (control === null || control === button) return

          const name = (control.getAttribute('aria-label') ?? control.textContent ?? '').trim().replaceAll(/\s+/g, ' ').slice(0, 40)
          others.push(`${control.tagName.toLowerCase()} “${name}”`)
        }, true)

        button.focus()
      }
    }

    return { found, seen: [...seen] }
  }, { dynamic: DYNAMIC, pick })
}

interface Outcome {
  readonly navigated: boolean
  readonly lost: boolean
  /** On the page's content: where the focus goes when a target took nothing. */
  readonly fallback: boolean
  readonly holder: string
  /** Every control pressed so far that is not the one the key went down on. */
  readonly others: readonly string[]
}

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
      const others: unknown = Reflect.get(window, 'e2eOthers')

      return {
        navigated: Reflect.get(window, 'e2eDocument') !== true,
        lost: active === null || active === document.body || active === document.documentElement || !active.isConnected || active.matches(':disabled'),
        fallback: active?.id === 'content',
        holder: active === null ? 'nothing' : `${active.tagName.toLowerCase()}${classes}${active.id === '' ? '' : `#${active.id}`}`,
        others: Array.isArray(others) ? others.map(String) : [],
      }
    })
  }
  catch (error) {
    if (!String(error).includes('Execution context was destroyed')) throw error

    return { navigated: true, lost: false, fallback: false, holder: 'a new document', others: [] }
  }
}

test('no button a keyboard can press drops the focus, or lets its key press another', async ({ browser, baseURL }) => {
  test.setTimeout(900_000)

  const pressed = new Map<string, string[]>()
  const seen = new Set<string>()
  const scenes = sceneList(await fightsOf(browser, baseURL))

  for (const scene of scenes) {
    let found: Reachable[] = []

    await inScene(browser, baseURL, scene, async (page) => {
      const read = await reachableButtons(page)
      found = read.found
      for (const kind of read.seen) seen.add(kind)

      // A page that takes the focus as it loads is one the skip link no longer
      // reaches. The tag comes first in what is read: `className` alone is empty
      // on a field with no class, and an empty string was what "nobody" looked like.
      if (scene.open === undefined && scene.invite === undefined) {
        const taker = await page.evaluate(() => {
          const active = document.activeElement
          if (active === null || active === document.body) return ''

          return `${active.tagName.toLowerCase()}${active.id === '' ? '' : `#${active.id}`}${Array.from(active.classList).map(name => `.${name}`).join('')}`
        })
        expect.soft(taker, `${scene.name}: the page took the focus as it loaded`).toBe('')
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
        // Down, and kept down: what a repeat of this same key presses is asked below.
        await page.keyboard.down('Enter')
        const outcome = await outcomeOf(page, () => inFlight.size)
        pressed.set(kind, [...(pressed.get(kind) ?? []), scene.name])

        const same = (entry: { scene: string, kind: string }): boolean => entry.scene === scene.name && entry.kind === kind
        const leaves = LEAVES_THE_PAGE.some(same)
        const fallsBack = ENDS_ON_THE_CONTENT.some(same)
        const press = `${scene.name}: Enter on \`${kind}\` (“${target.text}”)`

        expect.soft(outcome.navigated, `${press} ${leaves ? 'did not replace the document, and its entry says it does' : 'replaced the document'}`).toBe(leaves)
        if (!outcome.navigated) {
          expect.soft(outcome.lost, `${press} left the focus on ${outcome.holder}`).toBe(false)
          expect.soft(
            outcome.fallback,
            `${press} ${fallsBack ? 'did not end on the content, and its entry says it does' : 'left the focus on the content: the target of the transition took nothing'}`,
          ).toBe(fallsBack)

          // A key held down repeats, and Enter on a button presses it at every
          // repeat: with the focus on the next control by then, one key pressed
          // two. The second `down` of a key that is down is that repeat.
          await page.keyboard.down('Enter')
          const held = await outcomeOf(page, () => inFlight.size)
          expect.soft(held.navigated, `${press}, held: the repeat replaced the document`).toBe(false)
          expect.soft(held.others.slice(outcome.others.length), `${press}, held: the repeat went on to press`).toEqual([])
        }

        await page.keyboard.up('Enter')
      })
    }
  }

  // The other side, by name: a count over the sum stays green with a whole scene gone quiet.
  const names = scenes.map(scene => scene.name)
  const pressedIn = new Set([...pressed.values()].flat())
  expect.soft(
    names.filter(name => !pressedIn.has(name) && !(name in PRESSES_NOTHING)),
    'scenes that pressed nothing: one that lost its buttons, or one to name with the reason',
  ).toEqual([])
  for (const [name, reason] of Object.entries(PRESSES_NOTHING)) {
    expect.soft(names, `“${name}” is no scene (${reason})`).toContain(name)
    expect.soft(pressedIn.has(name), `“${name}” pressed a button, and its entry says it has none (${reason})`).toBe(false)
  }
  for (const { scene, kind } of [...LEAVES_THE_PAGE, ...ENDS_ON_THE_CONTENT]) {
    expect.soft(pressed.get(kind)?.includes(scene), `\`${kind}\` was not pressed in “${scene}”`).toBe(true)
  }

  // The buttons the disk does not know: pressed where they are named, and nowhere else.
  const library = new Set([...pressed].filter(([kind]) => !KINDS.has(kind)).flatMap(([, where]) => where))
  expect.soft([...library].sort(), 'the scenes that pressed a button of a library').toEqual(Object.keys(FROM_A_LIBRARY).sort())

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
/** The scrap button of a card with two spare commons, which is what the binder's scene gives each. */
const scrapName = (name: string): string => message('collection.card.scrapLabel', CODE, { count: 2, name, dust: 10 }, 2)

const NO_DECK = [null, null, null, null, null, null]

test('the deck sends the focus to the card it fielded, or to the next in line', async ({ browser, baseURL }) => {
  const room = await sceneNamed(browser, baseURL, 'the deck with room for more')
  const status = (page: Page): Locator => page.locator('.deck > [role="status"]')
  const search = (page: Page): Locator => page.locator('.deck__search input')

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
  // The search leaves one pick, and fielding it takes the list off the screen.
  await inScene(browser, baseURL, room, async (page) => {
    await search(page).fill('ivy')
    await expect(page.locator('.deck__pick'), 'the search leaves one pick').toHaveCount(1)
    await enter(button(page, pickName('Ivysaur', '#0002')))
    await expect(search(page), 'fielding the only pick the search leaves goes to the search').toBeFocused()
  })
  await inScene(browser, baseURL, room, async (page) => {
    await enter(button(page, removeName('Bulbasaur', 1)))
    await expect(button(page, removeName('Charmander', 2)), 'removing the first goes to the next slot\'s ×').toBeFocused()
    await expect(status(page), 'the status says who left').toHaveText(message('deck.status.left', CODE, { name: 'Bulbasaur', slot: 1 }))
  })
  // The one in the middle has a neighbour on each side: only here does the order
  // of the two show, and "the one before, then the next" passed every other case.
  await inScene(browser, baseURL, room, async (page) => {
    await enter(button(page, removeName('Charmander', 2)))
    await expect(button(page, removeName('Squirtle', 3)), 'removing the one in the middle goes on to the next slot, not back').toBeFocused()
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

/**
 * A drop is the one way a card comes in that no key makes, and the status has to
 * follow it like the others: it kept saying *Ivysaur entrou no slot 4* with
 * Charmeleon dropped on that slot.
 */
test('the deck\'s status follows a card dropped on a slot', async ({ browser, baseURL }) => {
  await inScene(browser, baseURL, await sceneNamed(browser, baseURL, 'the deck with room for more'), async (page) => {
    const status = page.locator('.deck > [role="status"]')

    await enter(button(page, pickName('Ivysaur', '#0002')))
    await expect(status).toHaveText(message('deck.status.joined', CODE, { name: 'Ivysaur', slot: 4 }))

    await button(page, pickName('Charmeleon', '#0005')).dragTo(page.locator('.deck__slots > li').nth(3))
    await expect(page.locator('.deck__slots > li').nth(3).locator('.poke-card__link'), 'the drop took the slot').toHaveAttribute('aria-label', /^Charmeleon, slot 4,/)
    await expect(status, 'the status says who the drop brought in').toHaveText(message('deck.status.joined', CODE, { name: 'Charmeleon', slot: 4 }))
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

/**
 * The price of the highlight following the focus: nothing sets it back, and a
 * card with fewer moves than the one it replaces came in with no move lit. Only a
 * pointer shows it — the keyboard's switch sends the focus to the first move, and
 * the focus lights it. Pidgey leads with four moves; Magikarp knows one.
 */
test('a card with fewer moves comes in with a move lit', async ({ browser, baseURL }) => {
  const team = [16, 129, 10, 13, 4, 12]
  const scene: Scene = {
    name: 'a fight with a one-move card on the bench',
    address: '/battle/1',
    save: saveWith({
      collection: Object.fromEntries(team.map(id => [id, { c: 1, s: 0 }])),
      deck: team,
      battle: { gymId: 1, seed: 7, engineVersion: ENGINE_VERSION, dexVersion: DEX_VERSION, team, actions: [] },
    }),
    ready: '.move',
  }

  await inScene(browser, baseURL, scene, async (page) => {
    const moves = page.locator('.move')
    await expect(moves, 'the lead has four moves').toHaveCount(4)

    await moves.last().hover()
    await expect(moves.last(), 'the pointer lights the move it is on').toHaveClass(/move--focused/)

    await button(page, swapName('Magikarp')).click()
    await expect(moves, 'the card that came in knows one move').toHaveCount(1)
    await expect(moves.first(), 'its one move is lit').toHaveClass(/move--focused/)
  })
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
 * Scrapping keeps the keyboard on the card — and under the filter that lists
 * only what there is to scrap, where the card leaves with its button, on the
 * next card's. The eight cards of the scene have two spares each, in the order
 * of the dex: Bulbasaur and Ivysaur open the list, Pidgey and Pikachu close it.
 */
test('the binder keeps the focus on the card it scrapped, or on the next one to scrap', async ({ browser, baseURL }) => {
  const binder = await sceneNamed(browser, baseURL, '/collection')
  const duplicates = (page: Page): Locator => page.getByRole('button', { name: new RegExp(`^${label('collection.filters.duplicates', CODE)} · `) })

  await inScene(browser, baseURL, binder, async (page) => {
    await enter(button(page, scrapName('Bulbasaur')))
    await expect(page.getByRole('link', { name: /^Bulbasaur, / }), 'scrapping stays on the card, at its link').toBeFocused()
  })
  await inScene(browser, baseURL, binder, async (page) => {
    await enter(duplicates(page))
    await enter(button(page, scrapName('Bulbasaur')))
    await expect(page.locator('.binder-card'), 'the card left the list of duplicates').toHaveCount(7)
    await expect(button(page, scrapName('Ivysaur')), 'under the filter, scrapping goes on to the next card\'s button').toBeFocused()
  })
  await inScene(browser, baseURL, binder, async (page) => {
    await enter(duplicates(page))
    await enter(button(page, scrapName('Pikachu')))
    await expect(button(page, scrapName('Pidgey')), 'scrapping the last of the list goes back one').toBeFocused()
  })
  // One card to scrap: the list goes with it, and the content is what is left.
  const one = { ...binder, save: { ...binder.save, collection: { 1: { c: 3, s: 0 }, 4: { c: 1, s: 0 } } } }
  await inScene(browser, baseURL, one, async (page) => {
    await enter(duplicates(page))
    await enter(button(page, scrapName('Bulbasaur')))
    await expect(page.locator('.binder-card'), 'nothing is left to scrap').toHaveCount(0)
    await expect(page.locator('#content'), 'with the list empty, the focus goes to the content').toBeFocused()
  })
})

test('giving up at the Hub goes on to the next challenge', async ({ browser, baseURL }) => {
  const hub = await sceneNamed(browser, baseURL, 'the Hub with a fight on')
  const giveUp = (page: Page): Locator => button(page, label('hub.resume.giveUp', CODE))

  await inScene(browser, baseURL, hub, async (page) => {
    await enter(giveUp(page))
    await expect(link(page, label('hub.next.fight', CODE)), 'with a deck, the fight').toBeFocused()
  })
  await inScene(browser, baseURL, { ...hub, save: { ...hub.save, deck: NO_DECK } }, async (page) => {
    await enter(giveUp(page))
    await expect(link(page, label('hub.next.buildDeck', CODE)), 'with no deck, the deck to build').toBeFocused()
  })
})

/**
 * The invite opens by itself, over whatever the player was on, and shut it gives
 * the focus back. The census only sees it opened over a page nobody was on, which
 * is the other branch (`ENDS_ON_THE_CONTENT`): with the two swapped, it stayed
 * green.
 *
 * The session is answered when the test says so. The invite waits for it, and by
 * then the keyboard is on a link — `openScene` would wait for the network to go
 * quiet first, which the held answer never lets it.
 */
test('the invite, shut, gives the focus back to the control that had it', async ({ browser, baseURL }) => {
  const invite = await sceneNamed(browser, baseURL, 'the account invite')
  const origin = new URL(baseURL ?? '').origin
  const shuts: Readonly<Record<string, (page: Page) => Promise<unknown>>> = {
    'Escape': page => page.keyboard.press('Escape'),
    'Enter on the way out': page => enter(button(page, label('invite.later', CODE))),
  }

  for (const [how, shut] of Object.entries(shuts)) {
    const context = await browser.newContext({ baseURL: origin, viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' })
    let answer = (): void => undefined
    const asked = new Promise<void>((resolve) => {
      answer = resolve
    })

    try {
      const page = await context.newPage()

      await page.route(url => url.origin !== origin, route => route.abort())
      await page.route('**/api/auth/get-session', async (route) => {
        await asked
        await route.fulfill({ json: null })
      })
      await page.addInitScript((save) => {
        window.localStorage.setItem('holodeck:save', JSON.stringify(save))
        window.localStorage.removeItem('holodeck:invite')
      }, invite.save)
      await page.goto('/')
      await hydrated(page)

      const fight = link(page, label('hub.next.fight', CODE))
      await expect(fight, 'the Hub draws the next challenge with the session still out').toBeVisible({ timeout: 15_000 })
      await fight.focus()
      await expect(page.locator('.invite__card'), 'the invite waits for the session').toHaveCount(0)

      answer()
      await expect(page.locator('.invite__card'), 'the invite takes the focus as it opens').toBeFocused()

      await shut(page)
      await expect(fight, `${how}: the focus goes back to the link that had it`).toBeFocused()
    }
    finally {
      // Whatever happened above, the held answer is let go before the context is.
      answer()
      await context.close()
    }
  }
})

// The pointer ------------------------------------------------------------------

/**
 * Whether the click that is about to happen finds its button holding the focus:
 * what tells the click of Chromium and Firefox, which focuses the button, from
 * Safari's, which does not. Read in capture, before the handler takes the button away.
 */
async function watchPress(page: Page): Promise<() => Promise<boolean>> {
  await page.evaluate(() => {
    window.addEventListener('click', (event) => {
      const pressed = event.target instanceof Element ? event.target.closest('button') : null
      Reflect.set(window, 'e2eHeldFocus', pressed !== null && pressed === document.activeElement)
    }, { capture: true, once: true })
  })

  return () => page.evaluate(() => Reflect.get(window, 'e2eHeldFocus') === true)
}

/**
 * The half of the rule that is about who did *not* use the keyboard. A click that
 * did not focus its button leaves the focus the page's: Safari focuses no button
 * on click, and a script's `click()` is that press in Chromium — it runs the
 * handler and moves no focus.
 */
test('a press that did not focus its control takes nothing from the page', async ({ browser, baseURL }) => {
  await inScene(browser, baseURL, await sceneNamed(browser, baseURL, 'the deck with room for more'), async (page) => {
    const picks = page.locator('.deck__pick')
    const before = await picks.count()
    const heldFocus = await watchPress(page)

    await picks.first().evaluate(pick => pick instanceof HTMLElement && pick.click())
    // The pick leaving the list is the handler's own effect, and the helper decides in the same tick.
    await expect(picks, 'the press ran its handler').toHaveCount(before - 1)
    expect(await heldFocus(), 'this is the press that focuses nothing').toBe(false)
    expect(await page.evaluate(() => document.activeElement === document.body), 'the focus is still the page\'s').toBe(true)
  })
})

/**
 * And a click that **did** focus its button, which is every click of a mouse or a
 * finger in Chromium and Firefox. "The control had the focus" was the whole test,
 * so the helper took these for the keyboard: it sent the focus to the target and
 * the view with it — at 360px, the × of the only card left the page 863px down,
 * on the first pick. The other side is asked first: the click has to find its
 * button focused, or this is the Safari press again and proves nothing new.
 */
test('a pointer press moves neither the focus nor the view', async ({ browser, baseURL }) => {
  const room = await sceneNamed(browser, baseURL, 'the deck with room for more')
  const where = (page: Page): Promise<{ onThePage: boolean, scrolled: number }> => page.evaluate(() => ({
    onThePage: document.activeElement === document.body,
    scrolled: Math.round(window.scrollY),
  }))

  // The × of the only card: its target is the first pick, a column below at this width.
  await inScene(browser, baseURL, { ...room, save: { ...room.save, deck: [1, null, null, null, null, null] } }, async (page) => {
    const heldFocus = await watchPress(page)

    await button(page, removeName('Bulbasaur', 1)).click()
    await expect(page.locator('.deck-slot__remove'), 'the press ran its handler').toHaveCount(0)
    expect(await heldFocus(), 'the click focused its button: not the Safari press').toBe(true)
    expect(await where(page), 'the × of the only card, clicked').toEqual({ onThePage: true, scrolled: 0 })
  }, { width: 360, height: 800 })

  // The pick that completes the team: its target is the card that came in.
  await inScene(browser, baseURL, await sceneNamed(browser, baseURL, '/deck'), async (page) => {
    const heldFocus = await watchPress(page)

    await button(page, pickName('Ivysaur', '#0002')).click()
    await expect(page.locator('.deck-slot--empty'), 'the press ran its handler').toHaveCount(0)
    expect(await heldFocus(), 'the click focused its button: not the Safari press').toBe(true)
    expect((await where(page)).onThePage, 'the pick that completes the team, clicked, leaves the focus the page\'s').toBe(true)
  })
})

// The announcer, and the bar ---------------------------------------------------

/**
 * A route change says where it landed, in every layout a page is drawn in.
 *
 * **Each reading waits for its own navigation.** The first version waited for the
 * region to agree with the title — which the page being left already satisfies —,
 * so it read each value before the navigation it named: *Holo Deck* for the shop,
 * the shop for the binder, and the binder's announcement never. Here the address
 * comes first, then a region that says something else than before, and the title
 * with it, read in one evaluation.
 *
 * **And the layouts come from the disk.** The battle is drawn outside the default
 * layout, and both navigations of the first version stayed inside it: the
 * announcer moved from `app.vue` into the layout left the battle silent and the
 * test green.
 */
test('a route change is announced, in every layout a page is drawn in', async ({ browser, baseURL }) => {
  const layouts = pageLayouts()
  const landed = new Set<string>()

  const heard = (page: Page): Promise<{ said: string | null, title: string, path: string }> => page.evaluate(() => ({
    said: document.querySelector('.nuxt-route-announcer [role="status"]')?.textContent ?? null,
    title: document.title,
    path: window.location.pathname,
  }))

  /** Follows a link with the keyboard and returns what the announcer says of the page at `address`. */
  const follow = async (page: Page, control: Locator, address: string): Promise<string> => {
    const layout = layouts.get(address)
    if (layout === undefined) throw new Error(`${address} is no page of app/pages`)

    const before = await heard(page)
    await enter(control)
    await expect.poll(async () => {
      const now = await heard(page)

      return now.path === address && now.said !== null && now.said !== before.said && now.said === now.title
    }, { message: `the announcer never said the page at ${address}: it went on saying “${before.said ?? 'nothing'}”` }).toBe(true)

    landed.add(layout)
    return (await heard(page)).said ?? ''
  }

  const hub = await sceneNamed(browser, baseURL, '/')

  // Two links that go away with their page: the daily pack's, and the opening's.
  await inScene(browser, baseURL, hub, async (page) => {
    const shop = await follow(page, link(page, label('hub.daily.open', CODE)), '/packs')
    const binder = await follow(page, link(page, label('packs.opening.toCollection', CODE)), '/collection')

    expect(binder, 'the announcement changes with the page').not.toBe(shop)
  })
  // And the one that leaves the layout.
  await inScene(browser, baseURL, hub, async (page) => {
    await follow(page, link(page, label('hub.next.fight', CODE)), '/battle/1')
  })

  // The other side, from the disk: a layout no navigation above lands on is one
  // the announcer could be missing from with all of this green.
  expect([...landed].sort(), 'the layouts the navigations landed on').toEqual([...new Set(layouts.values())].sort())
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
