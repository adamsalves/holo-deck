import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AA_LARGE, AA_NORMAL, NON_TEXT, contrastRatio } from '~~/shared/color/contrast'
import { TYPE_NAMES } from '~~/shared/types/dex'
import { hasFoil, RARITY_NAMES } from '~~/shared/types/game'
import { hasExtension, REPO_ROOT, walkFiles } from '../support/source-tree'
import { blockFor, declarationIn, declarations, resolveToken, themeSource } from '../support/theme'

/**
 * O tema, verificado contra o arquivo que vai para produção.
 *
 * Duas coisas se perdem sozinhas num design system: a cobertura (um tipo novo
 * entra no contrato e ninguém lembra da cor) e o contraste (um papel de texto é
 * repontado para um degrau que não sustenta texto). As duas são mensuráveis, e
 * nenhuma é visível em review de diff.
 */

/**
 * As superfícies são **descobertas**, não listadas.
 *
 * A primeira versão deste portão media tudo contra um `#0B0D14` escrito à mão,
 * apoiada em "existe um fundo só". A premissa morreu na mesma fase que a
 * escreveu — esta é a fase que declarou cinco superfícies —, e com ela o portão
 * passou a medir um fundo sobre o qual nenhum texto de carta é renderizado.
 * Descobrir os nomes no próprio tema é o que impede a lista de envelhecer: uma
 * superfície nova entra na matriz sem ninguém lembrar de acrescentá-la.
 */
function surfaces(source: string): { name: string, value: string }[] {
  const names = [...new Set(
    declarations(source)
      .map(({ name }) => name)
      .filter(name => /^--(?:bg|surface(?:-[\w-]+)?)$/.test(name)),
  )]

  return names.map(name => ({ name, value: resolveToken(name, source) ?? '' }))
}

/**
 * Os quatro papéis de texto e o piso de cada um, **na ordem da hierarquia**.
 *
 * `--text-faint` é o único com piso de texto grande, e é uma decisão: ele é nota
 * de rodapé, não corpo. Quem o usar em texto pequeno está errado do lado do
 * componente — ver `.poke-card__number`, que foi assim e deixou de ser.
 */
const TEXT_ROLES = [
  { token: '--text', minimum: AA_NORMAL },
  { token: '--text-body', minimum: AA_NORMAL },
  { token: '--text-muted', minimum: AA_NORMAL },
  { token: '--text-faint', minimum: AA_LARGE },
]

/**
 * Os papéis de cor que **não** se chamam `--text-*` e mesmo assim carregam
 * texto ou fronteira.
 *
 * A matriz cobria só o que casava `^--text(-…)?$`, e a Fase 3 introduziu dois
 * que não casam: `--accent`, que pinta texto em quatro arquivos
 * (`index.vue`, `[gen].vue`, `[name].vue`, `DexFilters.vue`), e `--focus`, que é
 * o anel de foco de `DexCard` e `DexFilters`. Os dois passavam — mas passavam
 * por acaso, que é exatamente a condição que o teste de cobertura abaixo diz
 * não aceitar. O piso difere pelo papel: texto é AA normal, contorno de
 * componente é o 3:1 do critério 1.4.11.
 */
const UI_ROLES = [
  { token: '--accent', minimum: AA_NORMAL },
  { token: '--focus', minimum: NON_TEXT },
  /**
   * O degrau alto do progresso carrega **texto**, e não só barra: a prancha
   * *Pokédex* escreve o `98` de `98 / 151 capturados` e o `GERAÇÃO I` do
   * cabeçalho nele. Os dois de baixo só preenchem barra, e o piso deles é o 3:1
   * do critério 1.4.11 — mas os dois apontam para tokens que já passam AA por
   * outro papel, então o piso baixo aqui é o teto do que eles precisam, não uma
   * concessão.
   */
  { token: '--progress-high', minimum: AA_NORMAL },
  { token: '--progress-mid', minimum: NON_TEXT },
  { token: '--progress-low', minimum: NON_TEXT },
  /**
   * Os três papéis que a Fase 5 promoveu de primitivo a nome. Todos carregam
   * texto: `--shiny` na etiqueta SHINY e na contagem do cabeçalho, `--forge` no
   * título do painel, `--deficit` no `custa 1.600 pó` que o jogador não pode
   * pagar.
   */
  { token: '--shiny', minimum: AA_NORMAL },
  { token: '--forge', minimum: AA_NORMAL },
  { token: '--deficit', minimum: AA_NORMAL },
]

/** Todo papel de cor que a matriz de contraste cobra, seja qual for o nome. */
const COLOR_ROLES = [...TEXT_ROLES, ...UI_ROLES]

