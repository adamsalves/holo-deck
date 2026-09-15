<script setup lang="ts">
import type { TypeName } from '~~/shared/types/dex'
import { computed, ref } from 'vue'
import theme from '~/assets/css/main.css?raw'
import { requestTiltPermission, tiltNeedsPermission } from '~/composables/useFoil'
import { AA_LARGE, AA_NORMAL, contrastRatio } from '~~/shared/color/contrast'
import { inkLadder, resolveToken } from '~~/shared/color/tokens'
import { TYPE_NAMES } from '~~/shared/types/dex'
import type { Rarity } from '~~/shared/types/game'
import { rarityKey } from '~~/shared/types/game'

const { t } = useI18n()

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

const ladder = inkLadder(theme)

/** As superfícies, e a mais clara delas — que é contra quem o contraste decide. */
const surfaces = ['--bg', '--surface', '--surface-raised', '--surface-sunken', '--surface-cell']
  .map(name => ({ name, value: resolveToken(name, theme) ?? '' }))

const worstBackground = surfaces.reduce((worst, current) =>
  contrastRatio('#FFFFFF', current.value) < contrastRatio('#FFFFFF', worst.value) ? current : worst)

const roles = [
  { name: '--text', minimum: AA_NORMAL },
  { name: '--text-body', minimum: AA_NORMAL },
  { name: '--text-muted', minimum: AA_NORMAL },
  { name: '--text-faint', minimum: AA_LARGE },
].map(role => ({
  ...role,
  value: resolveToken(role.name, theme) ?? '',
  best: contrastRatio(resolveToken(role.name, theme) ?? '', resolveToken('--bg', theme) ?? ''),
  worst: contrastRatio(resolveToken(role.name, theme) ?? '', worstBackground.value),
}))

const bevels = ['card', 'tile', 'chip', 'control']

/** Um tipo por carta de exemplo, para as seis raridades não saírem todas iguais. */
const samples: { rarity: Rarity, name: string, dexNumber: number, types: readonly [TypeName] | readonly [TypeName, TypeName] }[] = [
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
const needsPermission = ref(false)
const tiltGranted = ref<boolean | null>(null)
onMounted(() => {
  needsPermission.value = tiltNeedsPermission()
})

async function requestTilt(): Promise<void> {
  tiltGranted.value = await requestTiltPermission()
}

const tiltSummary = computed(() => {
  if (tiltGranted.value === null) return ''
  return tiltGranted.value ? 'liberado' : 'recusado'
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
        Escada <span class="numeric text-muted">ink</span>, {{ ladder.length }} degraus
      </h2>
      <div class="flex flex-wrap gap-2">
        <div
          v-for="rung in ladder"
          :key="rung.step"
          class="flex w-24 flex-col gap-1"
        >
          <div
            class="h-12 border border-default"
            :style="{ background: rung.value }"
          />
          <span class="numeric text-[10px] text-muted">ink-{{ rung.step }}</span>
        </div>
      </div>
    </section>

    <section class="flex flex-col gap-4">
      <h2 class="text-xl font-bold text-highlighted">
        Papéis de texto
      </h2>
      <p class="text-sm text-muted">
        As duas razões são o melhor e o pior caso: sobre <code class="numeric">--bg</code> e sobre
        <code class="numeric">{{ worstBackground.name }}</code>, a superfície mais clara do sistema. É a
        segunda que decide — nenhum texto de carta cai sobre o fundo da página.
      </p>
      <div class="flex flex-col gap-2">
        <p
          v-for="role in roles"
          :key="role.name"
          class="flex items-baseline gap-4"
          :style="{ color: role.value }"
        >
          <span class="numeric w-32 text-xs">{{ role.name }}</span>
          <span class="flex-1">O rápido Ninetales salta sobre o Snorlax preguiçoso.</span>
          <span class="numeric w-32 text-right text-xs">
            {{ role.best.toFixed(2) }} / {{ role.worst.toFixed(2) }}:1
          </span>
          <span class="numeric w-10 text-right text-xs">{{ role.worst >= role.minimum ? 'AA' : '✗' }}</span>
        </p>
      </div>
    </section>

    <section class="flex flex-col gap-4">
      <h2 class="text-xl font-bold text-highlighted">
        Superfícies
      </h2>
      <div class="flex flex-wrap gap-3">
        <div
          v-for="surface in surfaces"
          :key="surface.name"
          class="flex h-20 w-40 items-end border border-default p-2"
          :style="{ background: surface.value }"
        >
          <span class="numeric text-[10px] text-muted">{{ surface.name }}</span>
        </div>
      </div>
    </section>

    <section class="flex flex-col gap-4">
      <h2 class="text-xl font-bold text-highlighted">
        Chanfro, quatro degraus
      </h2>
      <div class="flex flex-wrap items-end gap-4">
        <div
          v-for="bevel in bevels"
          :key="bevel"
          class="flex h-20 w-32 items-center justify-center bg-elevated"
          :class="`bevel-${bevel}`"
        >
          <span class="numeric text-[10px] text-muted">{{ bevel }}</span>
        </div>
      </div>
    </section>

    <section class="flex flex-col gap-4">
      <h2 class="text-xl font-bold text-highlighted">
        Os 18 tipos
      </h2>
      <div class="flex flex-wrap gap-2">
        <DexTypeBadge
          v-for="type in TYPE_NAMES"
          :key="type"
          :type="type"
        />
      </div>
      <div class="flex flex-wrap gap-3">
        <div
          v-for="type in TYPE_NAMES"
          :key="type"
          :data-type="type"
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
        O foil começa em <strong class="text-default">{{ t(rarityKey('rare')).toLowerCase() }}</strong>.
        As duas primeiras cartas não têm camada de brilho nenhuma. Passe o ponteiro sobre a fileira de baixo.
      </p>

      <p
        v-if="needsPermission"
        class="flex items-center gap-3 text-sm text-muted"
      >
        <button
          type="button"
          class="bevel-control bg-elevated px-3 py-2 text-xs font-bold text-default uppercase"
          @click="requestTilt"
        >
          Ativar inclinação
        </button>
        <span>Este aparelho exige permissão para o giroscópio. {{ tiltSummary }}</span>
      </p>

      <div class="flex flex-col gap-2">
        <span class="numeric text-xs text-muted">estáticas — como aparecem no grid</span>
        <div class="grid grid-cols-6 gap-3">
          <DexPokeCard
            v-for="sample in samples"
            :key="sample.rarity"
            v-bind="sample"
          >
            <template #art>
              <img
                :src="`/sprites/${sample.dexNumber}.webp`"
                :alt="sample.name"
              >
            </template>
          </DexPokeCard>
        </div>
      </div>

      <div class="mt-4 flex flex-col gap-2">
        <span class="numeric text-xs text-muted">interativas — foil e inclinação seguem o ponteiro</span>
        <div class="grid grid-cols-6 gap-3">
          <DexPokeCard
            v-for="sample in samples"
            :key="sample.rarity"
            v-bind="sample"
            interactive
          >
            <template #art>
              <img
                :src="`/sprites/${sample.dexNumber}.webp`"
                :alt="sample.name"
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
