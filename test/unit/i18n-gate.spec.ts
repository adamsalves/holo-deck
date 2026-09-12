import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { NAV_ACCOUNT, NAV_LINKS, NAV_RULES, NAV_SETTINGS } from '~~/app/utils/nav-links'
import { REPO_ROOT } from '../support/source-tree'

/**
 * Os dois idiomas dizem as mesmas coisas, e todo rótulo da barra existe nos dois.
 *
 * **Este portão substitui uma garantia do compilador.** Até a Fase 8 os rótulos
 * eram `Record` completo em `shared/` — `RARITY_LABELS`, `TYPE_LABELS` e companhia
 * —, e um tier novo sem rótulo escrito *não compilava*. Tradução mora em JSON, e
 * JSON não tem tipo: o que era erro de compilação passa a ser chave faltando, que
 * aparece na tela como `nav.collection` em vez de *Coleção*. Sem este arquivo, a
 * troca teria afrouxado uma regra em silêncio.
 *
 * **Os locales são lidos do disco, e não importados** — e a diferença não é de
 * gosto. Dentro do Vitest, `import ptBR from '~~/i18n/locales/pt-BR.json'` devolve
 * a mensagem já **compilada** pelo `@intlify/unplugin-vue-i18n` que o
 * `@nuxtjs/i18n` instala no Vite: cada rótulo chega como nó de AST, com `type`,
 * `loc` e `body`, e `nav.base` deixa de existir como chave — viram
 * `nav.base.loc.start.line` e companhia. Medido nos dois lados: o mesmo import em
 * `node` puro devolve `'Base'`. A primeira versão deste portão importava, e
 * reprovava dizendo que nenhum rótulo da barra era traduzido — portão que reprova
 * com o código certo não mede nada, igual ao que passa com o código errado.
 *
 * Ler o arquivo também mede a coisa certa: o que o tradutor escreve, não o que o
 * bundler produz. É o que `rules-gate` e `generated-dex` já fazem.
 */

const LOCALE_DIR = join(REPO_ROOT, 'i18n/locales')

/**
 * O locale como dado cru.
 *
 * `JSON.parse` devolve `any`, que é por onde o `any` entrou na Fase 0 — ele entra
 * anotado como `unknown` e só passa adiante pelas guardas abaixo, que é o padrão
 * das outras sete fronteiras de parse deste repositório.
 */
function readLocale(fileName: string): unknown {
  const parsed: unknown = JSON.parse(readFileSync(join(LOCALE_DIR, fileName), 'utf8'))

  return parsed
}

/** Aceita objeto e recusa array e `null`, que `typeof` chama de `'object'`. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Toda folha do arquivo, como `[chave em notação de ponto, valor cru]`.
 *
 * Devolve o **valor** junto da chave de propósito: a primeira versão colhia só
 * chaves e checava vazio procurando o primeiro `string` entre os locales com
 * `.find`, que para no primeiro. Um rótulo vazio só no inglês passava, porque o
 * português respondia antes e não estava vazio. Par por par, cada locale é medido
 * por si.
 *
 * Recursivo porque o arquivo é aninhado e vai aninhar mais: comparar só o primeiro
 * nível diria que dois locales combinam quando um deles tem `nav` pela metade.
 */
function leafEntries(value: unknown, prefix = ''): [string, unknown][] {
  if (!isRecord(value)) return [[prefix, value]]

  return Object.entries(value).flatMap(([key, child]) => (
    leafEntries(child, prefix === '' ? key : `${prefix}.${key}`)
  ))
}

/**
 * Os locales, nomeados — o nome entra na mensagem de erro.
 *
 * A lista é montada do **disco**, e não escrita à mão: um idioma novo em
 * `i18n/locales/` é medido por existir. Uma lista de entrada aqui deixaria o
 * terceiro locale fora de todas as asserções abaixo, em silêncio, que é o modo de
 * falhar que este repositório já pagou cinco vezes.
 */
const LOCALES: readonly (readonly [string, unknown])[] = readdirSync(LOCALE_DIR)
  .filter(name => name.endsWith('.json'))
  // Ordem alfabética para a mensagem de erro ser estável entre máquinas.
  .sort()
  .map(fileName => [fileName.replace(/\.json$/, ''), readLocale(fileName)] as const)

/** Toda chave que a barra global pede, montada dos próprios exports. */
const NAV_KEYS: readonly string[] = [
  ...NAV_LINKS,
  NAV_RULES,
  NAV_SETTINGS,
  NAV_ACCOUNT,
].map(link => link.label)

describe('paridade entre os locales', () => {
  /**
   * O outro lado da comparação: sem esta asserção, dois arquivos vazios têm
   * conjuntos idênticos e o portão dá verde sem nada para comparar. E um diretório
   * vazio deixaria o laço de paridade sem iteração nenhuma.
   */
  it('tem locale e chave para comparar', () => {
    expect(LOCALES.length).toBeGreaterThan(1)

    for (const [nome, locale] of LOCALES) {
      expect(leafEntries(locale).length, `o locale ${nome} está vazio`).toBeGreaterThan(0)
    }
  })

  /**
   * Conjunto, e não contagem: dois locales com o mesmo **número** de chaves e
   * nomes diferentes passariam por uma comparação de tamanho. Foi assim que o
   * `motion-gate` fingiu medir por duas fases.
   */
  it('diz as mesmas coisas em todos os idiomas', () => {
    const [referencia, ...resto] = LOCALES
    if (referencia === undefined) throw new Error('nenhum locale em i18n/locales/')

    const esperado = leafEntries(referencia[1]).map(([chave]) => chave).sort()

    for (const [nome, locale] of resto) {
      const chaves = leafEntries(locale).map(([chave]) => chave).sort()

      expect(chaves, `o locale ${nome} divergiu de ${referencia[0]}`).toEqual(esperado)
    }
  })

  /**
   * Chave que existe e não diz nada é o mesmo defeito que chave faltando, e passa
   * pela comparação de conjuntos — os dois lados a têm.
   */
  it('não deixa rótulo vazio passar por existir', () => {
    for (const [nome, locale] of LOCALES) {
      const problemas = leafEntries(locale)
        .filter(([, valor]) => typeof valor !== 'string' || valor.trim() === '')
        .map(([chave]) => `${nome}:${chave}`)

      expect(problemas).toEqual([])
    }
  })
})

describe('rótulos da barra global', () => {
  /**
   * A lista sai dos exports de `nav-links`, nunca escrita à mão: um destino novo
   * na barra entra nesta varredura por existir, que é a inversão que o `nav-gate`
   * e o e2e da barra já aplicam.
   *
   * Sem contagem fixa de propósito — um destino novo é mudança legítima, e portão
   * que cobra o número de hoje reprova quem acerta.
   */
  it('resolve toda chave da barra em todos os idiomas', () => {
    expect(NAV_KEYS.length).toBeGreaterThan(0)

    for (const [nome, locale] of LOCALES) {
      const chaves = new Set(leafEntries(locale).map(([chave]) => chave))
      const faltando = NAV_KEYS.filter(chave => !chaves.has(chave))

      expect(faltando, `o locale ${nome} não traduz estes rótulos da barra`).toEqual([])
    }
  })

  it('mantém toda chave da barra no namespace `nav`', () => {
    expect(NAV_KEYS.filter(chave => !chave.startsWith('nav.'))).toEqual([])
  })
})
