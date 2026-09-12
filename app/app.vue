<script setup lang="ts">
import { computed } from 'vue'
import * as uiLocales from '@nuxt/ui/locale'

/**
 * Os primitivos do Nuxt UI falam o idioma ativo.
 *
 * Ele traz 128 locales prontos, então nada aqui se traduz à mão — o que falta é
 * o fio entre o locale do `@nuxtjs/i18n` e o `:locale` do `UApp`.
 *
 * **O mapa é explícito porque os dois lados nomeiam locale de forma diferente:**
 * o Nuxt UI exporta `pt_br` (snake_case, que é nome de identificador) e o código
 * do locale é `pt-BR` (hifenizado, que é etiqueta BCP 47). O
 * `locales[locale.value]` que a documentação mostra devolveria `undefined` para
 * o padrão deste projeto. Escrever o mapa deixa a discrepância visível, em vez de
 * esconder um `replace('-', '_')` que ninguém lembra de ler.
 */
const UI_LOCALES = {
  'pt-BR': uiLocales.pt_br,
  'en': uiLocales.en,
}

const { locale } = useI18n()

/**
 * O fallback não é defensividade solta: `locale` é `string` para o vue-i18n, e o
 * portão de paridade de chaves é quem garante que os dois idiomas existam. Se um
 * terceiro locale entrar sem passar por aqui, os primitivos falam português em
 * vez de quebrar a tela.
 */
const uiLocale = computed(() => (
  locale.value === 'en' ? UI_LOCALES.en : UI_LOCALES['pt-BR']
))

/**
 * O `lang` do `<html>`, e as tags `hreflang`.
 *
 * **Isto não é opcional, e a falta dele foi medida.** Ao tirar o
 * `htmlAttrs.lang: 'pt-BR'` fixo do `nuxt.config.ts`, a documentação do módulo diz
 * que ele "define o `lang` a partir do locale ativo" — e define, mas só através
 * **deste** composable. Sem a chamada, o HTML pré-renderizado saiu `<html
 * class="dark">` nos dois idiomas: nenhum `lang`, que é pior do que o valor fixo
 * que havia antes. Conferido no `.output/public/index.html` e no `en/index.html`.
 *
 * `useLocaleHead` também emite `hreflang` para os dois locales e o `canonical`
 * auto-referente — os três itens de SEO que o plano pede —, e é por isso que ele
 * mora no `app.vue`: aqui vale para toda rota, e uma página que esquecesse de
 * chamá-lo sairia sem idioma declarado.
 */
const localeHead = useLocaleHead()

useHead(() => ({
  htmlAttrs: { lang: localeHead.value.htmlAttrs?.lang },
  link: [...localeHead.value.link ?? []],
  meta: [...localeHead.value.meta ?? []],
}))
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
