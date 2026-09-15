import type { SpeciesId } from './brand.ts'
import type { AilmentName, Habitat, TypeName } from './dex.ts'

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
 * The locale key of a rarity label — `rarity.common`, never `Comum`.
 *
 * The label itself left `shared/` in Phase 8. The game speaks two languages and
 * a `Record<Rarity, string>` can only hold one of them, so what stays here is
 * the id and the **address** of the text: a key is not screen text, and the
 * `shared/` boundary is intact as long as the consumer is the one calling `t()`.
 *
 * Built by a function instead of spelled out at each of the fourteen call sites
 * so the namespace has one owner. `test/unit/i18n-gate.spec.ts` derives the keys
 * it expects by mapping `RARITY_NAMES` through this very function, which is what
 * makes a new rung without a translation fail loudly.
 *
 * **This trades a compiler guarantee for a gate, and the trade is deliberate.**
 * The complete `Record` meant a new rung did not compile until it had a label;
 * JSON has no types, so a missing key would otherwise reach the screen as the
 * literal `rarity.mythic`. The gate is what carries that weight now.
 */
export function rarityKey(rarity: Rarity): string {
  return `rarity.${rarity}`
}

/**
 * As 9 regiões, na ordem das gerações — a lista que o dex traz como
 * `main_region.name` em `core.json`.
 *
 * Existe como tupla, e não como `string` solta, para o rótulo poder ser um
 * `Record` completo: uma região nova sem nome escrito não compila. O portão de
 * `test/unit/regions.spec.ts` fecha o outro lado, conferindo que esta lista é a
 * mesma que o dex gerado contém e na mesma ordem.
 */
export const REGION_NAMES = [
  'kanto', 'johto', 'hoenn', 'sinnoh', 'unova', 'kalos', 'alola', 'galar', 'paldea',
] as const

export type RegionName = typeof REGION_NAMES[number]

export function isRegionName(value: string): value is RegionName {
  return REGION_NAMES.some(known => known === value)
}

/**
 * O nome próprio de cada região.
 *
 * São os mesmos nos dois idiomas — é justamente por isso que o rótulo existe:
 * sem ele o cabeçalho escreveria `kanto` em caixa baixa, e a alternativa seria
 * capitalizar o slug em runtime, que funciona para estas nove e quebra na
 * primeira região de nome composto.
 */
export const REGION_LABELS: Record<RegionName, string> = {
  kanto: 'Kanto',
  johto: 'Johto',
  hoenn: 'Hoenn',
  sinnoh: 'Sinnoh',
  unova: 'Unova',
  kalos: 'Kalos',
  alola: 'Alola',
  galar: 'Galar',
  paldea: 'Paldea',
}

/**
 * `Geração IV`, que é como a prancha *Pokédex* escreve o sobretítulo da região.
 *
 * O dex traz `Generation IV` em `displayName`, vindo da PokeAPI — em inglês, num
 * documento `lang="pt-BR"`. Traduzir aqui, e não no build, mantém a regra do
 * repositório de que `dex.ts` guarda o que vem de fora e o texto que o jogador
 * lê é coisa deste módulo.
 *
 * O algarismo sai da lista, e não de um conversor: são nove valores fixos, e um
 * conversor genérico seria mais código para cobrir 991 números que não existem.
 */
const ROMAN_NUMERALS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'] as const

export function generationLabel(generation: number): string {
  return `Geração ${ROMAN_NUMERALS[generation - 1] ?? generation}`
}

/**
 * Os 9 habitats em português. Mesma razão que `TYPE_LABELS`, e o mesmo caso: o
 * painel *Sobre* põe o habitat em `--accent`, o que faz dele o valor mais
 * destacado de um documento `lang="pt-BR"` — `ROUGH TERRAIN` ali é exatamente o
 * `FLYING` que o canvas trocou por `VOADOR`.
 *
 * `rare` não é "raro" no sentido da escada de raridade: na PokeAPI é o habitat
 * dos que não moram em lugar nenhum comum, e "incomum" mediria a mesma coisa que
 * `RARITY_LABELS.uncommon`. "Ermo" nomeia o lugar, que é o que a coluna diz.
 */
export const HABITAT_LABELS: Record<Habitat, string> = {
  'cave': 'Caverna',
  'forest': 'Floresta',
  'grassland': 'Campo',
  'mountain': 'Montanha',
  'rare': 'Ermo',
  'rough-terrain': 'Terreno acidentado',
  'sea': 'Mar',
  'urban': 'Urbano',
  'waters-edge': 'Beira d\'água',
}

