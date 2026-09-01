<script setup lang="ts">
import type { SpeciesEntry } from '~~/shared/types/dex'
import { computed } from 'vue'
import { flattenChain } from '~~/shared/game/evolution'
import { rarityOf } from '~~/shared/game/rarity'
import { RARITY_LABELS } from '~~/shared/types/game'
import { artworkUrl } from '~~/shared/dex/artwork'
import { dexNumber, toRegions } from '~/composables/useRegions'
import { useDex } from '~/composables/useDex'

/**
 * A página de uma espécie — a prancha *Detalhe*.
 *
 * Uma URL por entidade: `/pokemon/[name]`, e não `/pokedex/[gen]/[name]`. A
 * espécie é uma só; aninhá-la sob a geração criaria duas URLs para ela no dia em
 * que a coleção também listasse cartas.
 *
 * O que esta tela **não** faz é uma requisição por estágio de evolução. A
 * Pokédex antiga resolvia a cadeia com N chamadas em série à PokeAPI; aqui ela
 * sai de `chains.json`, que é artefato commitado. É a promessa central da fase.
 */
const route = useRoute()
const { loadCore, loadChains, loadFlavor, loadGeneration, loadIndex, findBySlug } = useDex()

const slug = computed(() => (typeof route.params.name === 'string' ? route.params.name : ''))

const { data, error } = await useAsyncData(
  () => `pokemon-${slug.value}`,
  async () => {
    const entry = await findBySlug(slug.value)
    if (entry === null) {
      throw createError({ statusCode: 404, statusMessage: 'Espécie fora do dex', fatal: true })
    }

    const [core, chains, index, generation, flavor] = await Promise.all([
      loadCore(),
      loadChains(),
      loadIndex(),
      loadGeneration(entry.generation),
      loadFlavor(entry.generation),
    ])

    const species = generation.species.find(candidate => candidate.id === entry.id)
    if (species === undefined) {
      // O índice e o arquivo da geração discordarem é o deploy parcial que os
      // guardas descrevem — e aqui ele tem um nome e um id para citar.
      throw createError({
        statusCode: 500,
        statusMessage: `${entry.slug} está no índice e não em gen-${entry.generation}.json`,
        fatal: true,
      })
    }

    const chainRoot = chains[String(species.evolutionChainId)] ?? null

    /**
     * Uma cadeia atravessa gerações — Electabuzz é da I e Electivire da IV —, e
     * só a geração desta espécie está carregada. Sem as outras, o estágio
     * aparece com o slug cru no lugar do nome e sem BST. São uma ou duas
     * requisições a mais, e elas ficam no cache para a próxima carta da linha.
     */
    const memberIds = chainRoot === null ? [] : flattenChain(chainRoot).map(node => node.speciesId)
    const memberGenerations = new Set(
      memberIds.flatMap((id) => {
        const found = index.find(candidate => candidate.id === id)
        return found === undefined ? [] : [found.generation]
      }),
    )
    const loaded = await Promise.all([...memberGenerations].map(loadGeneration))
    const chainSpecies = loaded
      .flatMap(data => data.species)
      .filter(candidate => memberIds.includes(candidate.id))

    const region = toRegions(core.generations)
      .find(candidate => candidate.generation === entry.generation) ?? null

    return {
      species,
      region,
      chainRoot,
      chainSpecies,
      // Só a matriz: `core.json` inteiro carrega 368 golpes, e mandá-lo no
      // payload seria embutir o catálogo de batalha em 1025 páginas.
      effectiveness: core.effectiveness,
      description: flavor[String(species.id)] ?? null,
    }
  },
  { watch: [slug] },
)

/**
 * O erro precisa ser relançado aqui — `useAsyncData` o **captura**.
 *
 * Um `createError` dentro do handler vira `error.value` e a página segue
 * renderizando com `data` nulo: `/pokemon/missingno` respondia 200 com uma
 * coluna vazia, o que é pior que um 404 porque o buscador indexa. Relançar em
 * setup é o que transforma a espécie inexistente na página de erro com o status
 * certo.
 */
