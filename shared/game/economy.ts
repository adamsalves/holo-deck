import type { GymId } from '../types/brand.ts'

/**
 * A economia do jogo — moedas, recompensa de ginásio, pack diário, loja.
 *
 * **Ele nasceu quase vazio de propósito**, com a razão escrita: nada aqui pode
 * ser calibrado antes de existir batalha que pague. A Liga é essa batalha, e
 * três das cinco linhas que faltavam entram agora — recompensa por ginásio,
 * revanche e vitória imaculada.
 *
 * **As outras duas chegaram com a loja**, no PR seguinte, e não antes: pack
 * diário e o preço de 150 só ganharam consumidor lá, e uma constante de economia
 * sem quem a leia é exatamente o que este docblock recusa desde a Fase 5. Com
 * elas o módulo fecha, e é ele inteiro que `/rules` lê na seção *Economia*.
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
 *
 * As duas parcelas têm nome porque `/rules` **escreve a fórmula**, e não a
 * faixa: a prancha estampa `200 + 100×n`, e a página só pode reproduzir isso sem
 * digitar número se os dois vierem daqui. Com eles nomeados, mexer na curva
 * reescreve a página no mesmo commit — que é o contrato dela.
 */
export const GYM_REWARD_BASE = 200
export const GYM_REWARD_STEP = 100

export function gymReward(gym: GymId): number {
  return GYM_REWARD_BASE + GYM_REWARD_STEP * gym
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

/**
 * O preço do pack na loja, e o número que fecha a economia.
 *
 * 150 é o que o plano fixa e o que a prancha *Loja* estampa no botão. Ele existe
 * para ser dividido pelos outros: os 6.300 da campanha compram **42 packs**, e é
 * essa razão — não o preço isolado — que faz a Liga inteira valer alguma coisa.
 *
 * Ele chega **agora**, e não no PR da Liga, pela regra que o docblock do módulo
 * escreve: constante de economia sem quem a leia é constante que ninguém pode
 * calibrar. A loja é quem paga.
 */
export const PACK_PRICE = 150

/**
 * Quantos packs o saldo compra. A prancha escreve `dá para 8` ao lado do preço.
 *
 * Existe como função para a tela não repetir a divisão: o cartão da loja mostra
 * o que sobra **e** quantos cabem, e duas contas escritas em dois lugares é como
 * elas passam a discordar quando o preço mudar.
 */
export function packsAffordable(coins: number): number {
  return Math.floor(coins / PACK_PRICE)
}

/**
 * Quanto falta para comprar um pack — zero quando dá.
 *
 * Déficit e não booleano, pela mesma razão que `dustMissing`: o botão
 * desabilitado escreve `FALTAM 60 MOEDAS`, e um `canBuy` obrigaria a tela a
 * refazer a subtração para dizer isso.
 */
export function coinsMissing(coins: number): number {
  return Math.max(0, PACK_PRICE - coins)
}

/**
 * O pack diário — grátis, um por dia, e o "dia" é o de calendário do aparelho.
 *
 * **Decidido em 05/09 contra a espera de 24 horas.** As duas leituras cabem no
 * `próximo em 14:22:07` que a prancha desenha, e a diferença aparece no segundo
 * dia: uma espera de 24h a partir da abertura empurra o horário para frente toda
 * vez — quem abre às 20h só pode às 20h do dia seguinte, e às 20h10 no outro, e
 * a janela vai driftando até cair na madrugada. Dia de calendário devolve o pack
 * à meia-noite, que é o que "um por dia" quer dizer.
 *
 * O relógio é o do aparelho, e isso é deliberado: o save é do jogador e o
 * servidor confia nele por decisão escrita do plano — quem adiantar o relógio
 * ganha um pack, que é o mesmo que já se ganha editando o save no DevTools.
 */

/**
 * O dia de um instante, em `AAAA-MM-DD` **local**.
 *
 * `toISOString` não serve: ele converte para UTC antes de formatar, e para
 * qualquer fuso a oeste de Greenwich — o do jogador — as horas finais do dia
 * pertenceriam ao dia seguinte. Um pack aberto às 22h de terça marcaria
 * quarta-feira e sumiria o dia inteiro.
 *
 * Recebe o instante em vez de o ler: `shared/` é a camada pura, e o portão de
 * `shared-purity.spec.ts` recusa `new Date(` e `Date.now(` aqui dentro.
 */
export function dayKey(at: Date): string {
  const month = String(at.getMonth() + 1).padStart(2, '0')
  const day = String(at.getDate()).padStart(2, '0')
  return `${at.getFullYear()}-${month}-${day}`
}

/** A forma que o save aceita — o guarda de `progress.dailyClaimed` chama esta. */
export function isDayKey(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

/**
 * O pack diário está de pé.
 *
 * Compara chaves de dia em vez de instantes, então um relógio que ande para trás
 * **devolve** o pack em vez de travar a loja para sempre — que é o que uma
 * subtração de timestamps faria com quem viaja de fuso ou corrige a data.
 */
export function isDailyReady(claimed: string | null, today: string): boolean {
  return claimed !== today
}

/**
 * Quanto falta para a meia-noite local, em milissegundos — o `próximo em
 * 14:22:07` da prancha.
 *
 * Sai das componentes do relógio local, e não de uma subtração entre duas datas,
 * pelo mesmo motivo de `dayKey`: construir a meia-noite seguinte exigiria `new
 * Date`, que este módulo não pode chamar.
 *
 * Nos dois dias do ano em que um fuso muda de horário de verão o dia local tem
 * 23 ou 25 horas e esta conta erra por uma. É contador de tela, e quem decide se
 * o pack está de pé é `isDailyReady`, que compara datas e não sabe de horas.
 */
export function msUntilNextDay(at: Date): number {
  const elapsed = at.getHours() * 3_600_000
    + at.getMinutes() * 60_000
    + at.getSeconds() * 1_000
    + at.getMilliseconds()

  return 86_400_000 - elapsed
}
