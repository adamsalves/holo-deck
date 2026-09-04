import type { SpeciesId } from '../types/brand.ts'
import { isSpeciesId } from '../types/brand.ts'
import type { CoreData, TypeName } from '../types/dex.ts'
import { effectivenessAgainst } from './typechart.ts'

/**
 * O deck — seis slots, e a leitura de cobertura que a tela desenha em cima deles.
 *
 * Headless como o resto de `shared/game/`: nenhuma função daqui sabe que existe
 * store, componente ou save. É o que permite a regra ser testada sem montar nada
 * e é o que `/rules` vai ler quando chegar.
 */

/**
 * Seis, e é o número do plano — não configuração.
 *
 * Ele é o que faz os três packs de boas-vindas terem sentido: 30 cartas dão
 * escolha real para preencher seis slots, e um deck maior transformaria a
 * concessão inicial em "use o que veio".
 */
export const DECK_SIZE = 6

/**
 * Os seis slots, na ordem em que entram em campo.
 *
 * **`null` é um slot vazio, e ele precisa ser representável.** A regra do plano
 * é que moer uma carta que está no deck ativo *esvazia o slot* em vez de ser
 * bloqueada — mais gentil que um erro, e o deck builder já sinaliza slot vazio.
 * Uma lista compacta de ids perderia a posição, e o jogador veria as cartas
 * seguintes andarem sozinhas para preencher o buraco.
 *
 * A ordem importa porque é ela que decide quem entra primeiro na batalha, e é
 * ela que o `BattleLog.team` grava.
 */
export type DeckSlots = readonly (SpeciesId | null)[]

/** Seis slots vazios — o deck de quem nunca montou um. */
export function emptyDeck(): DeckSlots {
  return Array.from({ length: DECK_SIZE }, () => null)
}

/**
 * O guarda de leitura, e é ele quem torna o estado ilegal irrepresentável.
 *
 * O tipo diz "lista de id ou nulo" e não consegue dizer "exatamente seis, sem
 * repetir" — uma tupla de seis diria o primeiro e nenhum tipo diz o segundo. As
 * duas regras são cobradas aqui, que é a fronteira por onde o deck entra:
 * `JSON.parse` do save, hoje, e o corpo de um `PUT` na Fase 7.
 *
 * **Sem repetir** é regra de jogo, não higiene: dois exemplares da mesma espécie
 * no mesmo time trocam a decisão de cobertura por "leve dois do que é bom", que é
 * exatamente o eixo que o deck builder existe para ensinar.
 */
export function isDeckSlots(value: unknown): value is DeckSlots {
  if (!Array.isArray(value) || value.length !== DECK_SIZE) return false

  const seen = new Set<number>()
  for (const slot of value) {
    if (slot === null) continue
    if (typeof slot !== 'number' || !isSpeciesId(slot)) return false
    if (seen.has(slot)) return false
    seen.add(slot)
  }

  return true
}

/** Quantos slots têm carta. O `5 / 6 slots` do cabeçalho da prancha. */
export function filledCount(deck: DeckSlots): number {
  return deck.filter(slot => slot !== null).length
}

/** Os ids do deck, sem os vazios — o que vai para a batalha. */
export function deckTeam(deck: DeckSlots): readonly SpeciesId[] {
  return deck.filter((slot): slot is SpeciesId => slot !== null)
}

/**
 * Um deck só entra em batalha cheio.
 *
 * Não é rigor por rigor: os times de líder têm 3, 4 e 6 conforme a faixa, e
 * entrar no Ginásio 9 com quatro cartas seria uma derrota anunciada que a tela
 * deixou passar.
 */
export function isBattleReady(deck: DeckSlots): boolean {
  return filledCount(deck) === DECK_SIZE
}

/**
 * Põe uma carta num slot, tirando-a de onde ela estivesse.
 *
 * A troca acontece **aqui** e não em quem chama, porque é ela que mantém a regra
 * de não repetir verdadeira sem precisar recusar nada: pôr no slot 5 uma carta
 * que está no 2 é uma ação só, e um `place` que escrevesse apenas no destino
 * deixaria a espécie nos dois lugares.
 *
 * **A tela ainda não oferece esse caminho** — a coluna de picks exclui o que já
 * está no deck, e nenhum slot é arrastável. A regra existe como defesa da
 * fronteira, não como descrição de interação: ela é o que impede um save
 * adulterado, ou um arrastar entre slots que uma fase futura acrescente, de
 * produzir um time com duas cópias da mesma espécie.
 */
