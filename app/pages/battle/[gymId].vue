<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue'
import type { BattleAction, BattleContext, BattlePokemon } from '~~/shared/game/battle'
import { activeOf, benchIndexes, isFainted } from '~~/shared/game/battle'
import { switchOptions } from '~~/shared/game/engine'
import { gymLeader } from '~~/shared/game/gyms'
import { effectiveSpeed } from '~~/shared/game/status'
import { effectivenessAgainst, multiplierLabel } from '~~/shared/game/typechart'
import { gameNumber } from '~~/shared/game/progress'
import { battleSpriteUrl } from '~~/shared/dex/artwork'
import { GYM_COUNT, isGymId } from '~~/shared/types/brand'
import { AILMENT_LABELS, REGION_LABELS, TYPE_LABELS } from '~~/shared/types/game'
import { DECK_SIZE } from '~~/shared/game/deck'
import { useBattleStore } from '~~/app/stores/battle'
import { useDeckStore } from '~~/app/stores/deck'
import { useProgressStore } from '~~/app/stores/progress'
import { loadBattleContext } from '~/composables/useBattleContext'
import type { NarratedTurn } from '~~/app/utils/battle-narration'
import { narrate } from '~~/app/utils/battle-narration'

/**
 * A batalha — a prancha *Batalha*.
 *
 * **Cliente inteiro, e sem `useAsyncData`.** As outras telas usam o payload de
 * SSR porque parte do que elas mostram é o dex, que o servidor conhece; aqui
 * tudo depende do deck e do log salvo, que moram no `localStorage`. Pré-render
 * produziria um campo de batalha vazio para depois trocá-lo na hidratação, e a
 * chave reativa do `useAsyncData` seria maquinaria para carregar nada. O que a
 * rota entrega pré-renderizada é a casca.
 *
 * A tela não decide regra nenhuma: o motor é da Fase 4 e a economia é de
 * `economy.ts`. O que ela faz é escolher a ação, narrar o que voltou e desenhar.
 */
const route = useRoute()
const battle = useBattleStore()
const deck = useDeckStore()
const progress = useProgressStore()

const gym = computed(() => {
  const id = Number(route.params.gymId)
  return isGymId(id) ? id : null
})

const leader = computed(() => (gym.value === null ? null : gymLeader(gym.value)))

useHead({
  title: () => (leader.value === null ? 'Batalha' : `Ginásio ${gym.value} · ${leader.value.name}`),
  // O sprite animado vem do repositório de sprites da PokeAPI, e só esta rota o
  // usa — o `preconnect` mora aqui pelo mesmo motivo que o da arte oficial mora
  // na página de detalhe: nas outras rotas seria um DNS+TLS que ninguém gasta.
  link: [{ rel: 'preconnect', href: 'https://raw.githubusercontent.com', crossorigin: '' }],
})

/**
 * Por que a tela não está lutando, quando não está.
 *
 * Estado explícito em vez de um encadeado de `v-if` sobre `context === null`:
 * são quatro razões diferentes com quatro saídas diferentes, e um nulo só diria
 * "não deu".
 */
type Standing = 'loading' | 'ready' | 'unknown-gym' | 'locked' | 'no-deck' | 'busy' | 'failed'

const standing = ref<Standing>('loading')
const context = shallowRef<BattleContext | null>(null)
const history = ref<readonly NarratedTurn[]>([])
const focused = ref(0)

/** Seis linhas, como a prancha: o registro é o que acabou de acontecer, não o
 * histórico da luta — para isso existe o log de ações, que é o save. */
const LOG_LINES = 6

