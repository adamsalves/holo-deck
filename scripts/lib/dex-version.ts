import { createHash } from 'node:crypto'
import type { CoreData, GenerationData } from '../../shared/types/dex.ts'
import { DEX_VERSION_LENGTH } from '../../shared/types/dex.ts'

/**
 * A impressão digital do dex, calculada no build e gravada em `core.json`.
 *
 * **Por que ela existe:** o `BattleLog` guarda seed e lista de ações, e o motor
 * reconstrói a luta por replay. `ENGINE_VERSION` trava a ordem de consumo do
 * RNG, mas o motor tem uma segunda entrada que ninguém versionava — o dex.
 * `selectBattleMoves` escolhe os 4 golpes a partir do catálogo, e `buildGymTeam`
 * monta o time do líder a partir das espécies da geração: mudou qualquer um dos
 * dois entre gravar e retomar, o mesmo log produz outra batalha, sem erro e sem
 * aviso. É a issue #18, e o PR #17 já foi a prova de que não é hipótese — trazer
 * os golpes de status tirou o oitavo golpe de 309 espécies.
 *
 * **Por que ela cobre as gerações, e não só `core.json`:** porque `buildGymTeam`
 * lê `gen-N.json`. Um hash só do catálogo passaria batido por uma troca de base
 * stat, de tipo ou de moveset — que é justamente o que decide quais 3, 4 ou 6
 * espécies o líder leva a campo.
 *
 * **O que ela não é:** garantia contra adulteração. O save é do jogador e o
 * plano decidiu confiar nele; isto existe para o build honesto não mentir, não
 * para o desonesto ser pego.
 */

/**
 * Sha-256 do dex inteiro, truncado.
 *
 * `dexVersion` sai de fora do payload de propósito: `core.json` carrega o
 * próprio hash, e incluí-lo na conta seria pedir um ponto fixo. O que entra é o
 * conteúdo — catálogo, matriz, tipos, metadados de geração — e as nove gerações
 * inteiras, na ordem em que o build as emite.
 *
 * `JSON.stringify` e não o texto dos arquivos: o hash passa a depender do dado e
 * não da formatação, então trocar `serializeRows` por outra quebra de linha não
 * descarta a batalha de ninguém. A ordem das chaves é a de inserção, que neste
 * build é fixa — as duas estruturas são montadas por código, nunca por spread de
 * objeto vindo da rede.
 */
export function dexVersionOf(
  core: Omit<CoreData, 'dexVersion'>,
  generations: readonly GenerationData[],
): string {
  const hash = createHash('sha256')

  hash.update(JSON.stringify(core))
  // Uma atualização por geração, e não um `JSON.stringify` do array inteiro: a
  // lista pode ser grande (448 KB), e alimentar o hash em pedaços é o que evita
  // materializar o dex duas vezes na memória.
  for (const generation of generations) hash.update(JSON.stringify(generation))

  return hash.digest('hex').slice(0, DEX_VERSION_LENGTH)
}
