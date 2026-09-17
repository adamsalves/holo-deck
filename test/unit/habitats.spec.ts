import { describe, expect, it } from 'vitest'
import { HABITAT_NAMES, isHabitat } from '~~/shared/types/dex'
import { habitatKey } from '~~/shared/types/game'
import { readAllSpecies } from '../support/generated-dex'
import { defaultLocale, label, localeCodes } from '../support/locales'

/**
 * A lista de habitats é escrita à mão e o dex é gerado — este teste mantém as
 * duas iguais, pelo mesmo motivo que `regions.spec.ts` faz com as regiões.
 *
 * O sintoma de divergirem é o painel *Sobre* escrevendo `habitat.cave` onde vai
 * o nome do lugar — e ali o habitat está em `--accent`, que é o valor mais
 * destacado do painel.
 *
 * **O `Record<Habitat, string>` que fechava metade disso não existe mais.**
 * Enquanto o rótulo morava em `shared/`, o compilador cobrava um por nome da
 * tupla e o que faltava era só a outra ponta — um habitat no dex que a tupla não
 * conhece. Agora o texto mora em JSON, onde não há compilador: as duas pontas
 * são deste arquivo, e é a troca que `rarityKey` documenta lá, de garantia de
 * tipo por portão.
 */

const SPECIES = readAllSpecies()

describe('habitats', () => {
  it('são os nove, e todos com rótulo em cada idioma', () => {
    expect(HABITAT_NAMES).toHaveLength(9)

    const codes = localeCodes()
    expect(codes.length, 'nenhum locale para comparar').toBeGreaterThan(1)

    for (const code of codes) {
      for (const name of HABITAT_NAMES) {
        expect(label(habitatKey(name), code), `${habitatKey(name)} não tem rótulo em ${code}`).not.toBe('')
      }
    }

    // Nenhum rótulo pode ser o próprio identificador: é exatamente o
    // `ROUGH TERRAIN` que a varredura tirou da tela. **Só no locale padrão**,
    // pela razão que `i18n-gate` já escreve na mesma asserção sobre o
    // vocabulário: em inglês o rótulo *é* o identificador com inicial maiúscula,
    // e `cave` → *Cave* está certo. Cobrar isso dos dois reprovaria seis dos
    // nove habitats por estarem traduzidos corretamente.
    for (const name of HABITAT_NAMES) {
      const written = label(habitatKey(name), defaultLocale())

      expect(written.toLowerCase(), `o locale padrão escreve o identificador em ${name}`).not.toBe(name)
    }
  })

  /**
   * `rare` é o que precisou de decisão em vez de dicionário.
   *
   * Na PokeAPI ele é o habitat de quem não mora em lugar nenhum comum, então
   * *raro* mediria a mesma coisa que `rarity.uncommon` e diria outra. Os dois
   * idiomas nomeiam o lugar — *Ermo*, *Wilds* —, e esta asserção existe para que
   * uma tradução futura não o devolva à escada de raridade.
   */
  it('não empresta a palavra da escada de raridade para o habitat `rare`', () => {
    for (const code of localeCodes()) {
      const habitat = label(habitatKey('rare'), code).toLowerCase()

      expect([label('rarity.rare', code).toLowerCase(), label('rarity.uncommon', code).toLowerCase()])
        .not.toContain(habitat)
    }
  })

  it('cobrem todo habitat que o dex gerado traz', () => {
    const found = new Set(
      SPECIES.map(entry => entry.habitat).filter(habitat => habitat !== null),
    )

    expect(found.size).toBeGreaterThan(0)
    for (const habitat of found) {
      expect(isHabitat(habitat)).toBe(true)
    }
  })

  it('o nulo é legítimo, e é o da geração 6 em diante', () => {
    // A PokeAPI parou de preencher o campo. Inventar um valor mentiria na aba
    // *Sobre*, e é por isso que o tipo é `Habitat | null` e não `Habitat`.
    expect(SPECIES.some(entry => entry.habitat === null)).toBe(true)
    expect(SPECIES.some(entry => entry.habitat !== null)).toBe(true)
  })
})
