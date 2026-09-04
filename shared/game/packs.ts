import type { SpeciesId } from '../types/brand.ts'
import type { IndexData } from '../types/dex.ts'
import type { PackCard, Rarity } from '../types/game.ts'
import type { RngCursor, RngState } from './rng.ts'
import { createRng } from './rng.ts'
import { rarityFrom } from './rarity.ts'

/**
 * O pack — dez cartas, um slot que importa, e um contador que impede a má sorte
 * de durar para sempre.
 *
 * Tudo aqui é função pura sobre `{ seed, pity, pool }`, como todo `shared/game/`:
 * a mesma seed abre o mesmo pack, e é isso que torna a distribuição afirmável
 * por teste em vez de observável por sorte. O teste estatístico deste módulo
 * abre 100 mil packs e cobra as taxas e o pity contra os números abaixo.
 *
 * O que este módulo **não** faz: creditar coleção, debitar moeda, contar pack
 * diário. Ele sorteia e devolve; quem grava é a store, e a ordem de escrita lá
 * favorece o jogador (credita carta antes de debitar moeda). Separar as duas
 * coisas é o que deixa 100 mil aberturas rodarem sem tocar em Pinia.
 */

/** As dez cartas, e como elas se dividem. A soma é conferida em teste. */
export const PACK_SIZE = 10
export const COMMON_SLOTS = 6
export const UNCOMMON_SLOTS = 3
export const RARE_PLUS_SLOTS = 1

/**
 * O slot que carrega o pack, e os pesos que decidem o tier dele.
 *
 * Somam 1 exatamente, e o teste cobra isso: um peso alterado sem os outros
 * cederem espaço é o jeito silencioso de a distribuição deixar de fechar.
 *
 * A escada é íngreme de propósito — 0,5% de mítico dá **um mítico a cada 200
 * packs**, o que é a raridade que faz Mew valer a tela que a prancha *Coleção*
 * dá a ele. Mais generoso que isso e a forja a 1.600 pó, que existe justamente
 * para a cauda longa fechar, viraria enfeite.
 */
export const RARE_PLUS_WEIGHTS: Readonly<Record<'rare' | 'ultra' | 'legendary' | 'mythic', number>> = {
  rare: 0.8,
  ultra: 0.15,
  legendary: 0.045,
  mythic: 0.005,
}

/**
 * O que o pity considera "sorte boa": ultra ou acima.
 *
 * O corte é em ultra e não em raro porque **todo pack traz um raro+** — um pity
 * medido em raro nunca dispararia, e seria contador escrito para nada.
 */
export const PITY_TIERS = ['ultra', 'legendary', 'mythic'] as const satisfies readonly Rarity[]

/**
 * Dez packs seguidos sem ultra+ e o próximo vem garantido.
 *
 * O número saiu de conta, não de gosto. A chance de um pack não trazer ultra+ é
 * 1 − (0,15 + 0,045 + 0,005) = **0,80**, então uma sequência de N packs secos
 * tem chance 0,8^N:
 *
 * | N | chance de a rede pegar |
 * |---|---|
 * | 10 | 0,8¹⁰ = 10,7% — **1 jogador em 9** |
 * | 20 | 0,8²⁰ = 1,15% — 1 em 87 |
 *
 * A 20 o pity seria rede que quase ninguém encosta, e uma proteção que não se
 * sente é uma proteção que não existe. A 10 ela pega um jogador em nove, que é
 * frequente o bastante para ser percebida como generosidade e rara o bastante
 * para não achatar a curva.
 */
export const PITY_THRESHOLD = 10

/**
 * Shiny: 1 em 256, por carta e não por pack.
 *
 * Dá 1 − (255/256)¹⁰ = **3,84% por pack**, ou um shiny a cada ~26 packs. A 1/128
 * seria um a cada 13 e o efeito se gastaria rápido; os jogos reais usam 1/4096,
 * que num jogo de coleção sem encontros seria raro demais para alguém ver.
 *
 * Rola sobre **qualquer** carta, inclusive comum: shiny é tratamento, não tier.
 * Um shiny preso a raro+ transformaria a raridade mais visível do jogo num
 * segundo eixo da mesma escada, em vez de um eixo próprio.
 */