onMounted(async () => {
  const id = gym.value
  if (id === null) {
    standing.value = 'unknown-gym'
    return
  }

  // A trava do desbloqueio sequencial mora na store e é cobrada **aqui**, e não
  // só no botão da Liga: isto é uma URL, e digitar `/battle/9` no primeiro
  // minuto de jogo é o caminho mais curto para pular a campanha inteira.
  if (!progress.isUnlocked(id)) {
    standing.value = 'locked'
    return
  }

  const saved = battle.log
  const resuming = saved !== null && saved.gymId === id
  const team = resuming ? saved.team : deck.team

  /**
   * **Uma batalha em andamento em outro ginásio não é sobrescrita em silêncio.**
   *
   * Chegar aqui com um log de outro ginásio é o caminho normal — a Liga oferece
   * revanche em toda carta vencida, e o Hub oferece retomar. Começar por cima
   * apagaria o turno 12 de alguém sem uma linha na tela, que é exatamente o que
   * o `resuming` acima evita para o mesmo ginásio e deixava passar para o
   * vizinho. A escolha é do jogador, e ela precisa existir.
   */
  if (!resuming && saved !== null) {
    standing.value = 'busy'
    return
  }

  if (!resuming && !deck.ready) {
    standing.value = 'no-deck'
    return
  }

  try {
    context.value = await loadBattleContext(id, team)
  }
  catch {
    standing.value = 'failed'
    return
  }

  // Retomar primeiro: um log daquele ginásio é uma luta que o jogador deixou no
  // meio, e começar outra por cima apagaria o turno 4 dele sem avisar.
  if (resuming && battle.resume(context.value) !== null) {
    standing.value = 'ready'
    return
  }

  battle.start(id, deck.team, newSeed(), context.value)
  standing.value = 'ready'
})

/**
 * A semente da batalha — a única coisa que este jogo sorteia fora do gerador.
 *
 * Ela não é uma rolagem: é o número do qual todas as rolagens saem, e é por isso
 * que `Math.random` aqui não contradiz a pureza de `shared/`. Uma vez sorteada,
 * ela vai para o log e a luta inteira passa a ser reprodutível a partir dela.
 */
function newSeed(): number {
  return Math.floor(Math.random() * 2 ** 32)
}

/** A batalha aberta em outro ginásio, quando é ela que está no caminho. */
const busyWith = computed(() => {
  const saved = battle.log
  if (saved === null || !isGymId(saved.gymId)) return null
  return { gym: saved.gymId, leader: gymLeader(saved.gymId), turns: saved.actions.length + 1 }
})

/**
 * Descarta a batalha aberta e começa esta. É o único caminho que apaga uma luta
 * sem que ela tenha terminado, e ele passa por um clique com o nome do ginásio
 * escrito ao lado.
 */
async function dropAndStart(): Promise<void> {
  const id = gym.value
  if (id === null || !deck.ready) return

  battle.discard()
  standing.value = 'loading'

  try {
    context.value = await loadBattleContext(id, deck.team)
  }
  catch {
    standing.value = 'failed'
    return
  }

  battle.start(id, deck.team, newSeed(), context.value)
  history.value = []
  standing.value = 'ready'
}

const state = computed(() => battle.state)
const player = computed(() => (state.value === null ? null : activeOf(state.value.player)))
const opponent = computed(() => (state.value === null ? null : activeOf(state.value.opponent)))
const finished = computed(() => state.value !== null && state.value.outcome !== 'ongoing')

/** Os quatro golpes, já cruzados com o ativo inimigo. */
const moves = computed(() => {
  const mine = player.value
  const foe = opponent.value
  const matrix = context.value?.matrix
  if (mine === null || foe === null || matrix === undefined) return []

  return mine.slots.map((slot, index) => {
    const multiplier = effectivenessAgainst(matrix, slot.move.type, foe.types)
    return { index, move: slot.move, pp: slot.pp, multiplier, note: noteFor(slot, foe, multiplier) }
  })
})

/**
 * O aviso que substitui o multiplicador, quando há um.
 *
 * Os dois casos são os que a prancha desenha: o golpe que não afeta (`×0`) e o
 * de status contra alvo que já carrega condição — o `JÁ PARALISADO`, que sai do
 * rótulo da condição em vez de uma frase escrita por golpe.
 */
function noteFor(
  slot: { readonly move: { readonly damageClass: string }, readonly pp: number },
  foe: BattlePokemon,
  multiplier: number,
): string | null {
  if (multiplier === 0) return '×0 NÃO AFETA'
  if (slot.move.damageClass === 'status' && foe.condition !== null) {
    return `JÁ ${AFFECTED[foe.condition.kind]}`
  }
  return null
}

const AFFECTED = {
  paralysis: 'PARALISADO',
  burn: 'QUEIMADO',
  poison: 'ENVENENADO',
  sleep: 'DORMINDO',
} as const

/**
 * A leitura grande do centro: o golpe em foco contra quem está do outro lado.
 *
 * **Duas formas, e não uma com um número às vezes sem sentido.** Efetividade
 * multiplica dano; um golpe de status não causa nenhum, e estampar `×2` sobre
 * Thunder Wave seria um número verdadeiro sobre uma conta que não acontece — no
 * lugar exato onde a tela ensina a escolher. Do golpe de status sobra a
 * imunidade de tipo, que o motor cobra também para condição, e é ela que o `×0`
 * continua narrando.
 */
