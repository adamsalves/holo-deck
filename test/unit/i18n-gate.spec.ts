import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { NAV_ACCOUNT, NAV_LINKS, NAV_RULES, NAV_SETTINGS } from '~~/app/utils/nav-links'
import { leafEntries, localeCodes, readLocale } from '../support/locales'
import { hasExtension, REPO_ROOT, stripComments, walkFiles } from '../support/source-tree'

/**
 * Os dois idiomas dizem as mesmas coisas, e cada chave tem exatamente um dono
 * dos dois lados: nada que a tela peça falta, nada que o arquivo traga sobra.
 *
 * **Este portão substitui uma garantia do compilador.** Até a Fase 8 os rótulos
 * eram `Record` completo em `shared/` — `RARITY_LABELS`, `TYPE_LABELS` e
 * companhia —, e um tier novo sem rótulo escrito *não compilava*. Tradução mora
 * em JSON, e JSON não tem tipo: o que era erro de compilação passa a ser chave
 * faltando, que aparece na tela como `nav.collection` em vez de *Coleção*. Sem
 * este arquivo, a troca teria afrouxado uma regra em silêncio.
 *
 * **A primeira versão dele guardava só metade, e a metade mais fácil.** Ela
 * comparava os locales entre si e resolvia as chaves da barra, e passava verde
 * com `nav.ghost` acrescentada aos dois arquivos sem nenhum código a usar —
 * provado plantando o defeito. Chave órfã é o defeito que **cresce** nos PRs 2 a
 * 4, quando as chaves passarem de nove para dezenas e ninguém lembrar quais
 * telas foram embora. O contrato da fase pedia as duas metades; agora elas
 * estão aqui.
 *
 * A leitura dos locales mora em `test/support/locales.ts`, com o motivo de ela
 * ser feita do disco e não por `import`.
 */

/** Os locales, nomeados — o nome entra na mensagem de erro. */
const LOCALES: readonly (readonly [string, unknown])[] = localeCodes()
  .map(code => [code, readLocale(code)] as const)

/** Toda chave que a barra global pede, montada dos próprios exports. */
const NAV_KEYS: readonly string[] = [
  ...NAV_LINKS,
  NAV_RULES,
  NAV_SETTINGS,
  NAV_ACCOUNT,
].map(link => link.label)

/**
 * Toda chave citada literalmente em `app/`, varrida do disco.
 *
 * O comentário é apagado antes da varredura (`stripComments`): chave que só
 * aparece num docblock **não** é uso, e contá-la deixaria uma tradução morta
 * viva para sempre por estar mencionada na prosa que explica por que ela morreu.
 *
 * A expressão exige o ponto do namespace e recusa `t` precedido de letra, senão
 * `format('…')` e `at('…')` entram como chave. Uma chave sem ponto escapa daqui
 * — e cai na asserção de órfã como falha ruidosa, que é o lado certo de errar.
 */
function literalKeys(): string[] {
  const files = walkFiles(
    join(REPO_ROOT, 'app'),
    new Set(['node_modules']),
    hasExtension(['.vue', '.ts']),
  )

  return files.flatMap((relativePath) => {
    const source = stripComments(readFileSync(join(REPO_ROOT, relativePath), 'utf8'))

    return [...source.matchAll(/(?<![A-Za-z0-9_])\$?t\(\s*(['"])([\w]+(?:\.[\w]+)+)\1/g)]
      .map(match => match[2])
      .filter((key): key is string => key !== undefined)
  })
}

/**
 * O que a tela pede: chave escrita à mão mais chave resolvida por variável.
 *
 * `t(link.label)` não é literal e nenhuma varredura de texto o alcança — por
 * isso a união com `NAV_KEYS`, que sai dos exports de `nav-links`. É a mesma
 * inversão do resto do portão: a lista vem da fonte, não de uma cópia.
 */
const USED_KEYS: ReadonlySet<string> = new Set([...literalKeys(), ...NAV_KEYS])

describe('paridade entre os locales', () => {
  /**
   * O outro lado da comparação: sem esta asserção, dois arquivos vazios têm
   * conjuntos idênticos e o portão dá verde sem nada para comparar. E um
   * diretório vazio deixaria o laço de paridade sem iteração nenhuma.
   */
  it('tem locale e chave para comparar', () => {
    expect(LOCALES.length).toBeGreaterThan(1)

    for (const [name, locale] of LOCALES) {
      expect(leafEntries(locale).length, `o locale ${name} está vazio`).toBeGreaterThan(0)
    }
  })

  /**
   * Conjunto, e não contagem: dois locales com o mesmo **número** de chaves e
   * nomes diferentes passariam por uma comparação de tamanho. Foi assim que o
   * `motion-gate` fingiu medir por duas fases.
   */
  it('diz as mesmas coisas em todos os idiomas', () => {
    const [reference, ...rest] = LOCALES
    if (reference === undefined) throw new Error('nenhum locale em i18n/locales/')

    const expected = leafEntries(reference[1]).map(([key]) => key).sort()

    for (const [name, locale] of rest) {
      const keys = leafEntries(locale).map(([key]) => key).sort()

      expect(keys, `o locale ${name} divergiu de ${reference[0]}`).toEqual(expected)
    }
  })

  /**
   * Chave que existe e não diz nada é o mesmo defeito que chave faltando, e passa
   * pela comparação de conjuntos — os dois lados a têm.
   */
  it('não deixa rótulo vazio passar por existir', () => {
    for (const [name, locale] of LOCALES) {
      const problems = leafEntries(locale)
        .filter(([, value]) => typeof value !== 'string' || value.trim() === '')
        .map(([key]) => `${name}:${key}`)

      expect(problems).toEqual([])
    }
  })
})

describe('as chaves e quem as usa', () => {
  /**
   * O outro lado da varredura: se a expressão quebrar, `literalKeys()` volta
   * vazio, `USED_KEYS` fica sendo só `NAV_KEYS`, e as duas asserções abaixo
   * passam sem medir nada. Exigir mais chaves do que a barra tem é o que torna
   * isso visível — a barra resolve as dela por variável, então toda chave
   * literal encontrada veio mesmo da varredura.
   */
  it('acha chave literal além das da barra', () => {
    expect(NAV_KEYS.length).toBeGreaterThan(0)
    expect(USED_KEYS.size).toBeGreaterThan(NAV_KEYS.length)
  })

  /** Chave pedida e não traduzida vira o próprio nome dela na tela. */
  it('traduz toda chave que o código usa', () => {
    for (const [name, locale] of LOCALES) {
      const keys = new Set(leafEntries(locale).map(([key]) => key))
      const missing = [...USED_KEYS].filter(key => !keys.has(key)).sort()

      expect(missing, `o locale ${name} não traduz estas chaves`).toEqual([])
    }
  })

  /**
   * E o inverso, que é o que a primeira versão deixou passar: tradução que
   * nenhuma tela pede é peso que envelhece calado, e some do radar exatamente
   * quando o arquivo cresce.
   */
  it('não deixa chave órfã no locale', () => {
    for (const [name, locale] of LOCALES) {
      const orphans = leafEntries(locale)
        .map(([key]) => key)
        .filter(key => !USED_KEYS.has(key))
        .sort()

      expect(orphans, `o locale ${name} traz chaves que nenhuma tela usa`).toEqual([])
    }
  })

  it('mantém toda chave da barra no namespace `nav`', () => {
    expect(NAV_KEYS.filter(key => !key.startsWith('nav.'))).toEqual([])
  })
})
