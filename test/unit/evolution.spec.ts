import type { Translate } from '~~/shared/types/game'
import { describe, expect, it } from 'vitest'
import { describeEvolution, EVOLUTION_KEY_LIST, flattenChain, humanizeSlug, toStages } from '~~/shared/game/evolution'
import { readAllSpecies, readChains } from '../support/generated-dex'
import { defaultLocale, localeCodes, message } from '../support/locales'

/**
 * O rótulo da aresta de evolução, medido contra as 483 condições reais.
 *
 * O erro que este teste existe para pegar não é a frase feia: é a condição que
 * **some**. São 19 campos opcionais e a maioria aparece em uma ou duas arestas
 * do dex inteiro — `turnUpsideDown` em uma, `partyType` em uma. Um `if` faltando
 * não quebra nada, não aparece em nenhuma tela que alguém vá abrir, e transforma
 * "troca segurando Metal Coat" em "troca".
 *
 * **Every assertion now runs in both languages**, because the sentence stopped
 * being built from Portuguese fragments in `shared/` and became a message per
 * condition. What the composition has to survive is the crossing: a qualifier
 * that vanishes in one locale and not the other, or a placeholder the message
 * does not spell, is a defect that only a second language can show.
 */

/**
 * The translator `describeEvolution` asks its caller for, reading the locale
 * file the screen reads.
 *
 * `message()` **throws on a placeholder with no value**, and that is half of why
 * the tests below are worth running: a message rewritten to ask for `{level}`
 * where the code passes `{value}` fails here, naming the key, instead of
 * rendering the literal `{level}` under an arrow on a page nobody opens.
 */
function translator(code: string): Translate {
  return (key, values) => message(key, code, values ?? {})
}

const chains = readChains()
const species = readAllSpecies()

const conditions = Object.values(chains)
  .flatMap(flattenChain)
  .flatMap(node => (node.via === undefined ? [] : [node.via]))

/** Both languages, so the absence assertions below compare something. */
const LOCALES = localeCodes()