/**
 * As quatro condições em português, por extenso.
 *
 * `CONDITION_LABELS`, em `shared/game/status.ts`, é a versão de três letras que
 * cabe na etiqueta da carta em campo (`PAR`); esta é a que a carta de golpe
 * escreve por extenso — `STATUS · paralisia · ACC 90`, como a prancha *Batalha*.
 * São dois papéis e dois tamanhos, e derivar um do outro daria `PAR` truncado ou
 * `paralisia` estourando a etiqueta.
 *
 * Mora aqui e não em `status.ts` pelo mesmo motivo de `TYPE_LABELS`: `dex.ts`
 * guarda o que vem da PokeAPI e `status.ts` guarda a regra; o texto que o
 * jogador lê é coisa que este módulo inventa.
 */
export const AILMENT_LABELS: Record<AilmentName, string> = {
  paralysis: 'paralisia',
  burn: 'queimadura',
  poison: 'envenenamento',
  sleep: 'sono',
}

/**
 * The locale key of a type label — `type.electric`, never `Elétrico`.
 *
 * Same move as `rarityKey`, and it still lives here rather than in `dex.ts` for
 * the reason the old label had: `dex.ts` is the contract for what the PokeAPI
 * sends, and the name the player reads is something this game invents. What
 * changed is that the game now invents it twice, one per locale.
 *
 * `TypeName` and not `string`: an unknown type from the API would build a key
 * nothing translates, and the screen would read `type.stellar`. Callers holding
 * a raw slug — `shared/game/evolution.ts` is the one — resolve it through
 * `isTypeName` first and keep their own fallback.
 */
export function typeKey(type: TypeName): string {
  return `type.${type}`
}

/**
 * Uma carta saída de um pack — o que o `PackOpener` vira e o que a coleção
 * credita.
 *
 * `rarity` viaja junto com o id em vez de ser recalculada por quem recebe, e
 * isso não é cache: é o **veredito daquele sorteio**. O slot raro+ decide o tier
 * antes de escolher a espécie, e é esse tier que a animação escala e que o pity
 * observa. Reconstruir a raridade a partir do id daria o mesmo valor hoje, e
 * apagaria a diferença entre "a carta que saiu do slot raro" e "uma carta que
 * por acaso é rara" no dia em que um slot passar a poder rebaixar.
 *
 * `isShiny` é por carta, não por espécie: o brilho é de **exemplar**, e a mesma
 * espécie pode estar na coleção nas duas formas — a prancha *Coleção* mostra
 * Gengar shiny com contagem própria, ao lado da contagem normal.
 */
export interface PackCard {
  readonly speciesId: SpeciesId
  readonly rarity: Rarity
  readonly isShiny: boolean
}

/**
 * O que a coleção guarda por espécie: quantas cópias, e quantas delas shiny.
 *
 * Os nomes são de uma letra porque este objeto é o save — `{"25":{"c":3,"s":1}}`
 * —, e a coleção completa em nomes longos passaria de 19,9 KB para ~60 KB numa
 * cota de 5 MB que o plano mediu inteira. É o único lugar do repositório onde
 * abreviar se paga, e mesmo aqui o formato continua **legível no DevTools**, que
 * foi a razão de recusar a versão empacotada em base36.
 *
 * `s` conta shiny e `c` conta o **total**, shiny incluído. A alternativa —
 * contar normais em `c` e shiny em `s` — faria toda soma de "quantas tenho"
 * virar `c + s`, e a primeira que alguém esquecesse produziria uma coleção que
 * some cartas ao ganhar um shiny.
 */
export interface CollectionEntry {
  /** Total de cópias, shiny incluído. Sempre ≥ 1 — a ausência é não ter a espécie. */
  readonly c: number
  /** Quantas das cópias são shiny. */
  readonly s: number
}

/**
 * O filtro de posse da Pokédex — *Todos*, *Possuídos*, *Faltando*.
 *
 * Exclusivo, e não cumulativo como tipo e raridade: os dois recortes
 * **particionam** o dex, então ligar ambos é o mesmo que ligar nenhum. Vive aqui
 * e não no componente porque a prancha *Pokédex* e a *Coleção* desenham a mesma
 * ideia, e a segunda tela que precisar dela não deve redeclarar o vocabulário.
 */
export const OWNERSHIP_FILTERS = ['all', 'owned', 'missing'] as const

export type OwnershipFilter = typeof OWNERSHIP_FILTERS[number]
