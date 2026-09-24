<script setup lang="ts">
import { computed } from 'vue'
import appIcon from '~~/app/assets/images/app-icon.svg?no-inline'
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
 * page lives in the other one: `lang` and `dir` on `<html>`, two `hreflang`
 * alternates per language — the regional tag, and the bare language the module
 * adds as the catch-all for its other regions (`pt-BR` and `pt`) — plus
 * `x-default`, the `canonical`, and `og:url`, `og:locale` and
 * `og:locale:alternate`.
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
 * The app's icon, as the browser shows it — the board *O ícone do app*: the
 * tab's cut as an SVG, the same file the bar draws; a 32 and 16 px ICO for a
 * browser that does not read an SVG icon; and the 180 px square, with its
 * background, that iOS puts on a home screen and in its favourites.
 *
 * And the manifest, which makes the game installable: the board's name,
 * colours and icons (192 and 512, the same master). Each icon is listed once
 * as `any` and once as `maskable`, not as `"any maskable"`, which Chrome warns
 * against — the master can be both because the deck sits inside the circle a
 * mask keeps and the background runs to the edge. `start_url` is the root,
 * which the board leaves unsaid: without it, a player who installs from a
 * Pokémon's page would have the app open on that page every time.
 *
 * Here and not in the bar because two routes render without it — the battle
 * and the style guide.
 *
 * The `key` keeps the SVG's link one tag. The server writes its address from
 * the root and the client from the bundle's own URL, absolute — two hrefs for
 * one file, and unhead tells links apart by the href: without the key, the
 * booted page carried the icon twice (measured on the preview of PR #68).
 */
useHead({
  link: [
    { rel: 'icon', href: '/favicon.ico', sizes: '32x32' },
    { rel: 'icon', href: appIcon, type: 'image/svg+xml', key: 'app-icon' },
    { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
    { rel: 'manifest', href: '/manifest.webmanifest' },
  ],
})

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
 * `critical` — weight 42 in unhead's order — keeps it ahead of every other
 * script in the `<head>`. It is not what puts it ahead of the stylesheets: an
 * inline script weighs 50 and a stylesheet 60, so it would be there without
 * it. Whatever does sit in front of it costs the redirect time — a blocking
 * script to download, or a stylesheet an inline script has to wait for — and
 * not a paint of the Hub: the parser is still in the `<head>`, with no `<body>`
 * to draw.
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
