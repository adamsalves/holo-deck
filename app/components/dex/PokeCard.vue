<script setup lang="ts">
import type { TypeName } from '~~/shared/types/dex'
import type { Rarity } from '~~/shared/types/game'
import { computed, useTemplateRef } from 'vue'
import { hasFoil, RARITY_LABELS } from '~~/shared/types/game'
import { useFoil } from '~/composables/useFoil'

/**
 * A carta — a superfície que carrega a assinatura do sistema.
 *
 * Ela não sabe carregar imagem: a arte entra pelo slot. É a costura entre esta
 * fase e a Fase 3, que decide entre miniatura de 128px no grid e arte oficial
 * remota no detalhe; a moldura é a mesma nos dois.
 *
 * `interactive` é o que separa o herói das 1025 do grid. Falso — o padrão —
 * significa nenhum listener: o foil fica no repouso, que é exatamente o gradiente
 * estático que o canvas desenha nas cartas do grid.
 */
const props = withDefaults(defineProps<{
  dexNumber: number
  name: string
  types: readonly [TypeName] | readonly [TypeName, TypeName]
  rarity: Rarity
  interactive?: boolean
}>(), { interactive: false })

/**
 * O foil mede a **moldura**, não a carta.
 *
 * `getBoundingClientRect()` devolve a caixa já transformada, e é o `<article>`
 * que recebe a inclinação. Medir ele seria realimentar a leitura com a própria
 * saída — e com a transição de 120ms no meio, a origem do cônico passaria a
 * depender do estado da animação, não só de onde o ponteiro está. A moldura não
 * gira, então o retângulo é estável. Os eventos de ponteiro chegam nela do mesmo
 * jeito: `pointerenter`/`pointerleave` disparam no ancestral, `pointermove` sobe.
 */
const frame = useTemplateRef<HTMLElement>('frame')
const { variables } = useFoil(frame, { enabled: () => props.interactive })

const showsFoil = computed(() => hasFoil(props.rarity))

/**
 * O segundo tipo, quando existe.
 *
 * `length === 2` é o que estreita a união de tuplas — sem ele, `types[1]` é
 * índice fora da faixa no ramo de um tipo só.
 */
const secondaryType = computed(() => (props.types.length === 2 ? props.types[1] : null))

/**
 * `padStart(4, '0')` — o dex vai a 1025, então quatro casas.
 *
 * O app antigo tinha um filtro que produzia `10` e `001` na mesma listagem, e o
 * plano nomeia essa correção. Ela cabe aqui porque é aqui que o número aparece.
 */
const dexLabel = computed(() => `#${String(props.dexNumber).padStart(4, '0')}`)
</script>

<template>
  <div
    ref="frame"
    class="poke-card-frame"
  >
    <article
      class="poke-card bevel-tile"
      :class="{ 'poke-card--dual': secondaryType !== null }"
      :data-rarity="rarity"
      :data-type="types[0]"
      :style="variables"
    >
      <!-- Cada brilho publica o próprio `--type` pelo `data-type`: a variável de
           escopo aninha, então duas cores não custam nenhum token novo nem
           nenhuma das 18 regras repetidas.

           O segundo brilho é divergência consciente: o canvas não o desenha.
           Sem ele `types[1]` chega à carta e não tem efeito nenhum, e a
           alternativa seria um token para a cor composta — que é exatamente o
           que o escopo aninhado existe para não precisar. -->
      <div
        class="poke-card__glow"
        :data-type="types[0]"
        aria-hidden="true"
      />
      <div
        v-if="secondaryType"
        class="poke-card__glow poke-card__glow--second"
        :data-type="secondaryType"
        aria-hidden="true"
      />

      <span class="poke-card__number numeric">{{ dexLabel }}</span>

      <div class="poke-card__art">
        <slot name="art" />
      </div>

      <div class="poke-card__id">
        <!-- `h2` e não `h3`: no grid da região o único ancestral é o `h1` do
             cabeçalho, e pular um nível faz o leitor de tela anunciar uma
             subseção que não existe. -->
        <h2 class="poke-card__name">
          {{ name }}
        </h2>
        <!-- A raridade nunca é comunicada só por brilho: a etiqueta textual está
             sempre presente, inclusive com reduced-motion ligado. É regra do canvas.
             Em português, porque o documento é `lang="pt-BR"` e quem lê a carta —
             inclusive o leitor de tela — lê a frase inteira no mesmo idioma.

             O slot existe porque a prancha *Pokédex* põe os chips de tipo neste
             lugar em vez da etiqueta: num grid, o que se varre é o tipo. Quem
             troca o rodapé fica devendo a raridade em texto, e é por isso que
             `PokeCard` sozinho não resolve — o grid dá o nome acessível ao link
             que envolve a carta, com número, tipos e raridade na mesma frase. -->
        <slot name="footer">
          <span class="poke-card__rarity numeric">{{ RARITY_LABELS[rarity] }}</span>
        </slot>
      </div>

      <div
        v-if="showsFoil"
        class="poke-card__foil"
        aria-hidden="true"
      />
    </article>
  </div>
