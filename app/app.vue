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

const { locale, localeProperties } = useI18n()

/**
 * O fallback não é defensividade solta: `locale` é `string` para o vue-i18n, e
 * este `computed` precisa devolver alguma coisa para todo valor possível.
 *
 * **E ele não está guardado por portão nenhum — o comentário anterior dizia que
 * estava.** Ele creditava a garantia ao portão de paridade de chaves, que afirma
 * outra coisa: que existe mais de um arquivo em `i18n/locales/` e que os dois
 * trazem as mesmas chaves. Ele não conhece este mapa nem a lista de `locales` do
 * `nuxt.config.ts`. Um espanhol acrescentado ao config e ao diretório passa nos
 * sete testes e cai neste `else`: toda tela `/es/…` com os primitivos do Nuxt UI
 * — fechar modal, paginação, date picker — falando **português**.
 *
 * O portão que fecha isso precisa comparar `Object.keys(UI_LOCALES)` com os
 * `code` do config, e para isso o mapa tem de sair do `app.vue` para um módulo.
 * Fica para o PR 4, que é quando o seletor de idioma torna um terceiro locale
 * plausível. Até lá a lacuna está escrita, que é o mínimo que este repositório
 * cobra de si.
 */
const uiLocale = computed(() => (
  locale.value === 'en' ? UI_LOCALES.en : UI_LOCALES['pt-BR']
))

/**
 * O `lang` e o `dir` do `<html>`, do locale ativo.
 *
 * **Isto não é opcional, e a falta dele foi medida.** Ao tirar o
 * `htmlAttrs.lang: 'pt-BR'` fixo do `nuxt.config.ts`, o HTML pré-renderizado saiu
 * `<html class="dark">` nos dois idiomas: nenhum `lang`, que é pior do que o
 * valor fixo que havia antes. Conferido no `.output/public/index.html` e no
 * `en/index.html`. Mora no `app.vue` porque aqui vale para toda rota — uma
 * página que esquecesse de declarar idioma sairia muda para o leitor de tela.
 *
 * **Por que `localeProperties` e não `useLocaleHead`, que é o que a documentação
 * mostra.** Aquele composable resolve o `lang` e, no mesmo passo, emite
 * `hreflang`, `canonical` e `og:url` — e os três, aqui e agora, fazem mal:
 *
 * - O rastreador de pré-render **segue** as tags `alternate`. Com elas ligadas o
 *   build passava de 1.061 para 2.104 páginas, metade delas `/en/…` com
 *   `lang="en-US"` sobre corpo em **português** — as telas só são traduzidas nos
 *   PRs 2 a 4, e `main` publica em produção. Medido: 139 MB contra 76 MB.
 * - Sem `baseUrl` o módulo emite tudo **relativo** e avisa uma vez por página
 *   (*"I18n baseUrl is required to generate valid SEO tag links"*, 1.061 vezes
 *   num build). O Google ignora anotação `hreflang` relativa, então seriam
 *   marcação sem efeito — e o aviso enterraria qualquer outro.
 * - `seo: false` desliga as tags e **não** desliga o aviso: ele mora no
 *   `createHeadContext`, antes do ramo que olha a opção.
 *
 * `localeProperties` é a configuração de locale que o próprio módulo resolveu —
 * `code`, `language` e `dir` —, então o `lang` continua vindo dele e não de uma
 * cópia nossa. Os três itens de SEO entram juntos no PR 4, com `baseUrl` e com as
 * telas traduzidas, que é quando passam a dizer a verdade.
 */
useHead(() => ({
  htmlAttrs: {
    lang: localeProperties.value.language,
    // Hoje os dois locales são LTR e o módulo não declara `dir` para nenhum. O
    // `ltr` explícito é o que impede o atributo de sumir — que é o defeito do
    // `lang` acima, na outra metade do mesmo par.
    dir: localeProperties.value.dir ?? 'ltr',
  },
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
