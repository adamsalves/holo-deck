import { describe, expect, it } from 'vitest'
import { describeEvolution, flattenChain, humanizeSlug, toStages } from '~~/shared/game/evolution'
import { readAllSpecies, readChains } from '../support/generated-dex'

/**
 * O rótulo da aresta de evolução, medido contra as 483 condições reais.
 *
 * O erro que este teste existe para pegar não é a frase feia: é a condição que
 * **some**. São 19 campos opcionais e a maioria aparece em uma ou duas arestas
 * do dex inteiro — `turnUpsideDown` em uma, `partyType` em uma. Um `if` faltando
 * não quebra nada, não aparece em nenhuma tela que alguém vá abrir, e transforma
 * "troca segurando Metal Coat" em "troca".
 */

const chains = readChains()
const species = readAllSpecies()

const conditions = Object.values(chains)
  .flatMap(flattenChain)
  .flatMap(node => (node.via === undefined ? [] : [node.via]))

describe('rótulo da condição', () => {
  it('escreve o nível, que é a condição de 348 das 483 arestas', () => {
    expect(describeEvolution({ trigger: 'level-up', minLevel: 16 })).toBe('Nível 16')
  })

  it('reproduz os dois rótulos que a prancha Detalhe desenha', () => {
    const charizard = chains[Object.keys(chains).find(id => chains[id]?.slug === 'charmander') ?? '']
    const charmeleon = charizard?.evolvesTo[0]

    expect(charmeleon?.via && describeEvolution(charmeleon.via)).toBe('Nível 16')
    expect(charmeleon?.evolvesTo[0]?.via && describeEvolution(charmeleon.evolvesTo[0].via)).toBe('Nível 36')
  })

  it('não promete um número quando a subida de nível não tem um', () => {
    expect(describeEvolution({ trigger: 'level-up', minHappiness: 160 })).toBe('Subir de nível, felicidade 160')
  })

  it('põe o nome próprio como a PokeAPI o entrega, só humanizado', () => {
    expect(humanizeSlug('fire-stone')).toBe('Fire Stone')
    expect(describeEvolution({ trigger: 'use-item', item: 'water-stone' })).toBe('Usar Water Stone')
  })

  it('não repete o item quando ele já é a cláusula principal', () => {
    const frase = describeEvolution({ trigger: 'use-item', item: 'sun-stone' })

    expect(frase).toBe('Usar Sun Stone')
    expect(frase.match(/Sun Stone/g)).toHaveLength(1)
  })

  it('acumula as ressalvas na ordem em que se lê a frase', () => {
    // A vírgula separa toda ressalva, sem exceção por gatilho: uma regra de
    // pontuação por caso daria frases que só um `switch` explica.
    expect(describeEvolution({ trigger: 'trade', heldItem: 'metal-coat' })).toBe('Troca, segurando Metal Coat')
    expect(describeEvolution({ trigger: 'level-up', minLevel: 25, timeOfDay: 'night' })).toBe('Nível 25, de noite')
    expect(describeEvolution({ trigger: 'level-up', minLevel: 30, gender: 1 })).toBe('Nível 30, fêmea')
  })

  it('traduz o tipo da ressalva, que é vocabulário do jogo e não nome próprio', () => {
    expect(describeEvolution({ trigger: 'level-up', minLevel: 1, knownMoveType: 'fairy' }))
      .toBe('Nível 1, sabendo um golpe do tipo Fada')
  })

  /**
   * A varredura que dá sentido às asserções acima: nenhuma das 483 arestas pode
   * produzir frase vazia, e nenhuma pode produzir um slug cru com hífen — que é
   * como um campo esquecido apareceria se alguém o concatenasse sem passar pelo
   * humanizador.
   */
  it('produz frase para cada uma das arestas do dex', () => {
    expect(conditions.length).toBeGreaterThan(400)

    const vazias = conditions.filter(via => describeEvolution(via).trim() === '')
    expect(vazias, 'aresta sem rótulo é seta sem explicação na tela').toEqual([])

    const comSlug = conditions.filter(via => /[a-z]-[a-z]/.test(describeEvolution(via)))
    expect(comSlug.map(via => describeEvolution(via)), 'slug cru vazando para a tela').toEqual([])
  })

  it('não deixa nenhum gatilho cair no humanizador', () => {
    // Um gatilho fora da tabela vira `Three Critical Hits` — legível, em inglês,
    // e sinal de que a lista envelheceu em relação ao dex.
    const semRotulo = [...new Set(conditions.map(via => via.trigger))]
      .filter(trigger => describeEvolution({ trigger }) === humanizeSlug(trigger) && trigger.includes('-'))

    expect(semRotulo, 'gatilho sem rótulo em português').toEqual([])
  })
})

describe('árvore em fileiras', () => {
  it('achata a cadeia linear em um estágio por degrau', () => {
    const charmander = Object.values(chains).find(root => root.slug === 'charmander')
    const stages = charmander === undefined ? [] : toStages(charmander)

    expect(stages.map(stage => stage.nodes.map(node => node.slug))).toEqual([
      ['charmander'], ['charmeleon'], ['charizard'],
    ])
  })

  it('mantém os oito filhos de Eevee no mesmo estágio', () => {
    // A razão de a árvore ser achatada por profundidade em vez de percorrida em
    // linha: uma renderização que assuma sequência esconde sete evoluções.
    const eevee = Object.values(chains).find(root => root.slug === 'eevee')
    const stages = eevee === undefined ? [] : toStages(eevee)

    expect(stages).toHaveLength(2)
    expect(stages[1]?.nodes.length).toBeGreaterThanOrEqual(8)
  })

  it('alcança toda espécie do dex por alguma cadeia', () => {
    // Cadeia é como o detalhe resolve a linha evolutiva. Uma espécie fora de
    // todas elas abriria a aba Evolução vazia, e são 1025 abas.
    const nasCadeias = new Set(Object.values(chains).flatMap(flattenChain).map(node => node.speciesId))
    const fora = species.filter(entry => !nasCadeias.has(entry.id))

    expect(fora.map(entry => entry.slug)).toEqual([])
  })
})