export const SHINY_ODDS = 1 / 256

/** Os ids de cada tier, prontos para sortear. Ver `buildPool`. */
export type RarityPool = Readonly<Record<Rarity, readonly SpeciesId[]>>

export interface PackInput {
  readonly seed: RngState
  /** Packs consecutivos sem ultra+, **antes** deste. */
  readonly pity: number
  readonly pool: RarityPool
}

export interface PackResult {
  readonly cards: readonly PackCard[]
  /** O contador **depois** deste pack: zerado se veio ultra+, senão +1. */
  readonly pity: number
  /** Se o slot raro+ deste pack foi forçado pela rede. A tela avisa. */
  readonly forcedByPity: boolean
}

/**
 * Agrupa as 1025 por tier, uma vez, a partir do índice.
 *
 * O índice traz os insumos e `rarityFrom` decide — a raridade continua sendo
 * calculada, não lida de um campo gravado, que é o que impede os limiares de
 * viverem em dois lugares. Ver o docblock de `RarityInputs`.
 *
 * A ordem de cada balde é a do dex nacional, porque é a ordem em que o índice
 * chega. Isso importa: `pick` sorteia por posição, então uma ordem instável
 * faria a mesma seed abrir packs diferentes entre dois carregamentos.
 */
export function buildPool(index: IndexData): RarityPool {
  const buckets: Record<Rarity, SpeciesId[]> = {
    common: [], uncommon: [], rare: [], ultra: [], legendary: [], mythic: [],
  }

  for (const entry of index) buckets[rarityFrom(entry)].push(entry.id)

  return buckets
}

/**
 * O tier do slot raro+, dados os pesos — ou o ultra+ que o pity obriga.
 *
 * Quando a rede dispara, os pesos **de ultra para cima** são renormalizados
 * entre si em vez de o slot virar ultra seco: um pity que sempre entregasse o
 * degrau mais baixo do ultra+ tornaria lendário e mítico impossíveis justamente
 * para o jogador mais azarado, que é o oposto do que a rede existe para fazer.
 */
function rollRarePlus(roll: number, forced: boolean): Rarity {
  const tiers = forced
    ? (['ultra', 'legendary', 'mythic'] as const)
    : (['rare', 'ultra', 'legendary', 'mythic'] as const)

  const total = tiers.reduce((sum, tier) => sum + RARE_PLUS_WEIGHTS[tier], 0)

  let cursor = roll * total
  for (const tier of tiers) {
    cursor -= RARE_PLUS_WEIGHTS[tier]
    // `<` e não `<=`: com `roll` em [0, 1) o cursor nunca zera no último tier
    // por arredondamento, e o `?? último` abaixo cobre o resto de ponto
    // flutuante sem esconder um erro de peso.
    if (cursor < 0) return tier
  }

  return tiers[tiers.length - 1] ?? 'ultra'
}

/**
 * Abre um pack.
 *
 * **Sem repetir espécie dentro do mesmo pack.** Sortear com reposição é mais
 * simples e distorce quase nada — seis comuns tiradas de ~500 colidem em ~3% das
 * aberturas —, mas uma carta que aparece duas vezes na mesma tira de dez lê como
 * defeito, não como sorte. A rejeição custa uma releitura rara e não muda as
 * taxas por tier, que é o que o teste estatístico afirma.
 *
 * O teto de tentativas existe para um balde menor que o número de slots (um dex
 * parcial em teste, uma geração nova ainda sem lendários): sem ele a rejeição
 * seria laço infinito. Estourado o teto, a carta repetida entra — pack com
 * duplicata é pior que pack bonito, e travar é pior que os dois.
 */