</template>

<style scoped>
/* A moldura existe para ser medida: ela não gira, então o retângulo que o foil
   lê não depende da inclinação que ele mesmo produziu. */
.poke-card-frame {
  position: relative;
  display: block;
}

.poke-card {
  position: relative;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-sizing: border-box;
  aspect-ratio: 5 / 7;
  padding: 9px 0 11px;

  /* `--card-surface` é o gradiente do tema, já tingido pela cor do tipo — o
     `data-type` deste mesmo elemento é quem o resolve. */
  background: var(--card-surface);
  border: 1px solid var(--rarity);
  color: var(--text);

  /* A inclinação vem do foil e é zero em repouso. O `perspective()` também é o
     que faz da carta um contexto de empilhamento, e é dele que o
     `mix-blend-mode` do foil depende para misturar com a carta e não com a
     página. `transition` some sob reduced-motion, abaixo. */
  transform: perspective(700px)
    rotateX(var(--foil-tilt-x, 0deg))
    rotateY(var(--foil-tilt-y, 0deg));
  transition: transform 120ms var(--ease-out);
}

/* O brilho do tipo, atrás da arte. Deriva de `--type` com `color-mix`, que é o
   que evita 18 regras — uma por tipo. */
.poke-card__glow {
  position: absolute;
  left: 50%;
  top: 38%;
  width: 76%;
  aspect-ratio: 1;
  transform: translate(-50%, -50%);
  pointer-events: none;
  background: radial-gradient(
    circle,
    color-mix(in oklab, var(--type) 24%, transparent),
    transparent 66%
  );
}

/* Espécie de dois tipos: os brilhos se afastam para o segundo não sumir sob o
   primeiro, e encolhem para a soma não estourar a carta. */
.poke-card--dual .poke-card__glow {
  left: 34%;
  width: 62%;
}

.poke-card--dual .poke-card__glow--second {
  left: 66%;
}

.poke-card__number {
  position: relative;
  align-self: flex-start;
  padding: 0 9px;
  font-size: 9px;
  /* `--text-muted`, e não `--text-faint`: a 9px isto é texto pequeno, e
     `--text-faint` é papel de texto grande — sobre o topo da carta ele dá
     2.84:1. O portão de tema cobra o par (papel × superfície); esta linha é o
     lado do componente da mesma regra. */
  color: var(--text-muted);
}

.poke-card__art {
  position: relative;
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  min-height: 0;
  padding: 0 9px;
}

.poke-card__art :deep(img) {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.poke-card__id {
  position: relative;
  padding: 0 9px;
}

.poke-card__name {
  font-size: 12px;
  font-weight: 700;
  line-height: 1;
}

.poke-card__rarity {
  display: block;
  margin-top: 4px;
  font-size: 9px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--rarity-label);
}

/* Mítico é o único que não cabe numa cor: o rótulo recebe a varredura linear,
   recortada no texto. O `conic` do foil embaralharia num texto curto. */
.poke-card[data-rarity="mythic"] .poke-card__rarity {
  background-image: var(--rarity-text);
  background-clip: text;
  color: transparent;
}

.poke-card__foil {
  position: absolute;
  inset: 0;
  pointer-events: none;
  mix-blend-mode: color-dodge;
  opacity: var(--foil-strength);
  background: var(--foil);
}

/**
 * O reforço no CSS, e não substituto do desligamento no composable.
 *
 * `useFoil` já não liga listener nenhum sob `prefers-reduced-motion`, então as
 * variáveis ficam paradas no repouso. Isto aqui cobre o resto: a transição da
 * inclinação, que existiria mesmo sem rastreio se alguma outra coisa mexesse nas
 * variáveis. O foil continua visível como gradiente estático — a raridade não
 * pode sumir por preferência de movimento.
 */
@media (prefers-reduced-motion: reduce) {
  .poke-card {
    transition: none;
  }
}
</style>
