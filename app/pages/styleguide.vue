<script setup lang="ts">
import type { TypeName } from '~~/shared/types/dex'
import { computed, ref } from 'vue'
import theme from '~/assets/css/main.css?raw'
import { requestTiltPermission, tiltNeedsPermission } from '~/composables/useFoil'
import { AA_LARGE, AA_NORMAL, contrastRatio } from '~~/shared/color/contrast'
import { inkLadder, resolveToken } from '~~/shared/color/tokens'
import { TYPE_NAMES } from '~~/shared/types/dex'
import type { Rarity } from '~~/shared/types/game'
import { RARITY_LABELS } from '~~/shared/types/game'

/**
 * O espelho do sistema — a prancha *Tokens* do canvas, em código.
 *
 * Existe só em desenvolvimento: o módulo em linha do `nuxt.config.ts` a remove do
 * build, então ela não entra na lista de rotas do plano nem é indexável. O
 * trabalho dela é o que teste não faz — deixar ver que o foil só aparece de raro
 * para cima, que a inclinação segue o ponteiro, e que com `prefers-reduced-motion`
 * ligado no sistema operacional nada disso se mexe.
 *
 * **Ela lê o `main.css`, não uma cópia dele.** A escada, os papéis e as razões de
 * contraste saem do próprio arquivo do tema, pelo mesmo analisador que o portão
 * usa. A versão anterior repetia os quinze degraus e os quatro números à mão, e
 * um espelho que repete à mão é um espelho que pode mentir — foi exatamente
 * assim que os papéis ficaram exibindo a razão contra o fundo da página enquanto
 * o texto era renderizado sobre a carta.
 */
definePageMeta({ layout: false })

const escada = inkLadder(theme)

/** As superfícies, e a mais clara delas — que é contra quem o contraste decide. */
const superficies = ['--bg', '--surface', '--surface-raised', '--surface-sunken', '--surface-cell']
  .map(nome => ({ nome, valor: resolveToken(nome, theme) ?? '' }))

const piorFundo = superficies.reduce((pior, atual) =>
  contrastRatio('#FFFFFF', atual.valor) < contrastRatio('#FFFFFF', pior.valor) ? atual : pior)

const papeis = [
  { nome: '--text', minimo: AA_NORMAL },
  { nome: '--text-body', minimo: AA_NORMAL },
  { nome: '--text-muted', minimo: AA_NORMAL },
  { nome: '--text-faint', minimo: AA_LARGE },
].map(papel => ({
  ...papel,
  valor: resolveToken(papel.nome, theme) ?? '',
  melhor: contrastRatio(resolveToken(papel.nome, theme) ?? '', resolveToken('--bg', theme) ?? ''),
  pior: contrastRatio(resolveToken(papel.nome, theme) ?? '', piorFundo.valor),
}))

const chanfros = ['card', 'tile', 'chip', 'control']

/** Um tipo por carta de exemplo, para as seis raridades não saírem todas iguais. */
const exemplos: { rarity: Rarity, name: string, dexNumber: number, types: readonly [TypeName] | readonly [TypeName, TypeName] }[] = [
  { rarity: 'common', name: 'Rattata', dexNumber: 19, types: ['normal'] },
  { rarity: 'uncommon', name: 'Machoke', dexNumber: 67, types: ['fighting'] },
  { rarity: 'rare', name: 'Charizard', dexNumber: 6, types: ['fire', 'flying'] },
  { rarity: 'ultra', name: 'Dragonite', dexNumber: 149, types: ['dragon', 'flying'] },
  { rarity: 'legendary', name: 'Zapdos', dexNumber: 145, types: ['electric', 'flying'] },
  { rarity: 'mythic', name: 'Mew', dexNumber: 151, types: ['psychic'] },
]

/**
 * O botão da portaria do giroscópio.
 *
 * No iOS 13+ o `deviceorientation` não chega sem `requestPermission()`, e a
 * chamada só vale dentro de um gesto. Aqui é onde dá para exercitar isso hoje; a
 * tela de Ajustes da Fase 6 chama a mesma função. Fora do iOS o botão nem
 * aparece, porque não há nada a pedir.
 */
const pedePermissao = ref(false)
const inclinacaoLiberada = ref<boolean | null>(null)
onMounted(() => {
  pedePermissao.value = tiltNeedsPermission()
})

async function liberarInclinacao(): Promise<void> {
  inclinacaoLiberada.value = await requestTiltPermission()
}

const resumoInclinacao = computed(() => {
  if (inclinacaoLiberada.value === null) return ''
  return inclinacaoLiberada.value ? 'liberado' : 'recusado'
})
</script>

