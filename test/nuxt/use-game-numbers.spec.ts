// @vitest-environment nuxt
import { describe, expect, it } from 'vitest'
import { computed, defineComponent, h, nextTick } from 'vue'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { useGameNumbers } from '~/composables/useGameNumbers'

/**
 * The figures follow the language **after** the component exists.
 *
 * `useGameNumbers` reads the language each time one of its functions is called.
 * Reading it once in the setup would write the right figure on every page that
 * is loaded in its own language — which is all a `goto` per language can show —
 * and leave the figures in the old language when the selector changes it without
 * a reload. So the language changes here under a mounted component, and the
 * separators are written by hand, in both.
 *
 * One figure goes through a `computed`, the way `/settings` and `/rules` hold
 * theirs: a function that did not track the locale would freeze that one alone.
 */

const Figures = defineComponent({
  setup() {
    const { formatNumber, formatPercent, formatDecimal } = useGameNumbers()
    const weight = computed(() => formatDecimal(6, 1, 'megabyte'))

    return () => h('p', [formatNumber(1600), formatPercent(0.045), formatDecimal(0.8), weight.value].join(' | '))
  },
})

describe('the figures of a mounted component', () => {
  it('are rewritten when the language changes', async () => {
    const { locale } = useNuxtApp().$i18n
    const start = locale.value

    try {
      locale.value = 'pt-BR'

      const figures = await mountSuspended(Figures)
      expect(figures.text(), 'in pt-BR, before the change').toBe('1.600 | 4,5% | 0,8 | 6,0 MB')

      locale.value = 'en'
      await nextTick()

      expect(figures.text(), 'in English, on the same component').toBe('1,600 | 4.5% | 0.8 | 6.0 MB')
    }
    finally {
      locale.value = start
    }
  })
})
