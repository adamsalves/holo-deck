import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { hasExtension, pageAddresses, REPO_ROOT, stripComments, walkFiles } from '../support/source-tree'
import { openScene, pageScene, STATES } from './support'

/**
 * Every keyboard stop of every page draws the ring — measured in pixels, never
 * in the computed style.
 *
 * Measured on 26/09/2026, thirteen of the 288 stops of twelve pages did not
 * change one pixel under focus while their computed style said `2px solid`: the
 * bevel's `clip-path` ate the outline, and `content-visibility` cut the card's.
 * A gate reading styles would have passed all thirteen.
 *
 * So each stop is photographed twice, focused and with the focus taken away,
 * and the two are read where the *Foco* block of the *Tokens* board puts things:
 * 4px outside the control — the middle of the ring, 3 to 5px out — has to be
 * `--focus`; 1.5px outside — the gap — has to be what was there without focus,
 * because the gap is what keeps a blue ring apart from a blue control. On a
 * beveled control the ring is read along the cut as well, across its middle.
 * And inside the control nothing may change at all: the board draws focus as
 * rest plus the ring, so a hover style that also answers `:focus-visible` — a
 * lighter fill, a lit border, a brighter label — fails here.
 *
 * The pages come from the disk, and every stop the Tab key reaches is measured:
 * a control added later is measured the day it is written. So is every stop
 * behind a tab, which the Tab key alone never reaches, and every stop of the
 * states in `STATES`, which no page's own save draws.
 */

/**
 * The one control that moves under focus, by name: the skip link slides in. Any
 * other that moves fails — the board draws focus as rest plus the ring, and rest
 * is where the control was.
 */
const SKIP_LINK = '.shell__skip'

/**
 * The class each `:hover` rule of `app/` styles — the class nearest the `:hover`
 * in its selector —, read from the disk.
 *
 * A hover that also answers `:focus-visible` shows only where the walk focuses a
 * control that has it. Seven of the nineteen that this gate's PR took off
 * `:focus-visible` lived in states no page's save draws, and putting three of
 * them back left the gate green: every one of these classes has to be measured.
 * A hover written as a Tailwind variant in a template is not read here.
 */
