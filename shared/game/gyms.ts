import type { GymId } from '../types/brand.ts'
import { GYM_COUNT, isGymId } from '../types/brand.ts'
import type { SpeciesEntry, TypeName } from '../types/dex.ts'
import type { RegionName } from '../types/game.ts'
import { baseStatTotal } from './rarity.ts'

/**
 * Os nove ginásios da Liga — um por geração, e é isso que dá sentido à ordem:
 * vencer os nove em sequência passeia pelas nove gerações do dex.
 *
 * **Os líderes só existiam desenhados na prancha *Liga*.** Ficam escritos aqui
 * porque `gyms.ts` precisa deles e prancha não é fonte de dado — um mockup não
 * compila, não é lido por teste e não avisa quando alguém troca um nome.
 *
 * O time **sai da regra**, não de uma lista curada: mesmo tipo do líder, mesma
 * geração dele, sob o teto de BST da faixa, os N de maior BST. A alternativa era
 * escolher 39 espécies à mão — mais reconhecível, e capaz de divergir do dex em
 * silêncio no dia em que uma delas mudasse de tipo. Composição de time é regra
 * de jogo; o canvas é a especificação **visual**.
 *
 * A divergência que isso cria está registrada: a prancha desenha Onix como ace
 * do Brock e usa Noctowl como ativo do Falkner, e a regra produz Graveler como
 * ace e não inclui Noctowl. As duas artes passam a ser ilustrativas.
 */

/** O que define um líder, antes de o número do ginásio entrar. */
interface LeaderProfile {
  readonly name: string
  readonly region: RegionName
  readonly type: TypeName
}

/**
 * Na ordem dos ginásios: o índice + 1 é o número do ginásio **e** a geração.
 * As duas coisas coincidirem não é acaso — é a regra "uma geração, um líder".
 */
const PROFILES: readonly LeaderProfile[] = [
  { name: 'Brock', region: 'kanto', type: 'rock' },
  { name: 'Falkner', region: 'johto', type: 'flying' },
  { name: 'Wattson', region: 'hoenn', type: 'electric' },
  { name: 'Gardenia', region: 'sinnoh', type: 'grass' },
  { name: 'Lenora', region: 'unova', type: 'normal' },
  { name: 'Valerie', region: 'kalos', type: 'fairy' },
  { name: 'Kiawe', region: 'alola', type: 'fire' },
  { name: 'Nessa', region: 'galar', type: 'water' },
  { name: 'Ryme', region: 'paldea', type: 'ghost' },
]

export interface GymLeader extends LeaderProfile {
  readonly gym: GymId
  /** O mesmo número do ginásio, e existe como campo para quem lê o dex não
   * precisar conhecer a coincidência. */
  readonly generation: number
  readonly teamSize: number
  readonly bstCap: number
}

/**
 * As três faixas da Liga, de três ginásios cada.
 *
 * Ela mora aqui, e não em `ai.ts`, porque a faixa é conceito da Liga: ela decide
 * ao mesmo tempo o tamanho do time, o teto de BST e o comportamento do líder. O
 * corte 3/6 estava escrito nos dois módulos, e duas cópias do mesmo corte é como
 * eles deixam de concordar sem ninguém mudar nada.
 */
export type GymBand = 'A' | 'B' | 'C'

export function bandOf(gym: number): GymBand {
  if (gym <= 3) return 'A'
  if (gym <= 6) return 'B'
  return 'C'
}

/** Time e teto por faixa. A curva é de dificuldade: mais Pokémon e mais fortes
 * conforme a Liga avança. */
const BAND_RULES: Record<GymBand, { teamSize: number, bstCap: number }> = {
  A: { teamSize: 3, bstCap: 480 },
  B: { teamSize: 4, bstCap: 540 },
  C: { teamSize: 6, bstCap: 600 },
}

/**
 * Os nove, prontos. A marca do id sai do guarda e não de um `as`: a faixa vive
 * num lugar só, e a lista não compila se ganhar um décimo perfil sem que
 * `GYM_COUNT` cresça junto.
 */
export const GYM_LEADERS: readonly GymLeader[] = PROFILES.map((profile, index) => {
  const gym = index + 1
  if (!isGymId(gym)) {
    throw new Error(`ginásio ${gym} fora da faixa 1..${GYM_COUNT} — a lista de líderes cresceu sozinha`)
  }
  return { ...profile, gym, generation: gym, ...BAND_RULES[bandOf(gym)] }
})

/** Uma faixa vista de fora: onde começa, onde acaba, e o que ela cobra. */
export interface GymBandSummary {
  readonly band: GymBand
  readonly first: GymId
  readonly last: GymId
  readonly teamSize: number
  readonly bstCap: number
}

