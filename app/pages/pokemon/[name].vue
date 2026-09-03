<script setup lang="ts">
import type { SpeciesEntry } from '~~/shared/types/dex'
import { computed } from 'vue'
import { flattenChain } from '~~/shared/game/evolution'
import { rarityOf } from '~~/shared/game/rarity'
import { HABITAT_LABELS, RARITY_LABELS } from '~~/shared/types/game'
import { artworkUrl } from '~~/shared/dex/artwork'
import { dexNumber, toRegions } from '~~/shared/dex/regions'
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
 * vazia. Sem elas ele numera por índice e seleciona a primeira, que é *Sobre*.
 *
 * **Abrir em *Sobre* é decisão, e a prancha foi corrigida para ela.** A versão
 * aprovada do canvas marcava *Stats* na barra e, abaixo, desenhava os quatro
 * blocos ao mesmo tempo — as duas coisas juntas descrevem uma coluna sem abas,
 * não abas com uma delas ativa. A varredura de 02/09 levantou a contradição e o
 * usuário escolheu manter as abas de verdade abrindo em *Sobre*: é a leitura
 * que a página herda da carta, onde o primeiro que se lê é a descrição. A
 * prancha passou a desenhar só o conteúdo dela.
 */
const tabs = [
  { label: 'Sobre', slot: 'about' as const },
  { label: 'Stats', slot: 'stats' as const },
  { label: 'Evolução', slot: 'evolution' as const },
]

/**
 * O `preconnect` da arte oficial mora aqui, e não no `app.head`.
 *
 * `raw.githubusercontent.com` é o único host de terceiro do projeto e só esta
 * página o usa. No head global, `/`, `/pokedex` e as nove regiões pagavam um
 * DNS+TLS que nunca gastam. O handshake continua começando antes de o HTML
 * terminar de chegar — que era a razão de ele existir.
 */
useHead({
  link: [
    { rel: 'preconnect', href: 'https://raw.githubusercontent.com', crossorigin: '' },
  ],
})

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

      <div class="hero__nav">
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

        <!-- A busca também aqui, e não só nas duas telas de grid: estas são 1025
             das 1036 páginas do site, e é para cá que a própria busca leva. Sem
             ela, o único jeito de sair era voltar pela trilha — e o `Cmd/Ctrl+K`
             que o resto da Pokédex promete não respondia justamente onde o
             jogador passa a maior parte do tempo. -->
        <DexSearch />
      </div>

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
          <!--
            Duas colunas, como a prancha desenha: a descrição à esquerda e os
            três números de referência à direita. O app empilhava os dois, e a
            diferença não era decisão de ninguém — só não tinha sido reproduzida.
          -->
          <div class="panel__section about">
            <div class="about__flavor">
              <h2 class="panel__label">
                Sobre
              </h2>
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
            </div>

            <div class="about__facts">
              <dl class="facts">
                <!-- O habitat é o único dos três que é nome e não número, e a
                     prancha o distingue com cor. A cor que ela usa é o verde de
                     planta — hue sem papel no sistema, e um componente não cita
                     primitivo. `--accent` é o semântico que existe para "este
                     valor se destaca", e é o mesmo azul que a trilha e o foco já
                     usam nesta página. A troca está na seção de divergências do
                     README, com o valor exato.

                     E por `HABITAT_LABELS`, não pelo `rough-terrain` da PokeAPI
                     com o hífen trocado por espaço: `--accent` faz dele o valor
                     mais destacado do painel, e um documento `lang="pt-BR"` não
                     destaca ROUGH TERRAIN. É o mesmo argumento que trocou os
                     chips de tipo de FLYING para VOADOR. -->
                <div class="facts__row">
                  <dt class="numeric">
                    Habitat
                  </dt>
                  <dd class="numeric facts__habitat">
                    {{ species.habitat === null ? '—' : HABITAT_LABELS[species.habitat] }}
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

  /* A coluna é o contêiner de medida da marca-d'água abaixo. Sem isto ela não
     tem largura a que se referir: a página não tem `max-width`, então a coluna
     é 5/12 do viewport acima de 900px e 100% abaixo — dois valores que só uma
     query de contêiner alcança sem repetir o corte em `vw`. */
  container-type: inline-size;
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

/**
 * O número gigante ao fundo — identidade, não leitura. Fica fora da árvore de
 * acessibilidade: o número real está logo abaixo.
 *
 * **Reposicionado para o que a prancha desenha.** Ela põe `0006` a 230px na
 * margem esquerda da coluna (`left:-30px`), atravessando a arte, em branco a
 * 2,8%. O código o tinha à direita, no topo, a 150px e na cor do tipo a 12% — do
 * outro lado da coluna, num terço do tamanho e visível demais para o papel que
 * a anotação lhe dá.
 *
 * Os 46cqw são a conta que reproduz a proporção. Quatro dígitos de mono ocupam
 * ~2,4em, menos o que o `letter-spacing` negativo tira; a prancha põe 230px numa
 * coluna de 560, e 230/560 é 41%. O número aqui é 46 e não 41 porque `cqw` mede
 * a **caixa de conteúdo** do contêiner, não a borda: a coluna tem 64px de
 * padding lateral, e 41% da largura cheia é 46% do que sobra. O teto de 230px
 * engata quando a coluna chega a 564px — a prancha desenha 560, onde a conta dá
 * 228px.
 *
 * **O `left` tem teto pelo mesmo motivo que o corpo tem.** A prancha especifica
 * `-30px` contra 230px de tipo: é uma relação entre a sangria e o **corpo**, não
 * entre a sangria e a coluna. Com `-5%` puro o corpo trava em 230px e a sangria
 * continua crescendo com a coluna, que é 5/12 do viewport numa página sem
 * `max-width` — a 1920 já são -40px, e o primeiro dígito perde 31% de si; num
 * ultrawide passa da metade, e aí não lê como sangria, lê como glifo quebrado.
 * O `max()` deixa a sangria acompanhar a coluna enquanto o corpo acompanha, e
 * para junto com ele. (`max` e não `min` porque os dois valores são negativos:
 * o maior é o menos fundo.)
 *
 * O branco a 3% vem de `--text`, e não de um `rgba` cru: é o papel que o sistema
 * tem para "quase branco", e o portão de token não admite hex aqui. A prancha
 * usa 2,8% — a diferença está na tabela de divergências do README.
 */