describe('rótulo da condição', () => {
  it('mede mais de um idioma', () => {
    expect(LOCALES.length).toBeGreaterThan(1)
  })

  /**
   * The two labels the *Detalhe* board draws, spelled out.
   *
   * A literal and not a `message()` lookup, because the board **is** the
   * specification for these two: `Lv 16` and `Lv 36` under the Charmander line
   * is what it draws, and asserting the locale against itself would agree with a
   * file where someone replaced both with the same word.
   */
  it('escreve o nível, que é a condição de 348 das 483 arestas', () => {
    expect(describeEvolution({ trigger: 'level-up', minLevel: 16 }, translator('pt-BR'))).toBe('Nível 16')
    expect(describeEvolution({ trigger: 'level-up', minLevel: 16 }, translator('en'))).toBe('Level 16')
  })

  it('reproduz os dois rótulos que a prancha Detalhe desenha', () => {
    const charizard = chains[Object.keys(chains).find(id => chains[id]?.slug === 'charmander') ?? '']
    const charmeleon = charizard?.evolvesTo[0]
    const pt = translator('pt-BR')

    expect(charmeleon?.via && describeEvolution(charmeleon.via, pt)).toBe('Nível 16')
    expect(charmeleon?.evolvesTo[0]?.via && describeEvolution(charmeleon.evolvesTo[0].via, pt)).toBe('Nível 36')
  })

  it('não promete um número quando a subida de nível não tem um', () => {
    for (const code of LOCALES) {
      expect(describeEvolution({ trigger: 'level-up', minHappiness: 160 }, translator(code))).toBe(
        `${message('evolution.trigger.levelUp', code)}, ${message('evolution.with.happiness', code, { value: 160 })}`,
      )
    }
  })

  it('põe o nome próprio como a PokeAPI o entrega, só humanizado', () => {
    expect(humanizeSlug('fire-stone')).toBe('Fire Stone')

    for (const code of LOCALES) {
      expect(describeEvolution({ trigger: 'use-item', item: 'water-stone' }, translator(code)))
        .toBe(message('evolution.main.useItem', code, { item: 'Water Stone' }))
    }
  })

  it('não repete o item quando ele já é a cláusula principal', () => {
    for (const code of LOCALES) {
      const phrase = describeEvolution({ trigger: 'use-item', item: 'sun-stone' }, translator(code))

      expect(phrase).toBe(message('evolution.main.useItem', code, { item: 'Sun Stone' }))
      expect(phrase.match(/Sun Stone/g)).toHaveLength(1)
    }
  })

  it('acumula as ressalvas na ordem em que se lê a frase', () => {
    // A vírgula separa toda ressalva, sem exceção por gatilho: uma regra de
    // pontuação por caso daria frases que só um `switch` explica. Ela sobrevive
    // à travessia — *Level 16, at night* lê em inglês como *Nível 16, de noite*
    // lê em português —, e é a única composição que restou neste módulo.
    for (const code of LOCALES) {
      const t = translator(code)

      expect(describeEvolution({ trigger: 'trade', heldItem: 'metal-coat' }, t)).toBe(
        `${message('evolution.trigger.trade', code)}, ${message('evolution.with.heldItem', code, { item: 'Metal Coat' })}`,
      )
      expect(describeEvolution({ trigger: 'level-up', minLevel: 25, timeOfDay: 'night' }, t)).toBe(
        `${message('evolution.main.level', code, { level: 25 })}, ${message('evolution.time.night', code)}`,
      )
      expect(describeEvolution({ trigger: 'level-up', minLevel: 30, gender: 1 }, t)).toBe(
        `${message('evolution.main.level', code, { level: 30 })}, ${message('evolution.gender.female', code)}`,
      )
    }
  })

  /**
   * The dangling gerund the measurement found, and the reason it is a test.
   *
   * `spin` occurs once in all 1025 chains — Milcery — and the dex carries **no
   * item** with it. The old fragment map spelled the trigger as *Girar
   * segurando*, so the screen read "Girar segurando" with nothing after it: a
   * preposition with no object, on a real page, in the language the game
   * shipped in. Splitting the bare trigger from the one that takes an item is
   * what fixes it, and the bare form is the one the dex actually reaches.
   */
  it('não deixa preposição pendurada quando o dex não traz o item', () => {
    for (const code of LOCALES) {
      const phrase = describeEvolution({ trigger: 'spin' }, translator(code))

      expect(phrase).toBe(message('evolution.trigger.spin', code))
      expect(phrase.trimEnd(), 'gerúndio sem objeto na tela').toBe(phrase)
    }
  })

  it('traduz o tipo da ressalva, que é vocabulário do jogo e não nome próprio', () => {
    for (const code of LOCALES) {
      expect(describeEvolution({ trigger: 'level-up', minLevel: 1, knownMoveType: 'fairy' }, translator(code))).toBe(
        `${message('evolution.main.level', code, { level: 1 })}, ${
          message('evolution.with.knownMoveType', code, { type: message('type.fairy', code) })}`,
      )
    }
  })

  /**
   * A varredura que dá sentido às asserções acima: nenhuma das 483 arestas pode
   * produzir frase vazia, e nenhuma pode produzir um slug cru com hífen — que é
   * como um campo esquecido apareceria se alguém o concatenasse sem passar pelo
   * humanizador.
   *
   * **A terceira varredura é a que o PR #53 pagou para aprender:** um
   * `translate` que não resolve devolve a própria chave, e `evolution.time.night`
   * sob uma seta é tão silencioso quanto uma frase vazia. Nada no disco vê isso;
   * aqui vê, porque a saída é comparada contra a forma de uma chave.
   */
  it('produz frase para cada uma das arestas do dex, nos dois idiomas', () => {
    expect(conditions.length).toBeGreaterThan(400)

    for (const code of LOCALES) {
      const t = translator(code)
      const phrases = conditions.map(via => describeEvolution(via, t))

      expect(phrases.filter(phrase => phrase.trim() === ''), 'aresta sem rótulo é seta sem explicação na tela')
        .toEqual([])
      // O hífen sozinho não é slug, e foi o inglês que mostrou isso: o detector
      // antigo (`/[a-z]-[a-z]/`) acusava *knowing a Fairy-type move* de vazar
      // `fairy-type` da API. Um slug que escapou do humanizador é minúsculo
      // **inteiro** — `water-stone` —, então o que identifica é a palavra
      // começar em caixa baixa, não o hífen existir. Escrito como estava, a
      // única saída seria reescrever a frase inglesa para caber no detector.
      expect(phrases.filter(phrase => /(?:^|[\s(])[a-z]+-[a-z]/.test(phrase)), 'slug cru vazando para a tela')
        .toEqual([])
      expect(phrases.filter(phrase => /(?:^|[\s,])[a-z]+\.[a-z]+[\w.]*/.test(phrase)), 'chave crua na tela')
        .toEqual([])
    }
  })

  it('não deixa nenhum gatilho cair no humanizador', () => {
    // Um gatilho fora da tabela vira `Three Critical Hits` — legível, em inglês,
    // e sinal de que a lista envelheceu em relação ao dex.
    const t = translator(defaultLocale())
    const withoutLabel = [...new Set(conditions.map(via => via.trigger))]
      .filter(trigger => describeEvolution({ trigger }, t) === humanizeSlug(trigger) && trigger.includes('-'))

    expect(withoutLabel, 'gatilho sem rótulo no locale').toEqual([])
  })

  /**
   * The list the gates read is the list the sentence uses.
   *
   * `EVOLUTION_KEY_LIST` exists so `i18n-gate` can see keys that are assembled
   * at runtime; if it drifted from the maps it is built from, the gate would
   * report live translations as orphans and have them deleted. Asking every key
   * in it to resolve in every locale is the cheap half of that, and it fails
   * here — naming the key — instead of in a gate that names the locale file.
   */
  it('endereça só chaves que os dois locales traduzem', () => {
    expect(EVOLUTION_KEY_LIST).not.toEqual([])
    expect(new Set(EVOLUTION_KEY_LIST).size).toBe(EVOLUTION_KEY_LIST.length)

    for (const code of LOCALES) {
      const missing = EVOLUTION_KEY_LIST.filter((key) => {
        try {
          // Placeholders are not the question here — an unfilled one throws and
          // that is the assertion above; a missing key is what this one reads.
          return message(key, code, { level: 1, item: 'x', move: 'x', value: 1, place: 'x', type: 'x', species: 'x', code: 1 }) === ''
        }
        catch {
          return true
        }
      })

      expect(missing, `o locale ${code} não traduz chave de evolução`).toEqual([])
    }
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
    const inChains = new Set(Object.values(chains).flatMap(flattenChain).map(node => node.speciesId))
    const fora = species.filter(entry => !inChains.has(entry.id))

    expect(fora.map(entry => entry.slug)).toEqual([])
  })
})

/**
 * A aresta sem condição.
 *
 * `shared/types/dex.ts` nomeia `phione → manaphy` como o caso que *"quem exibe a
 * árvore precisa tratar"*: a PokeAPI entrega essa aresta com `evolution_details`
 * vazio, e o build **relata** em vez de inventar uma condição — é por causa dela
 * que o `via` de `EvolutionNode` é opcional.
 *
 * O resto deste arquivo filtra os `via === undefined` para fora antes de
 * qualquer asserção, então nada provava que a aresta existe nem que a árvore
 * continua inteira com ela. Sem isso, "consertar" o build inventando uma
 * condição passaria por toda a suíte sem reprovar em lugar nenhum.
 */
describe('aresta sem condição', () => {
  // `flattenChain` devolve `[raiz, ...descendentes]`, e a raiz não tem `via` por
  // definição — é o `slice(1)` que deixa só as arestas de verdade.
  const withoutCondition = Object.values(chains)
    .flatMap(root => flattenChain(root).slice(1))
    .filter(node => node.via === undefined)

  it('é exatamente uma em todo o dex, e é phione → manaphy', () => {
    expect(withoutCondition.map(node => node.slug)).toEqual(['manaphy'])
  })

  it('não some da árvore por não ter condição', () => {
    // O modo de falhar que importa: um `v-if="node.via"` no componente, ou um
    // filtro aqui no meio do caminho, tira o manaphy da linha evolutiva do
    // phione — e a página abre com um estágio só, sem erro nenhum.
    const phione = Object.values(chains).find(chain => chain.slug === 'phione')
    expect(phione, 'a cadeia de phione sumiu do dex').toBeDefined()
    if (phione === undefined) return

    const stages = toStages(phione)

    expect(stages).toHaveLength(2)
    expect(stages[1]?.nodes.map(node => node.slug)).toEqual(['manaphy'])
    expect(stages[1]?.nodes[0]?.via).toBeUndefined()
  })
})