if (error.value) {
  throw createError({
    statusCode: error.value.statusCode ?? 500,
    statusMessage: error.value.statusMessage ?? 'Não foi possível carregar a espécie',
    fatal: true,
  })
}

const species = computed<SpeciesEntry | null>(() => data.value?.species ?? null)
const rarity = computed(() => (species.value === null ? null : rarityOf(species.value)))
const region = computed(() => data.value?.region ?? null)
const description = computed(() => data.value?.description ?? null)
const chainRoot = computed(() => data.value?.chainRoot ?? null)
const effectiveness = computed(() => data.value?.effectiveness ?? [])

/** A cadeia indexada por id, para o componente achar nome e BST de cada nó. */
const chainKnown = computed(() => new Map((data.value?.chainSpecies ?? []).map(entry => [entry.id, entry])))

/** Altura e peso vêm em decímetros e hectogramas — a unidade da PokeAPI. */
const height = computed(() => (species.value === null ? '' : `${(species.value.height / 10).toFixed(1).replace('.', ',')} m`))
const weight = computed(() => (species.value === null ? '' : `${(species.value.weight / 10).toFixed(1).replace('.', ',')} kg`))

/**
 * Sem `value` de propósito: com chaves explícitas o `UTabs` nasce sem nenhuma
 * aba marcada — os três painéis saem `data-state="inactive"` e a coluna abre
 * vazia. Sem elas ele numera por índice e seleciona a primeira, que é o
 * comportamento que a prancha desenha (*Sobre* aberta).
 */
const tabs = [
  { label: 'Sobre', slot: 'about' as const },
  { label: 'Stats', slot: 'stats' as const },
  { label: 'Evolução', slot: 'evolution' as const },
]

useSeoMeta({
  title: () => (species.value === null ? 'Pokédex — Holo Deck' : `${species.value.displayName} — Pokédex — Holo Deck`),
  description: () => (species.value === null
    ? 'Pokédex do Holo Deck.'
    : `${species.value.displayName}, ${dexNumber(species.value.id)} do dex nacional. Tipos, base stats, linha evolutiva e relações de dano.`),
})
</script>