const reading = computed(() => {
  const foe = opponent.value
  const matrix = context.value?.matrix
  const chosen = moves.value[focused.value] ?? moves.value[0]
  if (foe === undefined || foe === null || matrix === undefined || chosen === undefined) return null

  // A conta aberta, tipo a tipo — é a linha de baixo da prancha, e é ela que
  // ensina de onde o número saiu, inclusive quando ele é zero.
  const detail = foe.types
    .map(type => `${TYPE_LABELS[chosen.move.type]} → ${TYPE_LABELS[type]} `
      + multiplierLabel(effectivenessAgainst(matrix, chosen.move.type, [type])))
    .join(' · ')

  const move = chosen.move
  if (move.damageClass === 'status' && chosen.multiplier !== 0) {
    return {
      kind: 'status' as const,
      multiplier: 1,
      title: AILMENT_LABELS[move.ailment.kind].toUpperCase(),
      label: 'GOLPE DE STATUS',
      detail,
    }
  }

  return {
    kind: 'damage' as const,
    multiplier: chosen.multiplier,
    title: multiplierLabel(chosen.multiplier),
    label: EFFECTIVENESS_LABELS[chosen.multiplier] ?? 'NEUTRO',
    detail,
  }
})

const EFFECTIVENESS_LABELS: Record<number, string> = {
  0: 'NÃO AFETA',
  0.25: 'MAL ARRANHA',
  0.5: 'POUCO EFETIVO',
  1: 'NEUTRO',
  2: 'SUPER EFETIVO',
  4: 'DEVASTADOR',
}

/** Quem age primeiro, com o número à vista — o texto do cabeçalho da prancha. */
const initiative = computed(() => {
  const mine = player.value
  const foe = opponent.value
  if (mine === null || foe === null) return null

  const meu = effectiveSpeed(mine.stats, mine.condition)
  const dele = effectiveSpeed(foe.stats, foe.condition)
  if (meu === dele) return `empate de Speed (${meu}) — o desempate é sorteado`
  return meu > dele
    ? `você ataca primeiro (SPD ${meu} > ${dele})`
    : `${foe.displayName} ataca primeiro (SPD ${dele} > ${meu})`
})

const bench = computed(() => (state.value === null ? [] : state.value.player.team))
const standingBench = computed(() => (state.value === null ? [] : benchIndexes(state.value.player)))
const canSwitch = computed(() => state.value !== null && switchOptions(state.value).length > 0)
const potions = computed(() => state.value?.player.potionsLeft ?? 0)

/**
 * Uma ação, e a narração do que ela produziu.
 *
 * A narração recebe o estado **de antes** porque é dele que saem os índices de
 * quem agiu — ver `battle-narration`. Depois do turno, quem caiu já foi
 * substituído.
 */
function play(action: BattleAction): void {
  const before = state.value
  const ctx = context.value
  if (before === null || ctx === null || before.outcome !== 'ongoing') return

  battle.act(action, ctx)

  const turn = narrate(before, battle.events, ctx.moves)
  if (turn.lines.length > 0) history.value = [...history.value, turn].slice(-LOG_LINES)
  focused.value = 0
}

function choose(index: number): void {
  const chosen = moves.value[index]
  if (chosen === undefined || chosen.pp <= 0) return
  play({ kind: 'move', slot: index })
}

function swap(index: number): void {
  if (state.value === null || index === state.value.player.active) return
  const target = bench.value[index]
  if (target === undefined || isFainted(target)) return
  play({ kind: 'switch', index })
}

function drink(): void {
  if (potions.value <= 0) return
  play({ kind: 'item' })
}

/**
 * Se a vitória que acabou de sair foi revanche — **lido do prêmio, não do
 * progresso**.
 *
 * `progress.hasBadge` já é `true` neste ponto mesmo numa estreia: a insígnia foi
 * dada no mesmo passo que pagou. Perguntar a ela aqui escreveria "Revanche" em
 * toda vitória, inclusive na primeira. O prêmio, ao contrário, guarda a conta
 * inteira: `earned < base` só acontece quando a taxa de revanche foi aplicada.
 */
const rematched = computed(() =>
  battle.reward !== null && battle.reward.earned < battle.reward.base)