function hoverClasses(): Set<string> {
  const files = walkFiles(join(REPO_ROOT, 'app'), new Set(), hasExtension(['.vue', '.css']))
  const classes = new Set<string>()

  for (const file of files) {
    const source = stripComments(readFileSync(join(REPO_ROOT, file), 'utf8'))
    const styles = file.endsWith('.css')
      ? [source]
      : [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(match => match[1] ?? '')

    for (const style of styles) {
      for (const match of style.matchAll(/([^{},;]*):hover\b/g)) {
        const name = [...(match[1] ?? '').matchAll(/\.([\w-]+)/g)].at(-1)?.[1]
        if (name !== undefined) classes.add(name)
      }
    }
  }

  return classes
}

/**
 * The same walk three times, each reading what it is there for.
 *
 * As the page is drawn: the ring, where it stands, and the inside — and there
 * every `:hover` class has to have been measured.
 *
 * In forced colours — Windows' high contrast —, where the system repaints every
 * colour, and a ring painted as a background went with it: measured before the
 * fix, CHALLENGE changed 100 pixels under focus there, against 3815 without
 * forced colours, and none of them a ring. Not the inside: Chromium itself
 * repaints a focused button's border in the system highlight there — measured
 * on a bare `<button>`, with `outline: none` too.
 *
 * On a phone, what the width changes: a strip of chips that scrolls sideways, a
 * panel whose actions wrap onto its edge — whether the ring is there, and the
 * gap and the outside as at rest. Where the ring stands and what focus does
 * inside are the same CSS at every width, and are read at 1280. Here a
 * fractional position moved a scrap button's painted ring 0.88px out, past the
 * slack measured at 1280, and a deck slot's × glyph rasterised 16 pixels apart
 * once the card's ring was drawn over it.
 */
const PASSES = [
  { title: '', forcedColors: 'none', viewport: { width: 1280, height: 900 }, edges: true, inside: true },
  { title: ', in forced colors', forcedColors: 'active', viewport: { width: 1280, height: 900 }, edges: true, inside: false },
  { title: ', on a phone', forcedColors: 'none', viewport: { width: 360, height: 800 }, edges: false, inside: false },
] as const

/**
 * The ring of the *Foco* block, in CSS pixels outside the control: its inner
 * edge 3px out, its outer edge 5px out.
 *
 * With slack, and the slack is measured: a box that ends at a fraction of a
 * pixel — a deck pick ends at 330.69 — has its clip snapped to the device's
 * pixels, and its ring drew from 3.6 to 5.6. What the slack still tells apart
 * is what matters: the 2px gap most rings used to have starts at 2, and a ring
 * 3px wide ends at 6.
 */
const INNER = [2.5, 4] as const
const OUTER = [4.25, 5.75] as const

/** Where the middle of the ring is, and where nothing may change: the gap, and past the ring. */
const RING = 4
const UNCHANGED = [1.5, 6.5]

/** How far a pixel may be from the one it is compared to, per channel. */
const TOLERANCE = 24

/**
 * The same, inside the control, where focus and rest are one render and the
 * noise measured is 1. The smallest hover the system has, `--border` to
 * `--border-strong`, moves a channel by 9: at 24 it passed unseen.
 */
const INSIDE_TOLERANCE = 4

/** Around the box, so the ring and a margin fit in the photograph. */
const MARGIN = 8

const SCALE = 2

test.use({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: SCALE })

/** What the page says about the element that has the focus. */
interface Stop {
  readonly key: string
  readonly name: string
  /** The box the ring surrounds, in viewport CSS pixels. */
  readonly box: { readonly x: number, readonly y: number, readonly width: number, readonly height: number }
  /** The depth of the bevel the ring follows, or `null` when it follows a radius. */
  readonly bevel: number | null
  readonly radius: number
  readonly kind: 'outline' | 'bevel' | 'parent' | 'frame'
  readonly skipLink: boolean
  /** The scene's `noRing` entry this stop answers to, if any. */
  readonly noRing: string | null
  /** Its classes and its ancestors': the hover rules this stop stands for. */
  readonly classes: readonly string[]
}

/**
 * The stop with the focus, scrolled to the middle of the screen.
 *
 * **The ring box is not always the element with the focus.** A link that covers
 * its card has the card's box — the gate walks up while the parent is the same
 * box, a pixel either way —, and an element marked `data-focus-parent` hands the
 * ring to its parent. The bevel is the `--bevel` of whichever element on that
 * walk has a `clip-path`: that one is what cuts the ring's corners.
 */
function readStop(page: Page, noRing: readonly string[]): Promise<Stop | null> {
  return page.evaluate(async ({ noRing, skipLink }) => {
    const element = document.activeElement
    if (!(element instanceof HTMLElement) || element === document.body) return null

    Reflect.set(window, 'e2eStop', element)
    // On a phone the nav wraps to 217px and sticks, and a tall card centred on
    // the screen had its top under it. That is #78 — focus obscured —, not
    // the ring: the stop is centred in what the nav leaves, as the page's own
    // `scroll-padding-top` would do.
    const nav = document.querySelector('header.nav')
    document.documentElement.style.scrollPaddingTop = nav === null ? '' : `${nav.getBoundingClientRect().height}px`
    element.scrollIntoView({ block: 'center', inline: 'center' })
    // Two frames, so what the scroll brought into view is laid out: a list item
    // under `content-visibility` takes its real height only then, and a box read
    // before it is a pixel off.
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))

    const same = (a: DOMRect, b: DOMRect): boolean =>
      Math.abs(a.left - b.left) <= 1.5 && Math.abs(a.top - b.top) <= 1.5
      && Math.abs(a.right - b.right) <= 1.5 && Math.abs(a.bottom - b.bottom) <= 1.5

    const parentMarked = element.hasAttribute('data-focus-parent') && element.parentElement !== null
    let box: HTMLElement = parentMarked && element.parentElement ? element.parentElement : element
    const walk: HTMLElement[] = parentMarked ? [element, box] : [element]
    for (let parent = box.parentElement; parent !== null && same(box.getBoundingClientRect(), parent.getBoundingClientRect()); parent = parent.parentElement) {
      box = parent
      walk.push(parent)
    }

    const clipped = walk.find(node => getComputedStyle(node).clipPath !== 'none')
    const bevel = clipped === undefined ? null : Number.parseFloat(getComputedStyle(clipped).getPropertyValue('--bevel'))
    const rect = box.getBoundingClientRect()

    let key = ''
    const classes = new Set<string>()
    for (let node: Element | null = element; node !== null; node = node.parentElement) {
      key = `${node.tagName}:${node.parentElement === null ? 0 : Array.from(node.parentElement.children).indexOf(node)}/${key}`
      for (const name of Array.from(node.classList)) classes.add(name)
    }

    const label = element.getAttribute('aria-label') ?? element.textContent ?? ''

    return {
      key,
      name: `${element.tagName.toLowerCase()}.${Array.from(element.classList).join('.')} “${label.trim().replace(/\s+/g, ' ').slice(0, 40)}”`,
      box: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
      bevel: bevel !== null && Number.isFinite(bevel) ? bevel : null,
      radius: Number.parseFloat(getComputedStyle(box).borderTopLeftRadius) || 0,
      kind: parentMarked
        ? 'parent' as const
        : clipped === undefined ? 'outline' as const : clipped === element ? 'bevel' as const : 'frame' as const,
      skipLink: element.matches(skipLink),
      noRing: noRing.find(selector => element.matches(selector)) ?? null,
      classes: [...classes],
    }
  }, { noRing, skipLink: SKIP_LINK })
}

