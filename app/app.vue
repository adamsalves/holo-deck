<script setup lang="ts">
import { computed } from 'vue'
import { ROOT_GUARD_ID, rootGuardScript } from '~~/app/utils/locale-preference'
import { UI_LOCALES } from '~~/app/utils/ui-locales'

const { locale } = useI18n()

/**
 * The Nuxt UI primitives speak the active language — see `UI_LOCALES` for why
 * the map is written out and what keeps it complete.
 *
 * No fallback any more. The old one existed because nothing guaranteed the map
 * had every language, and it answered a missing one with Portuguese. `locale` is
 * typed as the union of the configured codes, the config reads them from
 * `app/utils/locales.ts`, and the map is a `Record` over that same list — so the
 * missing case does not compile.
 */
const uiLocale = computed(() => UI_LOCALES[locale.value])

/**
 * The document's language, and the links that tell a search engine where the
 * page lives in the other one: `lang` and `dir` on `<html>`, one `hreflang`
 * alternate per language plus `x-default`, the `canonical`, and `og:url`,
 * `og:locale` and `og:locale:alternate`.
 *
 * **Here because it holds for every route** — a page that forgot to declare its
 * language would go out mute to a screen reader. Measured before, when the fixed
 * `lang` left `nuxt.config.ts`: the prerendered HTML came out `<html
 * class="dark">` in both languages.
 *
 * **Held back from PR 1 to this one, for two measured reasons (issue #39).** The
 * alternates are links, and with them on while the screens were still in
 * Portuguese the build wrote a thousand `/en/…` pages declaring `en-US` over
 * Portuguese text. And with no `baseUrl` the module writes every link relative,
 * which Google ignores in an `hreflang` annotation, and warns once per page. Both
 * are gone: every screen speaks both languages, and the config hands the module
 * the site's origin. Absolute links do not grow the build either — the
 * prerender crawler skips a link that carries a scheme or a host, so the page
 * count only moved by the nine battles the config lists.
 *
 * The explicit `dir: 'ltr'` of the previous version is gone with it: the module
 * falls back to its default direction, which is `ltr`, and
 * `test/e2e/locale-head.spec.ts` asserts the attribute on every built page.
 */
const localeHead = useLocaleHead()

useHead(() => ({
  htmlAttrs: localeHead.value.htmlAttrs,
  link: localeHead.value.link,
  meta: localeHead.value.meta,
}))

/**
 * The root opens in the language this device remembers — see `rootGuardScript`
 * for why it is an inline script and not a plugin.
 *
 * **Server only, and only for `/`.** It belongs to the HTML the server writes
 * for the root, and to nothing the client does afterwards: the client head
 * manager leaves an element it never registered where the server put it, and
 * never runs it again. What keeps it off client-side navigations is partly where
 * it is written — this setup runs once on the client, at hydration, so the
 * condition below is never asked again — and partly `import.meta.server`, which
 * holds wherever it moves: in a page component, whose setup runs on every
 * visit, a client registration would be inserted on each visit to `/`, and an
 * inserted script runs. `test/e2e/language.spec.ts` measures the behaviour, and
 * not this placement.
 *
 * `critical` puts it ahead of the stylesheets in the `<head>`: an inline script
 * after a pending stylesheet waits for it to load, and that wait is time the
 * Hub could spend being painted.
 */
const route = useRoute()

if (import.meta.server && route.path === '/') {
  useHead({
    script: [{ id: ROOT_GUARD_ID, innerHTML: rootGuardScript(), tagPriority: 'critical' }],
  })
}
</script>

<template>
  <UApp :locale="uiLocale">
    <!-- O aviso de save recuperado fica acima do layout e fora dele: ele é
         estado do **boot**, não de uma tela, e o jogador precisa vê-lo em
         qualquer rota que tenha aberto o jogo. `ClientOnly` porque o plugin que
         o alimenta é `.client` — não há save no servidor. -->
    <ClientOnly>
      <SaveRecoveryNotice />

      <!-- A escolha do primeiro login fica no mesmo lugar e pelo mesmo motivo:
           é estado do **boot**, não de uma tela, e enquanto ela estiver de pé o
           jogo não sabe qual coleção é a do jogador. Ver a prancha
           *Duas coleções* — a única do sistema que pede decisão. -->
      <SaveChoice />

      <!-- O aviso de conflito do sync, pelo mesmo motivo: ele é estado da
           sessão, e não de uma tela — o 409 se resolve em qualquer rota,
           inclusive na batalha, que não tem a barra. -->
      <SyncConflictNotice />

      <!-- O convite de conta, pelo mesmo motivo: quem o pede é o momento — a
           vitória, o fim de um pack, o Hub —, e não uma tela. -->
      <AccountInvite />
    </ClientOnly>

    <!-- Sem NuxtLayout aqui, o primeiro app/layouts/default.vue da Fase 2 é
         ignorado em silêncio: com app.vue presente, o layout só entra por ele. -->
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
