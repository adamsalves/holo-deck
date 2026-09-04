import type { GymId } from '../types/brand.ts'

/**
 * A economia do jogo — moedas, recompensa de ginásio, pack diário, loja.
 *
 * **Ele nasceu quase vazio de propósito**, com a razão escrita: nada aqui pode
 * ser calibrado antes de existir batalha que pague. A Liga é essa batalha, e
 * três das cinco linhas que faltavam entram agora — recompensa por ginásio,
 * revanche e vitória imaculada.
 *
 * **As outras duas continuam de fora**, e isso corrige a tabela do contrato da
 * Fase 6, que punha o módulo "completo" neste PR. Pack diário e o preço de 150
 * só ganham consumidor com a loja, no PR seguinte, e uma constante de economia
 * sem quem a leia é exatamente o que este docblock recusa desde a Fase 5.
 *
 * Ele mora neste arquivo, e não em `packs.ts` ou em `gyms.ts`, porque `/rules`
 * vai procurá-lo onde o plano diz que ele está — e porque economia espalhada
 * pelos módulos que a gastam é como duas telas passam a discordar do preço.
 */

/**
 * Três packs na primeira execução, uma vez só.
 *
 * **O jogo tem um ciclo fechado na partida.** Um jogador novo tem zero cartas;
 * precisa de 6 para montar deck, de deck para enfrentar o Ginásio 1, de ginásio
 * para ter moedas, e de moedas para comprar pack. Sem uma concessão inicial
 * nenhuma dessas portas abre, e a primeira tela do jogo seria uma coleção vazia
 * pedindo moedas que não há como ganhar.
 *
 * Três, e não um: 30 cartas é o mínimo para o deck de 6 da Fase 6 ter **escolha
 * real** em vez de ser o que sobrou. E fazem o primeiro minuto do jogo ser o
 * `PackOpener`, que é o momento mais forte que o jogo tem.
 *
 * A prancha *Abertura de pack* já desenha isto: o cabeçalho dela estampa
 * `BOAS-VINDAS · 1 DE 3`.
 */
export const WELCOME_PACKS = 3

/**
 * A recompensa da primeira vitória num ginásio: `200 + 100 × ginásio`.
 *
 * 300 no primeiro, 1.100 no nono, **6.300 na campanha** — 42 packs aos 150 da
 * loja. A prancha *Liga* estampa `+400` no ginásio 2 e é essa conta.
 *
 * Cresce com o ginásio porque o time do líder cresce junto: a faixa A leva 3
 * Pokémon sob teto de 480 de BST e a C leva 6 sob 600. Uma recompensa fixa
 * pagaria o nono ginásio pelo preço do primeiro.
 */
export function gymReward(gym: GymId): number {
  return 200 + 100 * gym
}

/**
 * A revanche paga 25%, e ela existe porque sem ela a economia bate num muro.
 *
 * Os 6.300 da campanha acabam, e depois do nono ginásio a renda cairia para 1
 * pack por dia **para sempre** — completar as 1025 é projeto de centenas de
 * packs, então a campanha viraria uma fração pequena que some. A 25% a revanche
 * mantém a economia viva sem tornar a primeira vitória irrelevante.
 */
export const REMATCH_RATE = 0.25

/**
 * Vitória imaculada — vencer sem perder nenhum Pokémon — paga 25% a mais.
 *
 * **O número não existia**: o plano escreveu "bônus" e nenhuma prancha o
 * desenha. Decidido em 04/09 na mesma taxa da revanche, e a igualdade é
 * deliberada: `/rules` explica uma fração só, e o jogador lê "um quarto" as duas
 * vezes que a economia usa uma fração.
 *
 * Em cima do que está sendo pago, e não do valor cheio: numa revanche imaculada
 * o bônus acompanha a revanche em vez de a inflar de volta ao preço da estreia.
 * Campanha imaculada: 7.875 contra os 6.300 normais — 52 packs contra 42.
 *
 * **O bônus é por não perder ninguém, e não por não trocar.** O deck builder
 * ensina cobertura, a IA da faixa C troca, e a batalha gira em torno de matchup:
 * premiar quem não troca desincentivaria a mecânica que três telas ensinam.
 */
export const FLAWLESS_RATE = 0.25

/** O que uma vitória pagou, aberto — a tela mostra as parcelas, não só o total. */
export interface BattleReward {
  /** A recompensa cheia do ginásio, antes de qualquer taxa. */
  readonly base: number
  /** O que a vitória vale: `base`, ou 25% dele numa revanche. */
  readonly earned: number
  /** O acréscimo por não ter perdido ninguém. Zero quando alguém caiu. */
  readonly flawless: number
  readonly total: number
}

export interface VictoryTerms {
  readonly gym: GymId
  /** O ginásio já tinha insígnia — vitória repetida, não estreia. */
  readonly rematch: boolean
  /** Nenhum dos seis desmaiou. */
  readonly flawless: boolean
}

/**
 * O que uma vitória paga, com as parcelas separadas.
 *
 * `Math.floor` nas duas taxas, e sempre para baixo: 25% de 300 dá 75 redondos,
 * mas 25% de 75 dá 18,75 — e moeda fracionária é a coisa que uma economia de
 * jogo não pode ter, porque ela vaza para o saldo, para o preço do pack e para o
 * texto da tela ao mesmo tempo.
 */
export function rewardFor({ gym, rematch, flawless }: VictoryTerms): BattleReward {
  const base = gymReward(gym)
  const earned = rematch ? Math.floor(base * REMATCH_RATE) : base
  const bonus = flawless ? Math.floor(earned * FLAWLESS_RATE) : 0

  return { base, earned, flawless: bonus, total: earned + bonus }
}