describe('cobertura da paleta', () => {
  it('dá cor e escopo a cada um dos 18 tipos do contrato', () => {
    const source = themeSource()

    const semCor = TYPE_NAMES.filter(type => resolveToken(`--color-type-${type}`, source) === null)
    const semEscopo = TYPE_NAMES.filter(type => !source.includes(`[data-type="${type}"]`))

    // A lista canônica é a de `shared/types/dex.ts`. Um tipo entrar lá e não
    // entrar aqui é o defeito que este teste existe para pegar — o componente
    // renderiza, só que sem cor nenhuma, e nada acusa.
    expect(semCor, 'tipos sem token de cor').toEqual([])
    expect(semEscopo, 'tipos sem regra [data-type]').toEqual([])
  })

  it('dá escopo a cada uma das 6 raridades', () => {
    const source = themeSource()

    // `common` é o default do bloco `[data-rarity]`, então não tem seletor
    // próprio — e é assim de propósito: comum não se anuncia.
    const comSeletorProprio = RARITY_NAMES.filter(rarity => rarity !== 'common')
    const semEscopo = comSeletorProprio.filter(r => !source.includes(`[data-rarity="${r}"]`))

    expect(semEscopo, 'raridades sem regra [data-rarity]').toEqual([])
    expect(resolveToken('--rarity', source), 'o bloco base precisa publicar --rarity').not.toBeNull()
  })

  it('mantém a escada de chanfro nos quatro degraus com papel', () => {
    const source = themeSource()

    for (const step of ['card', 'tile', 'chip', 'control']) {
      expect(resolveToken(`--bevel-${step}`, source), `--bevel-${step}`).toMatch(/^\d+px$/)
    }
  })

  it('entrega o raio ao Nuxt UI, e não só ao Tailwind', () => {
    const source = themeSource()

    // O Nuxt UI reencaixa a escala inteira do Tailwind na dele
    // (`--radius-sm: var(--ui-radius)`, `--radius-md: calc(var(--ui-radius) * 1.5)`),
    // então todo `rounded-*` de componente deriva de `--ui-radius`. Sem este
    // mapeamento o `--radius` do tema fica declarado e inerte, e o `UButton`
    // continua no raio de fábrica — que é a "cara de template" que plugar no
    // Nuxt UI existe para evitar.
    expect(resolveToken('--ui-radius', source)).toBe(resolveToken('--radius', source))
    expect(resolveToken('--radius', source), '--radius').toMatch(/^\d+px$/)
  })
})

