import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AA_LARGE, AA_NORMAL, contrastRatio } from '~~/shared/color/contrast'
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
        .filter(name => /^--text(?:-[\w-]+)?$/.test(name)),
    )

    // Um papel novo entrar no tema e não entrar na matriz seria um papel sem
    // piso — legível por acaso, não por decisão.
    expect([...declarados].sort()).toEqual(TEXT_ROLES.map(r => r.token).sort())
  })

  it('mantém os papéis legíveis sobre TODA superfície, não só sobre o fundo', () => {
    const source = themeSource()
    const fundos = surfaces(source)

    expect(fundos.length, 'nenhuma superfície encontrada no tema').toBeGreaterThan(1)

    const reprovam = TEXT_ROLES.flatMap(({ token, minimum }) => {
      const hex = resolveToken(token, source)
      expect(hex, `${token} não resolve em cor`).not.toBeNull()

      return fundos.flatMap((fundo) => {
        const ratio = contrastRatio(hex ?? '', fundo.value)
        return ratio >= minimum ? [] : [`${token} sobre ${fundo.name} → ${ratio.toFixed(2)} (mínimo ${minimum})`]
      })
    })

    // O par que reprovava antes deste portão existir: `--text-faint` sobre
    // `--surface-raised`, a 2.84 — o topo do gradiente de toda carta.
    expect(reprovam, 'papel de texto abaixo do piso em alguma superfície').toEqual([])
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
   * O que o sistema **não** garante, escrito em vez de descoberto na Fase 4.
   *
   * As 18 cores foram escolhidas contra `ink-950`, e nem todas sobrevivem a uma
   * superfície mais clara: `dragon` cai a 3.99 sobre `--surface-raised`. Isso não
   * é defeito hoje — a cor de tipo é preenchimento (chip, brilho, barra) e o
   * único texto que ela carrega é sobre `--bg`. Vira defeito no dia em que o log
   * de batalha escrever o nome do tipo colorido dentro de um painel.
   *
   * A lista fica aqui e é exata: se uma cor nova entrar reprovando, ou se
   * `dragon` for corrigida, o portão reprova e alguém decide de novo — em vez de
   * a exceção crescer sozinha.
   */
  it('registra quais tipos não sustentam texto sobre painel', () => {
    const source = themeSource()
    const paineis = surfaces(source).filter(fundo => fundo.name !== '--bg')

    const soSobreOFundo = TYPE_NAMES.filter((type) => {
      const hex = resolveToken(`--color-type-${type}`, source) ?? ''
      return paineis.some(fundo => contrastRatio(hex, fundo.value) < AA_NORMAL)
    })

    expect(soSobreOFundo, 'tipos que só sustentam texto sobre `--bg`').toEqual(['dragon'])
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