<template>
  <main class="mx-auto flex max-w-5xl flex-col gap-14 p-10">
    <header class="flex flex-col gap-2">
      <h1 class="text-3xl font-bold text-highlighted">
        Sistema Holo TCG
      </h1>
      <p class="text-sm text-muted">
        Espelho dos tokens, lido do <code class="numeric">main.css</code>. Só em desenvolvimento —
        fora do build e fora das rotas do plano.
      </p>
    </header>

    <section class="flex flex-col gap-4">
      <h2 class="text-xl font-bold text-highlighted">
        Escada <span class="numeric text-muted">ink</span>, {{ escada.length }} degraus
      </h2>
      <div class="flex flex-wrap gap-2">
        <div
          v-for="degrau in escada"
          :key="degrau.step"
          class="flex w-24 flex-col gap-1"
        >
          <div
            class="h-12 border border-default"
            :style="{ background: degrau.value }"
          />
          <span class="numeric text-[10px] text-muted">ink-{{ degrau.step }}</span>
        </div>
      </div>
    </section>

    <section class="flex flex-col gap-4">
      <h2 class="text-xl font-bold text-highlighted">
        Papéis de texto
      </h2>
      <p class="text-sm text-muted">
        As duas razões são o melhor e o pior caso: sobre <code class="numeric">--bg</code> e sobre
        <code class="numeric">{{ piorFundo.nome }}</code>, a superfície mais clara do sistema. É a
        segunda que decide — nenhum texto de carta cai sobre o fundo da página.
      </p>
      <div class="flex flex-col gap-2">
        <p
          v-for="papel in papeis"
          :key="papel.nome"
          class="flex items-baseline gap-4"
          :style="{ color: papel.valor }"
        >
          <span class="numeric w-32 text-xs">{{ papel.nome }}</span>
          <span class="flex-1">O rápido Ninetales salta sobre o Snorlax preguiçoso.</span>
          <span class="numeric w-32 text-right text-xs">
            {{ papel.melhor.toFixed(2) }} / {{ papel.pior.toFixed(2) }}:1
          </span>
          <span class="numeric w-10 text-right text-xs">{{ papel.pior >= papel.minimo ? 'AA' : '✗' }}</span>
        </p>
      </div>
    </section>

    <section class="flex flex-col gap-4">
      <h2 class="text-xl font-bold text-highlighted">
        Superfícies
      </h2>
      <div class="flex flex-wrap gap-3">
        <div
          v-for="superficie in superficies"
          :key="superficie.nome"
          class="flex h-20 w-40 items-end border border-default p-2"
          :style="{ background: superficie.valor }"
        >
          <span class="numeric text-[10px] text-muted">{{ superficie.nome }}</span>
        </div>
      </div>
    </section>

    <section class="flex flex-col gap-4">
      <h2 class="text-xl font-bold text-highlighted">
        Chanfro, quatro degraus
      </h2>
      <div class="flex flex-wrap items-end gap-4">
        <div
          v-for="chanfro in chanfros"
          :key="chanfro"
          class="flex h-20 w-32 items-center justify-center bg-elevated"
          :class="`bevel-${chanfro}`"
        >
          <span class="numeric text-[10px] text-muted">{{ chanfro }}</span>
        </div>
      </div>
    </section>

    <section class="flex flex-col gap-4">
      <h2 class="text-xl font-bold text-highlighted">
        Os 18 tipos
      </h2>
      <div class="flex flex-wrap gap-2">
        <DexTypeBadge
          v-for="tipo in TYPE_NAMES"
          :key="tipo"
          :type="tipo"
        />
      </div>
      <div class="flex flex-wrap gap-3">
        <div
          v-for="tipo in TYPE_NAMES"
          :key="tipo"
          :data-type="tipo"
          class="h-2 w-28"
          :style="{ background: 'var(--type)', boxShadow: '0 0 16px var(--type)' }"
        />
      </div>
    </section>

    <section class="flex flex-col gap-4">
      <h2 class="text-xl font-bold text-highlighted">
        As seis raridades
      </h2>
      <p class="text-sm text-muted">
        O foil começa em <strong class="text-default">{{ RARITY_LABELS.rare.toLowerCase() }}</strong>.
        As duas primeiras cartas não têm camada de brilho nenhuma. Passe o ponteiro sobre a fileira de baixo.
      </p>

      <p
        v-if="pedePermissao"
        class="flex items-center gap-3 text-sm text-muted"
      >
        <button
          type="button"
          class="bevel-control bg-elevated px-3 py-2 text-xs font-bold text-default uppercase"
          @click="liberarInclinacao"
        >
          Ativar inclinação
        </button>
        <span>Este aparelho exige permissão para o giroscópio. {{ resumoInclinacao }}</span>
      </p>

      <div class="flex flex-col gap-2">
        <span class="numeric text-xs text-muted">estáticas — como aparecem no grid</span>
        <div class="grid grid-cols-6 gap-3">
          <DexPokeCard
            v-for="exemplo in exemplos"
            :key="exemplo.rarity"
            v-bind="exemplo"
          >
            <template #art>
              <img
                :src="`/sprites/${exemplo.dexNumber}.webp`"
                :alt="exemplo.name"
              >
            </template>
          </DexPokeCard>
        </div>
      </div>

      <div class="mt-4 flex flex-col gap-2">
        <span class="numeric text-xs text-muted">interativas — foil e inclinação seguem o ponteiro</span>
        <div class="grid grid-cols-6 gap-3">
          <DexPokeCard
            v-for="exemplo in exemplos"
            :key="exemplo.rarity"
            v-bind="exemplo"
            interactive
          >
            <template #art>
              <img
                :src="`/sprites/${exemplo.dexNumber}.webp`"
                :alt="exemplo.name"
              >
            </template>
          </DexPokeCard>
        </div>
      </div>
    </section>

    <section class="flex flex-col gap-4">
      <h2 class="text-xl font-bold text-highlighted">
        Tipografia
      </h2>
      <p class="text-4xl font-bold text-highlighted">
        Chakra Petch · display
      </p>
      <p class="text-base">
        Chakra Petch · corpo, no peso 400
      </p>
      <p class="numeric text-2xl">
        0123456789 · 110 HP · 1.600 pó
      </p>
      <p class="numeric text-2xl">
        1111111111 · 999 HP · 1.111 pó
      </p>
      <p class="text-sm text-muted">
        As duas linhas acima têm que ter exatamente a mesma largura — é o que
        <code class="numeric">tabular-nums</code> garante.
      </p>
    </section>
  </main>
</template>