describe('contraste do tema', () => {
  it('cobre todo papel de texto que o tema declara', () => {
    const declarados = new Set(
      declarations(themeSource())
        .map(({ name }) => name)
        .filter(name => /^--(?:text(?:-[\w-]+)?|accent|focus|progress-(?:high|mid|low)|shiny|forge|deficit)$/.test(name)),
    )

    // Um papel novo entrar no tema e não entrar na matriz seria um papel sem
    // piso — legível por acaso, não por decisão. O padrão lista os nomes que
    // não são `--text-*` um a um, de propósito: um papel de cor novo precisa
    // aparecer aqui **e** em `COLOR_ROLES`, e é o segundo passo que escolhe o
    // piso dele.
    expect([...declarados].sort()).toEqual(COLOR_ROLES.map(r => r.token).sort())
  })

  it('mantém os papéis legíveis sobre TODA superfície, não só sobre o fundo', () => {
    const source = themeSource()
    const fundos = surfaces(source)

    expect(fundos.length, 'nenhuma superfície encontrada no tema').toBeGreaterThan(1)

    const reprovam = COLOR_ROLES.flatMap(({ token, minimum }) => {
      const hex = resolveToken(token, source)
      expect(hex, `${token} não resolve em cor`).not.toBeNull()

      return fundos.flatMap((fundo) => {
        const ratio = contrastRatio(hex ?? '', fundo.value)
        return ratio >= minimum ? [] : [`${token} sobre ${fundo.name} → ${ratio.toFixed(2)} (mínimo ${minimum})`]
      })
    })

    // O par que reprovava antes deste portão existir: `--text-faint` sobre
    // `--surface-raised`, a 2.84 — o topo do gradiente de toda carta.
    expect(reprovam, 'papel de cor abaixo do piso em alguma superfície').toEqual([])
  })

  it('mantém a hierarquia visível em toda superfície, e não só legível', () => {
    const source = themeSource()
    const cores = TEXT_ROLES.map(({ token }) => resolveToken(token, source) ?? '')

    const colados = surfaces(source).flatMap((fundo) => {
      const razoes = cores.map(cor => contrastRatio(cor, fundo.value))

      // Estritamente decrescente: dois papéis com a mesma força são um papel só.
      // É o que descartou pôr `--text-muted` em `ink-300` (5.79 sobre `ink-800`,
      // contra os 6.43 do corpo) e o que fez `ink-325` entrar na escada.
      return razoes.flatMap((razao, i) => {
        if (i === 0) return []
        const anterior = razoes[i - 1] ?? 0
        return anterior - razao > 1
          ? []
          : [`${TEXT_ROLES[i - 1]?.token} → ${TEXT_ROLES[i]?.token} sobre ${fundo.name}: ${anterior.toFixed(2)} → ${razao.toFixed(2)}`]
      })
    })

    expect(colados, 'papéis de texto sem separação visível').toEqual([])
  })

  it('mantém o rótulo de raridade legível sobre a carta', () => {
    const source = themeSource()

    // O rótulo mora na carta, que é o gradiente `--surface-raised` →
    // `--surface-cell`. Medi-lo contra o fundo da página seria o mesmo erro de
    // fundo que os papéis de texto tinham.
    const fundos = ['--surface-raised', '--surface-cell']
      .map(name => ({ name, value: resolveToken(name, source) ?? '' }))

    const reprovam = RARITY_NAMES.flatMap((rarity) => {
      const bloco = rarity === 'common' ? '[data-rarity]' : `[data-rarity="${rarity}"]`
      const block = blockFor(bloco, source)
      expect(block, `bloco de ${rarity}`).not.toBeNull()

      const declarado = declarationIn(block ?? '', '--rarity-label')
      // `mythic` pinta o rótulo com a varredura recortada no texto, não com cor.
      if (declarado === null && rarity === 'mythic') return []
      expect(declarado, `${rarity} não publica --rarity-label`).not.toBeNull()

      const hex = resolveToken(/^var\(\s*(--[\w-]+)\s*\)$/.exec(declarado ?? '')?.[1] ?? '', source)
        ?? resolveToken('--rarity-label', source)

      return fundos.flatMap((fundo) => {
        const ratio = contrastRatio(hex ?? '', fundo.value)
        return ratio >= AA_NORMAL ? [] : [`${rarity} sobre ${fundo.name} → ${ratio.toFixed(2)}`]
      })
    })

    expect(reprovam, 'rótulo de raridade abaixo do AA na carta').toEqual([])
  })

  it('mantém a etiqueta de tipo legível — a cor é fundo, e o texto é `--bg`', () => {
    const source = themeSource()
    const fundo = resolveToken('--bg', source) ?? ''

    // Este é o par que existe hoje, em `TypeBadge`: a cor do tipo preenche o
    // chip e o texto é o fundo da página por cima. O contraste é simétrico, então
    // o mesmo número cobre o outro uso — tipo como texto sobre `--bg`, que é o
    // cabeçalho de região.
    const reprovam = TYPE_NAMES.flatMap((type) => {
      const hex = resolveToken(`--color-type-${type}`, source) ?? ''
      const ratio = contrastRatio(hex, fundo)
      return ratio >= AA_NORMAL ? [] : [`${type} → ${ratio.toFixed(2)}`]
    })

    expect(reprovam, 'tipos abaixo do AA na etiqueta').toEqual([])
  })

  /**
   * Toda cor de tipo sustenta texto sobre **toda** superfície — o registro de
   * exceção virou invariante na Fase 6.
   *
   * Até a Fase 5 este teste era uma lista: `['dragon']`, a única cor que reprovava
   * AA sobre painel (3.99 em `--surface-raised`, 4.39 em `--surface`). Não era
   * defeito enquanto a cor de tipo fosse só preenchimento — chip, brilho, barra —
   * e o único texto que ela carregasse caísse sobre `--bg`.
   *
   * A Fase 6 é quem estreia o consumidor que a lista previa: o painel de cobertura
   * do `/deck` escreve o nome do tipo como texto sobre `--surface`. A saída foi
   * clarear `dragon` (+3 pontos de L), e não restringir o consumidor à superfície
   * escura onde a cor original passa — porque a segunda obrigaria este portão a
   * saber em qual superfície cada texto cai, sem traçar a cascata. É o defeito
   * recorrente deste repositório, e não vale plantá-lo de propósito.
   *
   * Com a lista vazia a regra é mecânica: **18 tipos × toda superfície ≥ AA**. Um
   * tipo novo, uma superfície nova ou uma cor repontada reprovam sozinhos, e a
   * mensagem nomeia o par e a razão — sem isso, "algo reprovou" custa uma sessão
   * de bisseção. Isso cobre também o par da etiqueta que o teste acima mede, já
   * que `--bg` é uma das superfícies descobertas.
   *
   * Ver a issue #11 e a nota em `--color-type-dragon`.
   */
  it('mantém as 18 cores de tipo acima do AA em toda superfície', () => {
    const source = themeSource()
    const fundos = surfaces(source)

    const reprovam = TYPE_NAMES.flatMap(type => fundos.flatMap((fundo) => {
      const hex = resolveToken(`--color-type-${type}`, source) ?? ''
      const ratio = contrastRatio(hex, fundo.value)
      return ratio >= AA_NORMAL ? [] : [`${type} sobre ${fundo.name} → ${ratio.toFixed(2)}`]
    }))

    expect(reprovam, 'pares tipo × superfície abaixo do AA').toEqual([])
  })
})