/** Recomeçar do zero no mesmo ginásio — o `revanche imediata` do plano. */
function again(): void {
  const id = gym.value
  const ctx = context.value
  if (id === null || ctx === null || !deck.ready) return

  battle.start(id, deck.team, newSeed(), ctx)
  history.value = []
  focused.value = 0
}

/** Recuo do sprite animado: nem todas as 1025 espécies existem no conjunto. */
function fallbackSprite(event: Event, id: number): void {
  const image = event.target
  if (image instanceof HTMLImageElement) image.src = `/sprites/${id}.webp`
}
</script>

<template>
  <div class="battle">
    <ClientOnly>
      <template v-if="standing === 'ready' && state && player && opponent && leader">
        <header class="battle__bar">
          <div class="battle__who">
            <span class="numeric battle__gym">Ginásio {{ gym }} / {{ GYM_COUNT }}</span>
            <span class="battle__leader">{{ leader.name }}</span>
            <span class="numeric battle__region">
              {{ REGION_LABELS[leader.region] }} · {{ TYPE_LABELS[leader.type] }}
            </span>
          </div>
          <div class="numeric battle__meta">
            <span>TURNO <b>{{ String(state.turn).padStart(2, '0') }}</b></span>
            <span>Lv50 fixo</span>
          </div>
        </header>

        <section class="battle__field">
          <div class="battle__slot battle__slot--foe">
            <BattleCombatant :pokemon="opponent" />
          </div>

          <img
            class="battle__sprite battle__sprite--foe"
            :src="battleSpriteUrl(opponent.speciesId)"
            :alt="opponent.displayName"
            @error="fallbackSprite($event, opponent.speciesId)"
          >

          <div
            v-if="reading"
            class="battle__reading"
          >
            <p
              class="numeric battle__mult"
              :class="{
                'battle__mult--strong': reading.multiplier > 1,
                'battle__mult--weak': reading.multiplier < 1,
                'battle__mult--word': reading.kind === 'status',
              }"
            >
              {{ reading.title }}
            </p>
            <p class="numeric battle__mult-label">
              {{ reading.label }}
            </p>
            <p class="numeric battle__mult-detail">
              {{ reading.detail }}
            </p>
          </div>

          <img
            class="battle__sprite battle__sprite--own"
            :src="battleSpriteUrl(player.speciesId)"
            :alt="player.displayName"
            @error="fallbackSprite($event, player.speciesId)"
          >

          <div class="battle__slot battle__slot--own">
            <BattleCombatant
              :pokemon="player"
              own
            />
          </div>
        </section>

        <section class="battle__actions">
          <!-- Fim de luta: o resultado ocupa o lugar da escolha, porque não há
               mais o que escolher. Derrota não cobra nada — revanche imediata. -->
          <div
            v-if="finished"
            class="battle__result"
          >
            <p class="battle__eyebrow">
              {{ state.outcome === 'won' ? 'Ginásio vencido' : 'Seu time caiu' }}
            </p>
            <h2 class="battle__outcome">
              {{ state.outcome === 'won' ? 'Vitória' : 'Derrota' }}
            </h2>

            <dl
              v-if="battle.reward"
              class="numeric battle__prize"
            >
              <div>
                <dt>{{ rematched ? 'Revanche' : 'Recompensa' }}</dt>
                <dd>+{{ gameNumber(battle.reward.earned) }}</dd>
              </div>
              <div v-if="battle.reward.flawless > 0">
                <dt>Imaculada</dt>
                <dd>+{{ gameNumber(battle.reward.flawless) }}</dd>
              </div>
              <div class="battle__prize-total">
                <dt>Saldo</dt>
                <dd>{{ gameNumber(progress.coins) }}</dd>
              </div>
            </dl>
            <p
              v-else
              class="battle__note"
            >
              Nada foi perdido — nem carta, nem moeda. A revanche é imediata.
            </p>

            <div class="battle__buttons">
              <button
                type="button"
                class="battle__button battle__button--primary bevel-control"
                @click="again"
              >
                {{ state.outcome === 'won' ? 'LUTAR DE NOVO' : 'TENTAR DE NOVO' }}
              </button>
              <NuxtLink
                to="/league"
                class="battle__button bevel-control"
              >
                VOLTAR À LIGA
              </NuxtLink>
            </div>
          </div>

          <!-- Troca forçada: o ativo caiu e o turno não anda até alguém entrar. -->
          <div
            v-else-if="state.expecting === 'playerSwitch'"
            class="battle__forced"
          >
            <p class="battle__eyebrow">
              {{ player.displayName }} desmaiou
            </p>
            <h2 class="battle__outcome">
              Quem entra?
            </h2>
            <p class="battle__note">
              Escolha no banco, à direita. O turno não anda até lá.
            </p>
          </div>

          <div
            v-else
            class="battle__choose"
          >
            <header class="battle__choose-head">
              <p class="battle__eyebrow">
                Escolha o golpe
                <span
                  v-if="initiative"
                  class="battle__initiative"
                >— {{ initiative }}</span>
              </p>

              <!--
                A prancha desenha `TROCAR` e `ITEM` como dois chips aqui. A troca
                virou o próprio banco, que já está na tela ao lado: um botão
                `TROCAR` abriria um segundo painel para escolher entre cartas que
                estão visíveis a 30 cm dele.
              -->
              <button
                type="button"
                class="numeric battle__item"
                :disabled="potions <= 0"
                @click="drink"
              >
                POÇÃO {{ potions }}
              </button>
            </header>

            <div class="battle__moves">
              <BattleMoveCard
                v-for="option in moves"
                :key="option.index"
                :move="option.move"
                :pp="option.pp"
                :multiplier="option.multiplier"
                :note="option.note"
                :focused="focused === option.index"
                @focus="focused = option.index"
                @choose="choose(option.index)"
              />
            </div>
          </div>

          <aside class="battle__side">
            <p class="battle__eyebrow">
              Registro do turno
            </p>
            <ol class="numeric battle__log">
              <li
                v-for="entry in history"
                :key="entry.turn"
              >
                <span class="battle__log-turn">T{{ entry.turn }}</span>
                <span>{{ entry.lines.join(' ') }}</span>
              </li>
              <li
                v-if="history.length === 0"
                class="battle__log-empty"
              >
                A luta começa agora.
              </li>
            </ol>

            <div class="battle__bench-wrap">
              <p class="battle__eyebrow">
                Seu banco
                <span class="battle__initiative">— {{ standingBench.length + 1 }} de pé</span>
              </p>
              <div class="battle__bench">
                <button
                  v-for="(card, index) in bench"
                  :key="card.speciesId"
                  type="button"
                  class="battle__pill"
                  :class="{
                    'battle__pill--active': index === state.player.active,
                    'battle__pill--out': isFainted(card),
                  }"
                  :data-type="card.types[0]"
                  :disabled="isFainted(card) || index === state.player.active || !canSwitch"
                  :aria-label="`Trocar para ${card.displayName}`"
                  @click="swap(index)"
                >
                  <img
                    :src="`/sprites/${card.speciesId}.webp`"
                    :alt="card.displayName"
                    width="128"
                    height="128"
                    loading="lazy"
                  >
                  <span
                    v-if="isFainted(card)"
                    class="numeric battle__ko"
                  >KO</span>
                </button>
              </div>
            </div>
          </aside>
        </section>
      </template>

      <!-- As quatro saídas que não são uma batalha. Cada uma leva a algum lugar:
           uma tela de erro sem porta é um beco. -->
      <div
        v-else
        class="battle__standing"
      >
        <p
          v-if="standing === 'loading'"
          class="battle__note"
        >
          Montando o campo…
        </p>
        <template v-else-if="standing === 'locked'">
          <h1 class="battle__outcome">
            Ginásio fechado
          </h1>
          <p class="battle__note">
            Cada líder só abre com a insígnia anterior. O seu próximo é o
            {{ progress.nextGym }}.
          </p>
          <NuxtLink
            to="/league"
            class="battle__button battle__button--primary bevel-control"
          >
            IR PARA A LIGA
          </NuxtLink>
        </template>
        <template v-else-if="standing === 'busy' && busyWith">
          <h1 class="battle__outcome">
            Você já está lutando
          </h1>
          <p class="battle__note">
            Ginásio {{ busyWith.gym }} · {{ busyWith.leader.name }}, no turno
            {{ busyWith.turns }}. Começar esta luta apaga aquela.
          </p>
          <div class="battle__buttons">
            <NuxtLink
              :to="`/battle/${busyWith.gym}`"
              class="battle__button battle__button--primary bevel-control"
            >
              RETOMAR AQUELA
            </NuxtLink>
            <button
              type="button"
              class="battle__button bevel-control"
              :disabled="!deck.ready"
              @click="dropAndStart"
            >
              DESISTIR E COMEÇAR ESTA
            </button>
          </div>
        </template>
        <template v-else-if="standing === 'no-deck'">
          <h1 class="battle__outcome">
            Sem time
          </h1>
          <p class="battle__note">
            A batalha precisa dos {{ DECK_SIZE }} slots preenchidos.
          </p>
          <NuxtLink
            to="/deck"
            class="battle__button battle__button--primary bevel-control"
          >
            MONTAR O DECK
          </NuxtLink>
        </template>
        <template v-else>
          <h1 class="battle__outcome">
            {{ standing === 'unknown-gym' ? 'Ginásio inexistente' : 'O dex não carregou' }}
          </h1>
          <p class="battle__note">
            {{ standing === 'unknown-gym'
              ? `A Liga tem ${GYM_COUNT} ginásios.`
              : 'Sem o dex não há como montar o time do líder. Tente de novo.' }}
          </p>
          <NuxtLink
            to="/league"
            class="battle__button battle__button--primary bevel-control"
          >
            VOLTAR À LIGA
          </NuxtLink>
        </template>
      </div>
    </ClientOnly>
  </div>