<template>
  <main
    v-if="species !== null && rarity !== null"
    class="detail"
    :data-type="species.types[0]"
  >
    <!-- COLUNA DA ARTE -->
    <div class="hero">
      <div
        class="hero__glow"
        aria-hidden="true"
      />
      <span
        class="numeric hero__watermark"
        aria-hidden="true"
      >{{ String(species.id).padStart(4, '0') }}</span>

      <nav
        class="hero__crumbs"
        aria-label="Trilha"
      >
        <NuxtLink to="/pokedex">
          Pokédex
        </NuxtLink>
        <span aria-hidden="true">/</span>
        <NuxtLink :to="`/pokedex/${region?.generation ?? 1}`">
          {{ region?.label }}
        </NuxtLink>
        <span aria-hidden="true">/</span>
        <span class="hero__crumbs-current">{{ species.displayName }}</span>
      </nav>

      <div class="hero__art">
        <!--
          Arte oficial remota, 475px, uma por página. O grid usa a miniatura de
          128px commitada; aqui a resolução cheia é o ponto da tela.

          **`<img>` cru, e não `<NuxtImg>`** — divergência consciente do plano,
          e medida. Com o otimizador no caminho, pré-renderizar as 1025 páginas
          vira 1025 downloads de `raw.githubusercontent.com` durante o build:
          testado, e o GitHub derruba a conexão no meio (`ECONNRESET`). Isso
          contraria a regra que este repositório escreveu na Fase 1 — o build
          não bate em terceiro — e trocaria uma dependência de rede em runtime
          por uma em tempo de build, que é pior porque quebra o deploy.

          `eager` porque esta é a maior imagem acima da dobra da página; as
          dimensões evitam o salto de layout enquanto ela chega.
        -->
        <img
          :src="artworkUrl(species.id)"
          :alt="`Arte oficial de ${species.displayName}`"
          width="475"
          height="475"
          loading="eager"
          decoding="async"
        >
      </div>

      <p class="numeric hero__number">
        {{ dexNumber(species.id) }}
      </p>
      <h1 class="hero__name">
        {{ species.displayName }}
      </h1>

      <div class="hero__types">
        <DexTypeBadge
          v-for="type in species.types"
          :key="type"
          :type="type"
        />
      </div>

      <dl class="hero__facts">
        <div>
          <dt>Altura</dt>
          <dd class="numeric">
            {{ height }}
          </dd>
        </div>
        <div>
          <dt>Peso</dt>
          <dd class="numeric">
            {{ weight }}
          </dd>
        </div>
        <div>
          <dt>Raridade</dt>
          <dd
            class="numeric hero__rarity"
            :data-rarity="rarity"
          >
            {{ RARITY_LABELS[rarity].toUpperCase() }}
          </dd>
        </div>
      </dl>
    </div>

    <!-- COLUNA DOS DADOS -->
    <div class="panel">
      <!--
        `unmount-on-hide` desligado: por padrão o `UTabs` só monta o painel
        ativo, e as três abas são pré-renderizadas em 1025 páginas. Com o padrão,
        o HTML servido sai com a descrição e **sem** base stats, relações de dano
        e linha evolutiva — que é o conteúdo pelo qual estas páginas seriam
        encontradas. Também é o que faz o Ctrl+F do navegador achar o que está
        na aba fechada.
      -->
      <UTabs
        :items="tabs"
        :unmount-on-hide="false"
        variant="link"
        class="w-full"
      >
        <template #about>
          <div class="panel__section">
            <h3 class="panel__label">
              Sobre
            </h3>
            <!-- Em inglês, e assumido: a PokeAPI não tem descrição em português.
                 Traduzir de ouvido 1025 textos seria inventar dado. -->
            <p
              v-if="description"
              class="panel__flavor"
              lang="en"
            >
              {{ description }}
            </p>
            <p
              v-else
              class="panel__flavor panel__flavor--missing"
            >
              A PokeAPI não traz descrição para esta espécie.
            </p>

            <dl class="facts">
              <div class="facts__row">
                <dt class="numeric">
                  Habitat
                </dt>
                <dd class="numeric">
                  {{ species.habitat === null ? '—' : species.habitat.replace('-', ' ') }}
                </dd>
              </div>
              <div class="facts__row">
                <dt class="numeric">
                  Taxa de captura
                </dt>
                <dd class="numeric">
                  {{ species.captureRate }}<span class="facts__max">/255</span>
                </dd>
              </div>
              <div class="facts__row">
                <dt class="numeric">
                  Felicidade base
                </dt>
                <dd class="numeric">
                  {{ species.baseHappiness }}
                </dd>
              </div>
            </dl>
            <p class="facts__note">
              Os três vinham da aba <em>Training</em> da Pokédex antiga. Não têm papel no jogo — são referência.
            </p>
          </div>
        </template>

        <template #stats>
          <div class="panel__section panel__section--stacked">
            <DexStatBars
              :base-stats="species.baseStats"
              :type="species.types[0]"
            />
            <DexDamageRelations
              :effectiveness="effectiveness"
              :types="species.types"
            />
          </div>
        </template>

        <template #evolution>
          <div class="panel__section">
            <DexEvolutionChain
              v-if="chainRoot"
              :root="chainRoot"
              :current-id="species.id"
              :known="chainKnown"
              :type="species.types[0]"
            />
            <p
              v-else
              class="panel__flavor panel__flavor--missing"
            >
              Esta espécie não está em nenhuma cadeia de evolução do dex.
            </p>
          </div>
        </template>
      </UTabs>
    </div>
  </main>
