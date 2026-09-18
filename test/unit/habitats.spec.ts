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
  it('are the nine, each with a label in every language', () => {
    expect(HABITAT_NAMES).toHaveLength(9)

    const codes = localeCodes()
    expect(codes.length, 'no locale to compare').toBeGreaterThan(1)

    for (const code of codes) {
      for (const name of HABITAT_NAMES) {
        expect(label(habitatKey(name), code), `${habitatKey(name)} has no label in ${code}`).not.toBe('')
      }
    }

    // No label may be the identifier itself: that is exactly the `ROUGH TERRAIN`
    // the sweep took off the screen. **In the default locale only**, for the
    // reason `i18n-gate` already spells in the same assertion over the
    // vocabulary: in English the label *is* the identifier with a capital, and
    // `cave` → *Cave* is right. Asking it of both would fail six of the nine
    // habitats for being correctly translated.
    for (const name of HABITAT_NAMES) {
      const written = label(habitatKey(name), defaultLocale())

      expect(written.toLowerCase(), `the default locale writes the identifier in ${name}`).not.toBe(name)
    }
  })

  /**
   * `rare` is the one that needed a decision rather than a dictionary.
   *
   * In the PokeAPI it is the habitat of whoever lives in no common place, so
   * *raro* would measure the same thing `rarity.uncommon` does and say another.
   * Both languages name the place instead — *Ermo*, *Wilds* — and this assertion
   * exists so a future translation does not hand it back to the rarity ladder.
   */
  it('does not borrow the rarity ladder word for the `rare` habitat', () => {
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
