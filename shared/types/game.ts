import type { TypeName } from './dex.ts'

/**
 * Tipos do jogo — o que a Pokédex não conhece.
 *
 * `dex.ts` descreve a espécie como a PokeAPI a entrega; aqui ficam as noções que
 * o Holo Deck inventa em cima dela. A Fase 2 traz só a raridade, porque ela é
 * quem decide tratamento visual: moldura, etiqueta, brilho e foil. Os limiares
 * de BST que atribuem raridade a cada espécie moram em `shared/game/rarity.ts`
 * — aqui está o vocabulário, não a regra.
 *
 * Essa separação continua valendo; o que mudou é **quando** a regra chegou. Ela
 * estava marcada para a Fase 5 e entrou na 3, porque a Pokédex a exibe: a
 * prancha *Detalhe* estampa `Raridade RARO` e a prancha *Pokédex* colore a
 * moldura de cada carta do grid. Raridade sai de BST e das duas marcas, tudo
 * dentro do próprio dex — nada nela espera pela coleção.
 */

/**
 * Os seis níveis, do mais comum ao mais raro. **A ordem é significativa**: é ela
 * que responde "isto é raro o bastante para X?", e é por isso que a lista é uma
 * tupla e não um `Set`.
 */
export const RARITY_NAMES = [
  'common', 'uncommon', 'rare', 'ultra', 'legendary', 'mythic',
] as const

export type Rarity = typeof RARITY_NAMES[number]

export const RARITY_COUNT = RARITY_NAMES.length

/** Posição na escada. Existe para as comparações não dependerem de `indexOf` solto. */
export function rarityRank(rarity: Rarity): number {
  return RARITY_NAMES.indexOf(rarity)
}

/**
 * Foil começa em raro — decidido no canvas e repetido na anotação da prancha de
 * raridade ("Foil começa em raro").
 *
 * Não é detalhe de estilo: o foil é a única coisa da interface que anima por
 * ponteiro, e prendê-lo a raro+ é o que mantém o grid de 1025 espécies barato.
 * Por isso a regra mora aqui, headless e testável, e não dentro do componente.
 */
export const FOIL_FROM_RARITY: Rarity = 'rare'

export function hasFoil(rarity: Rarity): boolean {
  return rarityRank(rarity) >= rarityRank(FOIL_FROM_RARITY)
}

/** `some` com comparação explícita pelo mesmo motivo que `isTypeName`: o
 * `includes` de uma tupla `as const` só aceita os próprios literais. */
export function isRarity(value: string): value is Rarity {
  return RARITY_NAMES.some(known => known === value)
}

/**
 * O texto que o jogador lê, e a razão de ele não ser o próprio identificador.
 *
 * O documento é `lang="pt-BR"` e os identificadores do repositório são em inglês
 * — as duas coisas são decisões firmes e incompatíveis num `{{ rarity }}` cru,
 * que põe COMMON na carta e faz o leitor de tela ler o enum em inglês no meio de
 * uma frase em português.
 *
 * São `Record` completo, e não `Partial`, de propósito: um nível novo na escada
 * não compila até ganhar rótulo. É a mesma amarração que o portão de tema faz
 * entre `TYPE_NAMES` e as cores, só que aqui o compilador dá conta sozinho.
 */
export const RARITY_LABELS: Record<Rarity, string> = {
  common: 'Comum',
  uncommon: 'Incomum',
  rare: 'Raro',
  ultra: 'Ultra',
  legendary: 'Lendário',
  mythic: 'Mítico',
}

/**
 * Os 18 tipos em português. Mesma razão que `RARITY_LABELS`, e mora aqui e não
 * em `dex.ts` porque a PokeAPI não entrega isto: `dex.ts` é o contrato do que
 * vem de fora, e o nome que o jogador lê é coisa que este jogo inventa.
 */
export const TYPE_LABELS: Record<TypeName, string> = {
  normal: 'Normal',
  fighting: 'Lutador',
  flying: 'Voador',
  poison: 'Venenoso',
  ground: 'Terrestre',
  rock: 'Pedra',
  bug: 'Inseto',
  ghost: 'Fantasma',
  steel: 'Aço',
  fire: 'Fogo',
  water: 'Água',
  grass: 'Planta',
  electric: 'Elétrico',
  psychic: 'Psíquico',
  ice: 'Gelo',
  dragon: 'Dragão',
  dark: 'Sombrio',
  fairy: 'Fada',
}