</template>

<style scoped>
.detail {
  display: grid;
  gap: 0;
  min-height: 100dvh;
}

@media (min-width: 900px) {
  .detail {
    grid-template-columns: minmax(0, 5fr) minmax(0, 7fr);
  }
}

.hero {
  position: relative;
  overflow: hidden;
  padding: 26px 32px 40px;
  background: linear-gradient(168deg, color-mix(in oklab, var(--type) 10%, var(--surface-sunken)), var(--bg));
  border-bottom: 1px solid var(--border);
}

@media (min-width: 900px) {
  .hero {
    border-bottom: none;
    border-right: 1px solid var(--border);
  }
}

.hero__glow {
  position: absolute;
  left: 50%;
  top: 44%;
  width: 420px;
  height: 420px;
  transform: translate(-50%, -50%);
  pointer-events: none;
  background: radial-gradient(circle, color-mix(in oklab, var(--type) 26%, transparent), transparent 66%);
}

/* O número gigante ao fundo, como a prancha o desenha: identidade, não leitura.
   Fica fora da árvore de acessibilidade — o número real está logo abaixo. */
.hero__watermark {
  position: absolute;
  right: -10px;
  top: -18px;
  font-size: 150px;
  font-weight: 700;
  line-height: 1;
  color: color-mix(in oklab, var(--type) 12%, transparent);
  pointer-events: none;
}

.hero__crumbs {
  position: relative;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  color: var(--text-faint);
}

.hero__crumbs a {
  color: var(--text-muted);
  text-decoration: none;
}

.hero__crumbs a:hover,
.hero__crumbs a:focus-visible {
  color: var(--accent);
}

.hero__crumbs-current {
  color: var(--text-body);
}

.hero__art {
  position: relative;
  display: flex;
  justify-content: center;
  margin: 20px 0 8px;
}

.hero__art :deep(img) {
  width: min(100%, 340px);
  height: auto;
}

.hero__number {
  position: relative;
  font-size: 12px;
  font-weight: 700;
  color: var(--text-muted);
}

.hero__name {
  position: relative;
  margin-top: 4px;
  font-size: 44px;
  font-weight: 700;
  line-height: 1;
  letter-spacing: -0.02em;
  color: var(--text);
}

.hero__types {
  position: relative;
  display: flex;
  gap: 6px;
  margin-top: 14px;
}

.hero__facts {
  position: relative;
  display: flex;
  flex-wrap: wrap;
  gap: 28px;
  margin-top: 26px;
}

.hero__facts dt {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.hero__facts dd {
  margin-top: 5px;
  font-size: 15px;
  font-weight: 700;
  color: var(--text);
}

/* A raridade herda a cor da moldura, como na carta. `--rarity-label` existe
   porque a de `common` não sustenta texto. */
.hero__rarity {
  color: var(--rarity-label);
}

.panel {
  padding: 26px 32px 48px;
}

.panel__section {
  padding-top: 22px;
}

.panel__section--stacked {
  display: flex;
  flex-direction: column;
  gap: 34px;
}

.panel__label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.panel__flavor {
  margin-top: 10px;
  max-width: 62ch;
  font-size: 15px;
  line-height: 1.55;
  color: var(--text-body);
}

.panel__flavor--missing {
  color: var(--text-muted);
}

.facts {
  margin-top: 26px;
  border-top: 1px solid var(--border);
}

.facts__row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
  padding: 11px 0;
  border-bottom: 1px solid var(--border);
}

.facts__row dt {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.facts__row dd {
  font-size: 13px;
  font-weight: 700;
  color: var(--text);
  text-transform: uppercase;
}

.facts__max {
  color: var(--text-faint);
}

.facts__note {
  margin-top: 12px;
  font-size: 11px;
  line-height: 1.5;
  color: var(--text-faint);
}
</style>