describe('a regra do foil, escrita uma vez só', () => {
  it('acende o brilho exatamente nas raridades que `hasFoil` aceita', () => {
    const source = themeSource()

    // `hasFoil()` decide se a camada existe no DOM; `--foil-strength` decide se
    // ela aparece. São a mesma regra em duas linguagens, e sem este portão
    // mudar `FOIL_FROM_RARITY` deixa o CSS para trás em silêncio: a carta perde
    // a camada e mantém a opacidade, ou ganha a camada e nasce invisível.
    const divergem = RARITY_NAMES.flatMap((rarity) => {
      const proprio = blockFor(`[data-rarity="${rarity}"]`, source)
      const base = blockFor('[data-rarity]', source) ?? ''

      const declarado = (proprio === null ? null : declarationIn(proprio, '--foil-strength'))
        ?? declarationIn(base, '--foil-strength')

      const forca = Number(declarado)
      expect(Number.isFinite(forca), `${rarity}: --foil-strength não é número`).toBe(true)

      const aceso = forca > 0
      return aceso === hasFoil(rarity)
        ? []
        : [`${rarity}: hasFoil=${hasFoil(rarity)} mas --foil-strength=${declarado}`]
    })

    expect(divergem, 'o CSS e `shared/types/game.ts` discordam sobre o foil').toEqual([])
  })
})

/**
 * Token declarado e nunca lido.
 *
 * A camada semântica é a API pública do sistema, e um papel sem leitor é receita
 * não verificada — foi o caso de `--rarity-fill`, que trazia meia dúzia de linhas
 * de justificativa e nenhum consumidor. Este portão só olha o que está **fora**
 * de `@theme`: os primitivos de lá são lidos pelo gerador de utilitários do
 * Tailwind, não por `var()`, e cobrá-los daria falso positivo.
 */
const RESERVADOS = [
  // Declarado agora, com leitor na Fase 6 (coluna lateral, log de turno). Fica
  // escrito aqui, e não escondido, para a exceção ser uma decisão e não um
  // esquecimento — a próxima que aparecer reprova até alguém decidir.
  '--surface-sunken',

  // Papel de texto grande, e a Fase 2 não tem nenhum. Note que ele **não** pode
  // ser emprestado ao `--ui-text-dimmed` do Nuxt UI para arrumar consumidor:
  // `dimmed` é slot de texto pequeno, e sobre `--surface-raised` este degrau dá
  // 4.02 — abaixo do AA. Um papel sem uso é melhor que um papel usado errado.
  '--text-faint',
]

describe('a camada semântica não tem token órfão', () => {
  it('todo token declarado fora de @theme tem quem o leia', () => {
    const source = themeSource()
    const semantic = source.slice(source.indexOf('[data-type='))

    const declarados = [...new Set(declarations(semantic).map(({ name }) => name))]
      // `--ui-*` são lidos pelo Nuxt UI, e `--bevel` pelo próprio `@utility`.
      .filter(name => !name.startsWith('--ui-') && name !== '--bevel')
      .filter(name => !RESERVADOS.includes(name))

    // Anda pelo disco pelo mesmo motivo dos outros portões: componente novo
    // aparece toda fase, e uma lista de arquivos escrita à mão não o alcança.
    const lidos = new Set<string | undefined>()
    const fontes = [source, ...walkFiles(join(REPO_ROOT, 'app'), new Set(['node_modules']), hasExtension(['.vue', '.ts', '.css']))
      .map(file => readFileSync(join(REPO_ROOT, file), 'utf8'))]

    for (const texto of fontes) {
      for (const hit of texto.matchAll(/var\(\s*(--[\w-]+)/g)) lidos.add(hit[1])
    }

    expect(declarados.filter(name => !lidos.has(name)), 'tokens declarados e nunca lidos').toEqual([])
  })
})