.hero__watermark {
  position: absolute;
  left: max(-30px, -5%);
  top: 20%;
  font-size: min(46cqw, 230px);
  font-weight: 700;
  line-height: 1;
  letter-spacing: -0.04em;
  color: color-mix(in oklab, var(--text) 3%, transparent);
  pointer-events: none;
}

.hero__nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
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

/* O peso continua 700 e não 800: o canvas usa 800 em rótulo, mas `@nuxt/fonts`
   só baixa 400 e 700 da JetBrains Mono, e um 800 pedido sem face real vira
   negrito sintético. A decisão é do `nuxt.config.ts`, e vale para toda a
   interface. */
.hero__facts dd {
  margin-top: 5px;
  font-size: 15px;
  font-weight: 700;
  color: var(--text);
}

/**
 * Os 20px da prancha, mas só onde a coluna os sustenta.
 *
 * Os três fatos são uma fileira com `flex-wrap`, e a prancha é de 1440 — onde a
 * coluna tem 536px de conteúdo e eles cabem numa linha. Entre 900 e ~1080 a
 * página já está em duas colunas e a coluna cai para 310–375px: a 20px o bloco
 * dobra de altura (131px contra 44px, medido em `/pokemon/eternatus`), com
 * RARIDADE / LENDÁRIO caindo para a segunda linha. Não quebra nada — o `wrap`
 * degrada bem —, mas é a escala da prancha aplicada numa largura que não é a
 * dela.
 *
 * A query é de contêiner e não de viewport porque é a coluna que decide, e a
 * mesma coluna tem larguras diferentes nos dois lados de 900px: abaixo ela é o
 * viewport inteiro, e num telefone de 500px os 20px cabem folgados. O
 * `container-type` já está no `.hero` para a marca-d'água.
 *
 * Os 420px são de **caixa de conteúdo**, que é o que a query mede — os mesmos
 * 64px de padding que a conta da marca-d'água desconta. Em duas colunas isso
 * engata perto de 1160px de viewport; em uma, perto de 484px. Medido: 15px em
 * 900/1000/1080 e 20px em 500 e 1440.
 */
@container (min-width: 420px) {
  .hero__facts dd {
    font-size: 20px;
  }
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

/**
 * O painel *Sobre*, em duas colunas — a divisão que a prancha desenha e que a
 * implementação não tinha reproduzido.
 *
 * O corte é em 1180px, e não nos 900px em que a página vira duas colunas: ali o
 * painel tem ~525px, e dividi-lo de novo deixaria a descrição em ~315px. Em 1180
 * ela fica com 354px, que já é estreito — é o piso, não um corte confortável. A
 * prancha é de 1440, onde o painel tem 776px de conteúdo, e é essa largura que a
 * divisão realmente pede.
 *
 * O `gap` é o único espaçamento entre as duas partes, nas duas formas — o
 * `margin-top: 26px` que o `.facts` tinha saiu junto. Somados davam 60px no
 * empilhado, onde a estrutura plana anterior tinha 26.
 */
.about {
  display: grid;
  gap: 34px;
}

@media (min-width: 1180px) {
  .about {
    grid-template-columns: 1.5fr 1fr;
  }
}

/* O fio de acento da prancha. `--type` vem do `data-type` do `<main>`, então
   ele muda com a espécie — é a mesma cor que o brilho do herói usa.

   Fora do `--missing`: o fio marca a fala da espécie, e o aviso de que a
   PokeAPI não traz descrição não é fala dela — é o app explicando uma ausência.
   Hoje o ramo é inalcançável (nenhuma das 1025 está sem descrição), e é
   justamente por isso que ele precisa dizer a coisa certa se um dia for
   alcançado. */
.about__flavor .panel__flavor:not(.panel__flavor--missing) {
  border-left: 2px solid var(--type);
  padding-left: 16px;
}

/* Sem `margin-top`: o `gap` do `.about` é o único espaçamento entre a descrição
   e a lista, nas duas formas. Um `margin` aqui somaria com ele no empilhado. */
.facts {
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

/* `.facts__row dd` é (0,1,1) e venceria uma `.facts__habitat` solta, que é
   (0,1,0) — daí o seletor composto, que é (0,2,1) e ganha por especificidade.
   Não é empate resolvido pela ordem: mover esta regra para cima do bloco não
   mudaria nada. */
.facts__row dd.facts__habitat {
  color: var(--accent);
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