export function openPack({ seed, pity, pool }: PackInput): PackResult {
  const rng = createRng(seed)
  const forced = pity >= PITY_THRESHOLD
  const drawn = new Set<SpeciesId>()

  const draw = (tier: Rarity): SpeciesId | null => {
    const bucket = pool[tier]
    const [first] = bucket
    if (first === undefined) return null

    for (let attempt = 0; attempt < PACK_SIZE; attempt += 1) {
      const id = bucket[rng.int(0, bucket.length - 1)] ?? first
      if (!drawn.has(id)) {
        drawn.add(id)
        return id
      }
    }

    return bucket[rng.int(0, bucket.length - 1)] ?? first
  }

  const cards: PackCard[] = []

  const push = (tier: Rarity): void => {
    const speciesId = draw(tier)
    // Um balde vazio não é erro de runtime: é dex parcial. A carta some, o pack
    // sai menor, e o teste de composição é quem reprova o dex que o produziu.
    if (speciesId === null) return
    cards.push({ speciesId, rarity: tier, isShiny: rng.chance(SHINY_ODDS) })
  }

  for (let slot = 0; slot < COMMON_SLOTS; slot += 1) push('common')
  for (let slot = 0; slot < UNCOMMON_SLOTS; slot += 1) push('uncommon')
  for (let slot = 0; slot < RARE_PLUS_SLOTS; slot += 1) push(rollRarePlus(rng.next(), forced))

  const hit = cards.some(card => isPityTier(card.rarity))

  return { cards: shuffle(cards, rng), pity: hit ? 0 : pity + 1, forcedByPity: forced }
}

/**
 * Embaralha a ordem em que as dez são reveladas — Fisher-Yates, sobre o mesmo
 * cursor de RNG.
 *
 * **A ordem sai da prancha, não do gosto.** A tira de *Abertura de pack* mostra
 * `4 / 10 reveladas` com o Gyarados RARO na **quarta** posição, entre comuns. Os
 * slots são sorteados em blocos — seis comuns, três incomuns, um raro+ — e
 * revelar nessa ordem poria o raro+ sempre por último, o que dá ao jogador um
 * tell perfeito: as nove primeiras cartas deixam de ter qualquer suspense
 * porque ele já sabe que nenhuma delas pode ser a boa.
 *
 * Embaralhar não toca em taxa nenhuma: a composição continua 6/3/1, e todo teste
 * de distribuição conta por tier, que é invariante à ordem.
 */
function shuffle<T>(items: readonly T[], rng: RngCursor): readonly T[] {
  const result = [...items]

  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = rng.int(0, index)
    const held = result[index]
    const other = result[swap]
    // Por contrato os dois índices estão dentro da lista; a leitura é guardada
    // porque `noUncheckedIndexedAccess` a tipa como possivelmente ausente, e as
    // alternativas seriam um `!` ou um `as` — os dois proibidos pelo lint.
    if (held === undefined || other === undefined) continue
    result[index] = other
    result[swap] = held
  }

  return result
}

/**
 * Quantos packs faltam para a rede disparar. A prancha *Abertura* estampa este
 * contador no cabeçalho, e a *Loja* o repete ao lado do preço.
 */
export function packsUntilPity(pity: number): number {
  return Math.max(0, PITY_THRESHOLD - pity)
}

/**
 * Ultra ou acima — a pergunta que o pity faz e que a animação também faz.
 *
 * `some` com comparação explícita, e não `includes`: o `includes` de uma tupla
 * `as const` só aceita os próprios literais como argumento, e um `Rarity` solto
 * não compila. Mesmo motivo que `isRarity` e `isTypeName`.
 */
export function isPityTier(rarity: Rarity): boolean {
  return PITY_TIERS.some(tier => tier === rarity)
}

/**
 * A chance de um pack **não** trazer ultra+, derivada dos pesos em vez de
 * escrita à mão.
 *
 * É o número de onde saiu `PITY_THRESHOLD`, e tê-lo como função é o que permite
 * o teste refazer a conta do docblock acima: mexer num peso muda esta taxa, e o
 * portão que compara 0,8^10 com a frequência medida acusa na hora.
 */
export function dryPackOdds(): number {
  return 1 - PITY_TIERS.reduce((sum, tier) => sum + RARE_PLUS_WEIGHTS[tier], 0)
}