/**
 * As três faixas resumidas — o que a página `/rules` desenha.
 *
 * **Derivadas de `GYM_LEADERS`, e não de `BAND_RULES`.** Numa página cujo
 * contrato é *nada aqui pode divergir do jogo*, o que vale é ler o que
 * acontece, e não o que deveria acontecer.
 *
 * **Hoje divergir é impossível, e vale dizer isso em vez de insinuar o
 * contrário.** `GYM_LEADERS` monta cada líder com `...BAND_RULES[bandOf(gym)]`
 * por último, então `teamSize` e `bstCap` vêm sempre da faixa e um valor
 * próprio no `LeaderProfile` seria descartado em silêncio. A versão anterior
 * deste comentário prometia surfacear o líder que fugisse da regra — e o
 * `reduce` abaixo, que fundia por banda e herdava os números do **primeiro**
 * líder, faria justamente o contrário se a divergência existisse.
 *
 * O `reduce` foi corrigido para abrir faixa nova quando os números divergem, de
 * modo que o resumo seja honesto no dia em que o `LeaderProfile` puder
 * sobrescrevê-los. **Esse dia depende de inverter a ordem do espalhamento em
 * `GYM_LEADERS`**, que é decisão de como o líder é escrito e não deste módulo.
 *
 * A ordem é a dos ginásios, porque é a ordem em que se joga.
 */
export const GYM_BANDS: readonly GymBandSummary[] = GYM_LEADERS
  .reduce<GymBandSummary[]>((bands, leader) => {
    const open = bands.at(-1)

    // A faixa aberta só continua se o líder **também** cobrar o mesmo — e não só
    // se ele pertencer à mesma faixa. Fundir por banda e herdar `teamSize` e
    // `bstCap` do primeiro era o que fazia o docblock acima mentir: um líder que
    // fugisse da regra da sua faixa ficava escondido atrás dos números do
    // vizinho, e `/rules` seguiria exibindo o valor antigo. Divergiu, abre faixa
    // nova, e a página mostra as duas linhas.
    if (
      open !== undefined
      && open.band === bandOf(leader.gym)
      && open.teamSize === leader.teamSize
      && open.bstCap === leader.bstCap
    ) {
      return [...bands.slice(0, -1), { ...open, last: leader.gym }]
    }

    return [...bands, {
      band: bandOf(leader.gym),
      first: leader.gym,
      last: leader.gym,
      teamSize: leader.teamSize,
      bstCap: leader.bstCap,
    }]
  }, [])

export function gymLeader(gym: GymId): GymLeader {
  const leader = GYM_LEADERS[gym - 1]
  if (leader === undefined) throw new Error(`ginásio ${gym} não existe`)
  return leader
}

/**
 * O time do líder, montado sobre as espécies da geração dele.
 *
 * O `pool` é `gen-N.json` — quem chama carrega o arquivo, porque `shared/` não
 * lê disco nem rede. As três restrições são cobradas aqui; a quarta, a de que o
 * pool é mesmo o da geração certa, não é verificável a partir de `SpeciesEntry`
 * (ela não carrega a geração) e é o teste sobre o dex real que a prova.
 *
 * **Sem lendário nem mítico, nos nove.** O plano abria exceção para o Ginásio 9,
 * e no dex real ela teria um único efeito concreto — pôr Pecharunt como ace da
 * Ryme. Não vale uma regra para uma espécie.
 *
 * A ordem é por BST **crescente**: o time entra em campo do mais fraco para o
 * mais forte, e o último é o **ace** — o que aparece na carta do líder na tela
 * da Liga.
 */
export function buildGymTeam(gym: GymId, pool: readonly SpeciesEntry[]): readonly SpeciesEntry[] {
  const leader = gymLeader(gym)

  const candidates = pool
    .filter(species => species.types.some(type => type === leader.type))
    .filter(species => baseStatTotal(species.baseStats) <= leader.bstCap)
    .filter(species => !species.isLegendary && !species.isMythical)
    .sort((a, b) => baseStatTotal(b.baseStats) - baseStatTotal(a.baseStats) || a.id - b.id)

  if (candidates.length < leader.teamSize) {
    throw new Error(
      `${leader.name} (ginásio ${gym}): ${candidates.length} candidatos para ${leader.teamSize} vagas`
      + ` — tipo ${leader.type}, geração ${leader.generation}, teto ${leader.bstCap}`,
    )
  }

  return candidates
    .slice(0, leader.teamSize)
    .reverse()
}

/** O de maior BST, que é o último a entrar. */
export function aceOf(team: readonly SpeciesEntry[]): SpeciesEntry {
  const ace = team[team.length - 1]
  if (ace === undefined) throw new Error('time vazio não tem ace')
  return ace
}
