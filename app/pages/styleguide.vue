<script setup lang="ts">
import type { TypeName } from '~~/shared/types/dex'
import { TYPE_NAMES } from '~~/shared/types/dex'
import type { RARITY_NAMES } from '~~/shared/types/game'

/**
 * O espelho do sistema — a prancha *Tokens* do canvas, em código.
 *
 * Existe só em desenvolvimento: o `pages:extend` do `nuxt.config.ts` a remove do
 * build, então ela não entra na lista de rotas do plano nem é indexável. O
 * trabalho dela é o que teste não faz — deixar ver que o foil só aparece de raro
 * para cima, que a inclinação segue o ponteiro, e que com `prefers-reduced-motion`
 * ligado no sistema operacional nada disso se mexe.
 *
 * É também a única página autorizada a citar primitivo pelo nome, porque mostrar
 * os primitivos é literalmente o que ela faz. O portão de token a lista como
 * exceção, à vista de todos.
 */
definePageMeta({ layout: false })

const escada = [
  '950', '900', '880', '850', '800', '700', '600', '500', '450',
  '400', '350', '300', '200', '100', '50',
]

const papeis = [
  { nome: '--text', razao: '17.19' },
  { nome: '--text-body', razao: '7.57' },
  { nome: '--text-muted', razao: '4.73' },
  { nome: '--text-faint', razao: '3.34' },
]

const superficies = ['--bg', '--surface', '--surface-raised', '--surface-sunken', '--surface-cell']

const chanfros = ['card', 'tile', 'chip', 'control']

/** Um tipo por carta de exemplo, para as seis raridades não saírem todas iguais. */
const exemplos: { rarity: typeof RARITY_NAMES[number], name: string, dexNumber: number, types: readonly [TypeName] }[] = [
  { rarity: 'common', name: 'Rattata', dexNumber: 19, types: ['normal'] },
  { rarity: 'uncommon', name: 'Machoke', dexNumber: 67, types: ['fighting'] },
  { rarity: 'rare', name: 'Charizard', dexNumber: 6, types: ['fire'] },
  { rarity: 'ultra', name: 'Dragonite', dexNumber: 149, types: ['dragon'] },
  { rarity: 'legendary', name: 'Zapdos', dexNumber: 145, types: ['electric'] },
  { rarity: 'mythic', name: 'Mew', dexNumber: 151, types: ['psychic'] },
]
</script>

<template>
  <main class="mx-auto flex max-w-5xl flex-col gap-14 p-10">
    <header class="flex flex-col gap-2">
      <h1 class="text-3xl font-bold text-highlighted">
        Sistema Holo TCG
      </h1>
      <p class="text-sm text-muted">
        Espelho dos tokens. Só em desenvolvimento — fora do build e fora das rotas do plano.
      </p>
    </header>

    <section class="flex flex-col gap-4">
      <h2 class="text-xl font-bold text-highlighted">
        Escada <span class="numeric text-muted">ink</span>, 15 degraus
      </h2>
      <div class="flex flex-wrap gap-2">
        <div
          v-for="degrau in escada"
          :key="degrau"
          class="flex w-24 flex-col gap-1"
        >
          <div
            class="h-12 border border-default"
            :style="{ background: `var(--color-ink-${degrau})` }"
          />
          <span class="numeric text-[10px] text-muted">ink-{{ degrau }}</span>
        </div>
      </div>
    </section>

    <section class="flex flex-col gap-4">
      <h2 class="text-xl font-bold text-highlighted">
        Papéis de texto
      </h2>
      <div class="flex flex-col gap-2">
        <p
          v-for="papel in papeis"
          :key="papel.nome"
          class="flex items-baseline gap-4"
          :style="{ color: `var(${papel.nome})` }"
        >
          <span class="numeric w-32 text-xs">{{ papel.nome }}</span>
          <span>O rápido Ninetales salta sobre o Snorlax preguiçoso.</span>
          <span class="numeric text-xs">{{ papel.razao }}:1</span>
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
          :key="superficie"
          class="flex h-20 w-40 items-end border border-default p-2"
          :style="{ background: `var(${superficie})` }"
        >
          <span class="numeric text-[10px] text-muted">{{ superficie }}</span>
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
        O foil começa em <strong class="text-default">raro</strong>. As duas primeiras cartas não têm
        camada de brilho nenhuma. Passe o ponteiro sobre a fileira de baixo.
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