</template>

<style scoped>
.battle {
  display: flex;
  flex-direction: column;
  min-height: 100dvh;
  background: var(--bg);
}

.battle__bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-shrink: 0;
  height: 56px;
  padding: 0 32px;
  border-bottom: 1px solid var(--border);
}

.battle__who {
  display: flex;
  align-items: center;
  gap: 14px;
}

.battle__gym {
  padding: 5px 10px;
  border-radius: var(--radius);
  border: 1px solid var(--border-strong);
  background: var(--surface);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--accent);
}

.battle__leader {
  font-size: 15px;
  font-weight: 700;
  color: var(--text);
}

.battle__region {
  font-size: 12px;
  text-transform: uppercase;
  color: var(--text-muted);
}

.battle__meta {
  display: flex;
  gap: 20px;
  font-size: 12px;
  color: var(--text-muted);
}

.battle__meta b {
  font-weight: 700;
  color: var(--text);
}

/**
 * O campo — grade de duas linhas, e não posicionamento absoluto.
 *
 * A prancha põe cada peça em `position:absolute` sobre 1440×430, o que reproduz
 * o desenho numa largura só. A grade dá o mesmo arranjo em diagonal (adversário
 * em cima à esquerda com o sprite à direita, jogador espelhado embaixo) e
 * continua de pé quando a coluna encolhe.
 */