/**
 * The points the ring and the gap are read at, relative to the box's corner.
 *
 * Along each side, away from the corners — where a radius curves the ring or a
 * bevel cuts it —, and across the middle of each bevel cut, along its normal.
 */
interface Sample {
  readonly side: string
  /** A point on the edge of the box — or on the bevel's cut — and the way out of it. */
  readonly origin: readonly [number, number]
  readonly out: readonly [number, number]
  /** On a straight side the ring's edges are measured; across a cut, only its presence. */
  readonly straight: boolean
}

function samplePoints(stop: Stop): Sample[] {
  const { width, height } = stop.box
  const corner = Math.max(stop.bevel ?? 0, stop.radius) + 8
  const samples: Sample[] = []

  const along = (length: number): number[] => {
    if (length - 2 * corner < 2) return [length / 2]
    const steps: number[] = []
    for (let t = corner; t <= length - corner; t += 2) steps.push(t)
    return steps
  }

  for (const t of along(width)) {
    samples.push({ side: 'top', origin: [t, 0], out: [0, -1], straight: true })
    samples.push({ side: 'bottom', origin: [t, height], out: [0, 1], straight: true })
  }
  for (const t of along(height)) {
    samples.push({ side: 'left', origin: [0, t], out: [-1, 0], straight: true })
    samples.push({ side: 'right', origin: [width, t], out: [1, 0], straight: true })
  }

  if (stop.bevel !== null) {
    const b = stop.bevel
    for (const shift of [-b / 4, 0, b / 4]) {
      const x = b / 2 + shift
      const y = b / 2 - shift
      samples.push({ side: 'top-left cut', origin: [x, y], out: [-Math.SQRT1_2, -Math.SQRT1_2], straight: false })
      samples.push({ side: 'bottom-right cut', origin: [width - x, height - y], out: [Math.SQRT1_2, Math.SQRT1_2], straight: false })
    }
  }

  return samples
}

/**
 * Waits for the CSS transitions the focus change started.
 *
 * Nuxt UI's tabs fade their outline colour in over 150ms, and a photograph taken
 * at once reads a ring at a quarter of its colour. Transitions end; animations
 * that loop would not, and they are left alone.
 */
function settle(page: Page): Promise<unknown> {
  return page.evaluate(() => Promise.all(document.getAnimations()
    .filter(animation => animation instanceof CSSTransition)
    .map(animation => animation.finished.catch(() => undefined))))
}