export function place(deck: DeckSlots, slot: number, id: SpeciesId): DeckSlots {
  if (!Number.isInteger(slot) || slot < 0 || slot >= DECK_SIZE) return deck

  return deck.map((held, index) => {
    if (index === slot) return id
    // A carta sai de onde estava: sem isto, mover dentro do deck duplicaria.
    return held === id ? null : held
  })
}

/** Esvazia um slot. É o que moer a última cópia dispara. */
export function clear(deck: DeckSlots, slot: number): DeckSlots {
  if (!Number.isInteger(slot) || slot < 0 || slot >= DECK_SIZE) return deck
  return deck.map((held, index) => (index === slot ? null : held))
}

/**
 * Tira uma espécie do deck, onde quer que ela esteja.
 *
 * É a metade do jogo da regra "moer uma carta do deck ativo esvazia o slot": a
 * coleção decide que a espécie acabou, e o deck a solta sem saber por quê. O
 * caminho contrário — a coleção perguntar ao deck antes de moer — faria a forja
 * depender de uma tela, e é o que o plano recusa ao escolher esvaziar em vez de
 * bloquear.
 */
export function remove(deck: DeckSlots, id: SpeciesId): DeckSlots {
  return deck.map(held => (held === id ? null : held))
}

/** O mínimo que a leitura de cobertura precisa saber de uma carta. */
export interface CoverageCard {
  readonly id: SpeciesId
  readonly types: readonly TypeName[]
}

/**
 * Um tipo do deck, e quanto ele multiplica contra o próximo ginásio.
 *
 * **Sem a lista de quais cartas trazem o tipo.** Ela existiu no primeiro corte e
 * saiu: nenhuma tela a lia, e campo declarado que ninguém consome é receita não
 * verificada — o mesmo argumento que o tema faz sobre token nunca usado. Se a
 * leitura por carta voltar a ser pedida, o `byType` abaixo já a tem em mãos.
 */
export interface OutgoingCoverage {
  readonly type: TypeName
  readonly multiplier: number
}

/** Uma carta do deck que apanha do tipo do líder. */
export interface IncomingRisk {
  readonly id: SpeciesId
  readonly multiplier: number
}

export interface DeckCoverage {
  readonly outgoing: readonly OutgoingCoverage[]
  readonly incoming: readonly IncomingRisk[]
}

/**
 * A leitura que o deck builder mostra contra o próximo ginásio.
 *
 * Duas colunas, como a prancha *Deck* as desenha: o que o seu time bate no tipo
 * do líder, e quem do seu time apanha dele.
 *
 * **A leitura é por tipo da carta, não pelos golpes dela, e isso é uma
 * aproximação declarada.** Quem decide dano de verdade é o moveset, e
 * `selectBattleMoves` só o resolve na hora da batalha. A aproximação se sustenta
 * porque aquela seleção é por cobertura e o STAB puxa para os tipos da própria
 * espécie — um Pikachu praticamente sempre leva um golpe elétrico. O que ela
 * **não** faz é prometer: a tela lê "seu time tem elétrico, e elétrico bate ×2",
 * que é verdade sobre o time, e não "você vai causar ×2".
 *
 * A matriz é a mesma 18×18 que o motor usa, recebida de fora porque `shared/`
 * não lê arquivo. Sem isso a tela teria regra própria, e duas cópias da tabela de
 * tipos é como elas deixam de concordar sem ninguém mudar nada.
 */
export function deckCoverage(
  matrix: CoreData['effectiveness'],
  cards: readonly CoverageCard[],
  leaderType: TypeName,
): DeckCoverage {
  const types = new Set<TypeName>()
  for (const card of cards) {
    for (const type of card.types) types.add(type)
  }

  const outgoing = [...types]
    .map(type => ({
      type,
      multiplier: effectivenessAgainst(matrix, type, [leaderType]),
    }))
    // Decrescente: o que resolve o ginásio vem primeiro, e o ×0.5 que pede troca
    // fica no fim, que é onde a prancha o põe.
    // Comparação de código, e não `localeCompare`: `shared/` é a camada que não
    // pode depender de ambiente, e a locale do processo é ambiente. Os nomes de
    // tipo são ASCII, então o resultado é o mesmo — o que muda é a garantia.
    .sort((a, b) => b.multiplier - a.multiplier || (a.type < b.type ? -1 : 1))

  const incoming = cards
    .map(card => ({
      id: card.id,
      multiplier: effectivenessAgainst(matrix, leaderType, card.types),
    }))
    // Só quem apanha **mais** que o normal: listar as neutras encheria a coluna
    // para não informar nada, que é o mesmo argumento de `incomingDamageRelations`.
    .filter(risk => risk.multiplier > 1)
    .sort((a, b) => b.multiplier - a.multiplier || a.id - b.id)

  return { outgoing, incoming }
}