.battle__field {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  align-items: center;
  gap: 12px 24px;
  flex-grow: 1;
  min-height: 400px;
  padding: 26px 32px;
  overflow: hidden;
}

.battle__slot--foe {
  grid-column: 1;
  grid-row: 1;
}

.battle__sprite--foe {
  grid-column: 2;
  grid-row: 1;
  justify-self: center;
}

.battle__sprite--own {
  grid-column: 1;
  grid-row: 2;
  justify-self: center;
}

.battle__slot--own {
  grid-column: 2;
  grid-row: 2;
  justify-self: end;
}

.battle__sprite {
  width: 176px;
  max-width: 100%;
  height: auto;
  image-rendering: pixelated;
  filter: drop-shadow(0 16px 22px color-mix(in oklab, var(--bg) 80%, transparent));
}

.battle__sprite--own {
  width: 148px;
}

/* A leitura grande fica no meio do campo, entre as duas diagonais. */
.battle__reading {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  text-align: center;
  pointer-events: none;
}

.battle__mult {
  font-size: 44px;
  font-weight: 700;
  line-height: 1;
  color: var(--text-muted);
}

/* `PARALISIA` no lugar de `×2` são nove caracteres onde cabiam dois: a palavra
   entra num corpo que a leitura do meio comporta, e não no número. */
.battle__mult--word {
  font-size: 24px;
  letter-spacing: 0.06em;
}

.battle__mult--strong {
  color: var(--hp);
  text-shadow: 0 0 30px color-mix(in oklab, var(--hp) 65%, transparent);
}

.battle__mult--weak {
  color: var(--deficit);
  text-shadow: 0 0 30px color-mix(in oklab, var(--deficit) 65%, transparent);
}

.battle__mult-label {
  margin-top: 8px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.22em;
  color: inherit;
}

.battle__reading .battle__mult-label {
  color: var(--text-body);
}