/** What went wrong with one stop, side by side — empty when all is well —, and whether it moved. */
async function measure(
  page: Page,
  stop: Stop,
  focus: readonly number[] | null,
  read: { readonly edges: boolean, readonly inside: boolean },
): Promise<{ failures: string[], moved: boolean }> {
  const viewport = page.viewportSize()
  if (viewport === null) throw new Error('the gate needs a viewport')

  if (stop.box.width < 8 || stop.box.height < 8) {
    return {
      failures: [`the focused element is ${Math.round(stop.box.width)}×${Math.round(stop.box.height)}: a ring around it is a ring nobody sees — the control the player sees takes it with \`data-focus-parent\``],
      moved: false,
    }
  }

  const left = Math.max(0, Math.floor(stop.box.x - MARGIN))
  const top = Math.max(0, Math.floor(stop.box.y - MARGIN))
  const clip = {
    x: left,
    y: top,
    width: Math.min(viewport.width, Math.ceil(stop.box.x + stop.box.width + MARGIN)) - left,
    height: Math.min(viewport.height, Math.ceil(stop.box.y + stop.box.height + MARGIN)) - top,
  }

  await settle(page)
  const focused = await page.screenshot({ clip })
  const moved = await page.evaluate(() => {
    const element: unknown = Reflect.get(window, 'e2eStop')
    if (!(element instanceof HTMLElement)) throw new Error('the stop is gone')
    const before = element.getBoundingClientRect()
    element.blur()
    const after = element.getBoundingClientRect()
    return Math.abs(before.left - after.left) > 1 || Math.abs(before.top - after.top) > 1
  })
  await settle(page)
  const rest = await page.screenshot({ clip })

  const samples: Sample[] = samplePoints(stop).map(sample => ({
    ...sample,
    origin: [sample.origin[0] + stop.box.x - clip.x, sample.origin[1] + stop.box.y - clip.y],
  }))

  // The control's own box, minus the corners: across a bevel's cut the ring
  // runs inside the box's rectangle. And a pixel more, because the vertex where
  // a cut begins is antialiased from another path under focus — measured, one
  // device pixel of BAIXAR, at the top of its bottom cut.
  const inside = {
    x: stop.box.x - clip.x,
    y: stop.box.y - clip.y,
    width: stop.box.width,
    height: stop.box.height,
    corner: Math.max(stop.bevel ?? 0, stop.radius) + 1,
  }

  const { readings, changedInside } = await page.evaluate(async ({ shots, samples, inside, scale, focus, tolerance, insideTolerance, ring, unchanged }) => {
    const decode = async (base64: string): Promise<ImageData> => {
      const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0))
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
      const context = canvas.getContext('2d')
      if (context === null) throw new Error('no 2d context')
      context.drawImage(bitmap, 0, 0)
      return context.getImageData(0, 0, bitmap.width, bitmap.height)
    }
    const [focused, rest] = await Promise.all([decode(shots.focused), decode(shots.rest)])

    const pixel = (image: ImageData, x: number, y: number): number[] | null => {
      const column = Math.floor(x * scale)
      const row = Math.floor(y * scale)
      if (column < 0 || row < 0 || column >= image.width || row >= image.height) return null
      const at = (row * image.width + column) * 4
      return [image.data[at] ?? 0, image.data[at + 1] ?? 0, image.data[at + 2] ?? 0]
    }
    const near = (a: readonly number[], b: readonly number[], within = tolerance): boolean =>
      a.every((channel, index) => Math.abs(channel - (b[index] ?? Number.NaN)) <= within)

    let changedInside = 0
    for (let row = Math.ceil(inside.y * scale); row < Math.floor((inside.y + inside.height) * scale); row++) {
      for (let column = Math.ceil(inside.x * scale); column < Math.floor((inside.x + inside.width) * scale); column++) {
        const x = column / scale - inside.x
        const y = row / scale - inside.y
        const nearCorner = (x < inside.corner || x > inside.width - inside.corner)
          && (y < inside.corner || y > inside.height - inside.corner)
        if (nearCorner) continue
        const a = pixel(focused, column / scale, row / scale)
        const b = pixel(rest, column / scale, row / scale)
        if (a !== null && b !== null && !near(a, b, insideTolerance)) changedInside++
      }
    }

    // The ring is `--focus` — or, with `focus` null, in forced colours, where
    // the colour is the one the player's system chose: whatever focus changed.
    const isRing = (x: number, y: number): boolean => {
      const color = pixel(focused, x, y)
      if (color === null) return false
      if (focus !== null) return near(color, focus)
      const before = pixel(rest, x, y)
      return before !== null && !near(color, before)
    }

    const readings = samples.map(({ side, origin, out, straight }) => {
      const at = (distance: number): [number, number] => [origin[0] + out[0] * distance, origin[1] + out[1] * distance]
      const [middleX, middleY] = at(ring)
      if (pixel(focused, middleX, middleY) === null) return { side, onScreen: false, ring: false, straight, edges: null, unchanged: true }

      // The ring anywhere in the 3×3 around its middle: across a 45° cut a 2px
      // ring has an antialiased edge on each side and a narrow solid core, and
      // where the core falls depends on the fraction of pixel the box starts at.
      let found = false
      for (const dy of [-1, 0, 1]) {
        for (const dx of [-1, 0, 1]) {
          if (isRing(middleX + dx / scale, middleY + dy / scale)) found = true
        }
      }

      // On a straight side, device pixel by device pixel outward: where the
      // first run of ring colour begins and ends. From 1px out, past the
      // control's own antialiased edge — a blue border or a blue fill would
      // otherwise be the first run found.
      let edges: [number, number] | null = null
      if (straight) {
        const hits: boolean[] = []
        for (let step = scale; step < 8 * scale; step++) {
          hits.push(isRing(...at((step + 0.5) / scale)))
        }
        const first = hits.indexOf(true)
        if (first >= 0) {
          let last = first
          while (last < hits.length - 1 && hits[last + 1] === true) last++
          edges = [(first + scale) / scale, (last + 1 + scale) / scale]
        }
      }

      const still = unchanged.every((distance) => {
        const a = pixel(focused, ...at(distance))
        const b = pixel(rest, ...at(distance))
        return a === null || b === null || near(a, b)
      })

      return { side, onScreen: true, ring: found, straight, edges, unchanged: still }
    })

    return { readings, changedInside }
  }, {
    shots: { focused: focused.toString('base64'), rest: rest.toString('base64') },
    samples,
    inside,
    scale: SCALE,
    focus,
    tolerance: TOLERANCE,
    insideTolerance: INSIDE_TOLERANCE,
    ring: RING,
    unchanged: UNCHANGED,
  })

  // What draws no ring by decision is asked the opposite: no ring anywhere.
  if (stop.noRing !== null) {
    const ringed = readings.filter(reading => reading.onScreen && reading.ring).length
    return { failures: ringed === 0 ? [] : [`a ring at ${ringed} points around \`${stop.noRing}\`, which draws none`], moved }
  }

  const failures: string[] = []
  // The skip link slides in, and at rest it is somewhere else: it has nothing to
  // be compared with. Any other control that moves fails here, whatever else it
  // does — a hover that lifts the control would otherwise go unmeasured.
  if (moved && !stop.skipLink) failures.push('the control moved under focus: focus is rest plus the ring, and rest is where it was')

  for (const side of new Set(readings.map(reading => reading.side))) {
    // A side outside the viewport — a panel taller than the screen — is not read.
    const onScreen = readings.filter(reading => reading.side === side && reading.onScreen)
    if (onScreen.length === 0) continue
    const enough = (count: number): boolean => count >= onScreen.length * 0.9

    const ring = onScreen.filter(reading => reading.ring).length
    if (!enough(ring)) failures.push(`${side}: the ring is ${focus === null ? 'drawn' : '--focus'} at ${ring} of ${onScreen.length} points`)

    const measured = read.edges ? onScreen.filter(reading => reading.straight) : []
    const placed = measured.filter(({ edges }) => edges !== null
      && edges[0] >= INNER[0] && edges[0] <= INNER[1] && edges[1] >= OUTER[0] && edges[1] <= OUTER[1])
    if (measured.length > 0 && !enough(placed.length)) {
      const edges = measured.find(reading => !placed.includes(reading))?.edges
      const where = edges === null || edges === undefined ? 'nowhere' : `from ${edges[0]}px to ${edges[1]}px out`
      failures.push(`${side}: the ring runs ${where}, not from 3 to 5, at ${measured.length - placed.length} of ${measured.length} points`)
    }

    if (moved) continue
    const still = onScreen.filter(reading => reading.unchanged).length
    if (!enough(still)) failures.push(`${side}: the gap or the outside changed under focus at ${onScreen.length - still} of ${onScreen.length} points`)
  }

  if (!moved && read.inside && changedInside > 0) {
    failures.push(`inside: ${changedInside} device pixels changed under focus — focus is rest plus the ring, not hover`)
  }

  return { failures, moved }
}