.battle__mult-detail {
  margin-top: 9px;
  font-size: 11px;
  color: var(--text-muted);
}

.battle__actions {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 420px;
  flex-shrink: 0;
  border-top: 1px solid var(--border);
}

.battle__choose,
.battle__result,
.battle__forced {
  padding: 22px 32px 26px;
}

.battle__choose-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 15px;
}

.battle__eyebrow {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.battle__initiative {
  font-size: 12px;
  font-weight: 400;
  letter-spacing: 0;
  text-transform: none;
  color: var(--text-body);
}

.battle__item {
  padding: 5px 11px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--surface);
  font-size: 11px;
  color: var(--text-body);
  cursor: pointer;
}

.battle__item:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.battle__item:not(:disabled):hover,
.battle__item:focus-visible {
  border-color: var(--accent);
  color: var(--text);
}

.battle__moves {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 11px;
}

.battle__outcome {
  margin: 8px 0 12px;
  font-size: 30px;
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1;
  color: var(--text);
}

.battle__note {
  max-width: 46ch;
  font-size: 13px;
  line-height: 1.55;
  color: var(--text-body);
}

.battle__prize {
  display: flex;
  flex-wrap: wrap;
  gap: 22px;
  margin-bottom: 18px;
  font-size: 12px;
}

.battle__prize dt {
  color: var(--text-muted);
}

.battle__prize dd {
  margin: 4px 0 0;
  font-size: 20px;
  font-weight: 700;
  color: var(--coin);
}

.battle__prize-total dd {
  color: var(--text);
}

.battle__buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 18px;
}

.battle__button {
  padding: 11px 24px;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-decoration: none;
  color: var(--text-body);
  background: var(--surface-raised);
  border: 1px solid var(--border-strong);
  cursor: pointer;
}

.battle__button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.battle__button--primary {
  color: var(--bg);
  background: var(--accent);
  border-color: var(--accent);
}

.battle__button:hover,
.battle__button:focus-visible {
  color: var(--text);
  border-color: var(--accent);
}

.battle__button--primary:hover,
.battle__button--primary:focus-visible {
  color: var(--bg);
  background: color-mix(in oklab, var(--accent) 82%, var(--text));
}

.battle__side {
  padding: 22px 26px 26px;
  border-left: 1px solid var(--border);
  background: var(--surface-sunken);
}

.battle__log {
  display: flex;
  flex-direction: column;
  gap: 9px;
  margin: 13px 0 20px;
  min-height: 120px;
  font-size: 12px;
  line-height: 1.45;
  color: var(--text-muted);
}

.battle__log li {
  display: flex;
  gap: 8px;
}

.battle__log-turn {
  flex-shrink: 0;
  color: var(--text-faint);
}

.battle__log-empty {
  color: var(--text-faint);
}

.battle__bench-wrap {
  padding-top: 18px;
  border-top: 1px solid var(--border);
}

.battle__bench {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  margin-top: 12px;
}

.battle__pill {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 52px;
  height: 52px;
  padding: 0;
  border-radius: var(--radius);
  background: var(--surface-raised);
  border: 1px solid var(--border);
  cursor: pointer;
}

.battle__pill img {
  max-width: 40px;
  max-height: 40px;
}

.battle__pill:not(:disabled):hover,
.battle__pill:focus-visible {
  border-color: var(--accent);
}

.battle__pill:disabled {
  cursor: default;
}

.battle__pill--active {
  border-color: var(--type);
  box-shadow: 0 0 18px -6px var(--type);
}

.battle__pill--out {
  border-color: var(--deficit);
}

.battle__pill--out img {
  filter: grayscale(1);
  opacity: 0.26;
}

.battle__ko {
  position: absolute;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: var(--deficit);
}

.battle__standing {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 12px;
  padding: 64px 32px;
}

@media (max-width: 1100px) {
  .battle__actions {
    grid-template-columns: minmax(0, 1fr);
  }

  .battle__side {
    border-left: 0;
    border-top: 1px solid var(--border);
  }

  .battle__field {
    grid-template-columns: minmax(0, 1fr);
    padding: 20px;
  }

  .battle__slot--foe,
  .battle__slot--own,
  .battle__sprite--foe,
  .battle__sprite--own {
    grid-column: 1;
    grid-row: auto;
    justify-self: center;
  }

  .battle__slot--own {
    justify-self: center;
  }

  .battle__reading {
    position: static;
    transform: none;
  }
}
</style>