for (const pass of PASSES) {
  test(`every keyboard stop draws the ring${pass.title}`, async ({ context, baseURL }) => {
    test.setTimeout(480_000)

    const addresses = pageAddresses()
    expect(addresses, 'the Hub is not measured').toContain('/')

    if (baseURL === undefined) throw new Error('the suite runs without a baseURL')
    const origin = new URL(baseURL).origin

    const kinds = new Set<Stop['kind']>()
    /** The classes of every stop whose inside was compared with rest. */
    const measured = new Set<string>()
    let skipLinkMoved = false

    for (const scene of [...addresses.map(pageScene), ...STATES]) {
      // A tab of its own, so a route, a session or a save never outlives its scene.
      const page = await context.newPage()
      await page.setViewportSize(pass.viewport)
      await page.emulateMedia({ forcedColors: pass.forcedColors })
      await openScene(page, scene, { origin })

      const focus = pass.forcedColors === 'active'
        ? null
        : await page.evaluate(() => {
            const probe = document.createElement('div')
            probe.style.color = 'var(--focus)'
            document.body.append(probe)
            const channels = getComputedStyle(probe).color.match(/\d+/g)?.slice(0, 3).map(Number) ?? []
            probe.remove()
            return channels
          })
      if (focus !== null) expect(focus, 'the page has no --focus to read').toHaveLength(3)

      const noRing = Object.keys(scene.noRing ?? {})
      const noRingMet = new Set<string>()
      const seen = new Set<string>()

      /** Measures the stop with the focus; false when there is none, or it was measured already. */
      const measureFocused = async (): Promise<boolean> => {
        const stop = await readStop(page, noRing)
        if (stop === null || seen.has(stop.key)) return false
        seen.add(stop.key)

        const { failures, moved } = await measure(page, stop, focus, pass)
        expect.soft(failures, `${scene.name} — ${stop.name}`).toEqual([])

        if (stop.noRing !== null) noRingMet.add(stop.noRing)
        else kinds.add(stop.kind)
        if (stop.skipLink && moved) skipLinkMoved = true
        if (stop.noRing === null && !moved) for (const name of stop.classes) measured.add(name)

        // Back to the stop, so the next Tab goes on from it.
        await page.evaluate(() => {
          const element: unknown = Reflect.get(window, 'e2eStop')
          if (element instanceof HTMLElement) element.focus({ preventScroll: true })
        })
        return true
      }

      /** Tab by Tab from wherever the focus is, until a stop comes round again. */
      const walk = async (): Promise<void> => {
        for (let step = 0; step < 400; step++) {
          await page.keyboard.press('Tab')
          if (!await measureFocused()) return
        }
      }

      // What a script focused as the state opened — a sheet, a field — first.
      await measureFocused()
      await walk()

      // A tab list takes one Tab stop, the selected tab, and the other panels
      // wait behind the arrow keys — the Detail's evolution chain among them,
      // which no walk reached until a hover planted on it passed. Focusing a tab
      // opens it, as the arrows do; each tab is measured and walked from.
      const tabs = page.getByRole('tab')
      for (let index = 0; index < await tabs.count(); index++) {
        await tabs.nth(index).focus()
        await measureFocused()
        await walk()
      }

      expect.soft(seen.size, `${scene.name}: no keyboard stop was measured`).toBeGreaterThan(0)
      expect.soft([...noRingMet].sort(), `${scene.name}: what draws no ring never took the focus`).toEqual([...noRing].sort())
      await page.close()
    }

    // Each way a ring is drawn, asked by name: a count over the sum would stay
    // green with one of them never measured.
    expect([...kinds].sort(), 'the kinds of ring measured').toEqual(['bevel', 'frame', 'outline', 'parent'])
    expect(skipLinkMoved, 'the skip link never slid in: the one control let to move is not measured').toBe(true)

    if (pass.inside) {
      const hover = hoverClasses()
      // The reader's other side: the class whose hover passed this gate twice.
      expect(hover, 'no hover rule was read from app/').toContain('chain__card')
      const missed = [...hover].filter(name => !measured.has(name)).sort()
      expect(missed, 'hover rules on controls no walk measured — the state that draws them belongs in STATES').toEqual([])
    }
  })
}
