import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { hasExtension, REPO_ROOT, walkFiles } from '../support/source-tree'

/**
 * Toda tela do jogo é alcançável pela barra global — ou está escrita aqui como
 * exceção.
 *
 * **O defeito desta família já aconteceu duas vezes neste repositório.** Na Fase
 * 3 a raiz não levava à Pokédex; na Fase 5 a quarta porta entrou e o teste que
 * as guardava continuou verificando três, ainda chamado "três telas". Nos dois
 * casos a tela existia no build, passava em todo portão, e não existia para quem
 * joga.
 *
 * O que muda agora é o mecanismo: até o PR anterior a lista de destinos era
 * escrita à mão no Hub, e o portão só podia comparar duas listas escritas à mão.
 * Com a barra, a pergunta certa é outra — **quais rotas existem em disco**, e
 * qual delas a barra não cita.
 *
 * Ele anda por `app/pages/`, e a lista abaixo é de **saída**: uma página nova
 * cai do lado de dentro por omissão e reprova. É a mesma inversão que a Fase 6
 * fez no portão de tema, pelo mesmo motivo — lista de entrada falha em silêncio.
 */

const PAGES = 'app/pages'
const NAV = 'app/components/AppNav.vue'
const SKIP = new Set(['node_modules'])

/**
 * Quem sai da barra, e por quê.
 *
 * - **Rota dinâmica** (`[gymId]`, `[name]`, `[gen]`) não é destino: não existe
 *   um `/pokemon/[name]` para linkar, e quem chega lá vem de uma carta.
 * - **`/battle`** é a prancha *Batalha* decidindo: ela desenha uma barra própria
 *   — ginásio, líder, região e tipo — no lugar dos seis destinos, e a saída de
 *   uma luta em andamento é a faixa de retomar do Hub, não um link.
 * - **`/styleguide`** é o espelho do sistema de design, não uma tela do jogo.
 *   Ela também é a única que pede `layout: false` sem ser a batalha.
 */
const NOT_A_DESTINATION = (route: string): boolean =>
  route.includes('[') || route.startsWith('/battle') || route === '/styleguide'

/** As rotas estáticas que `app/pages/` produz, no formato que o `to=` usa. */
function routes(): string[] {
  return walkFiles(join(REPO_ROOT, PAGES), SKIP, hasExtension(['.vue']))
    .map(file => file.slice(`${PAGES}/`.length).replace(/\.vue$/, ''))
    .map(name => (name === 'index' ? '/' : `/${name.replace(/\/index$/, '')}`))
}

const nav = readFileSync(join(REPO_ROOT, NAV), 'utf8')

/** `to="/deck"` e `:to="link.to"` não são a mesma coisa — só o literal conta. */
function linked(route: string): boolean {
  return nav.includes(`'${route}'`) || nav.includes(`to="${route}"`)
}

describe('portão da barra global', () => {
  it('encontra as páginas em disco', () => {
    expect(routes().length).toBeGreaterThan(8)
    expect(routes()).toContain('/')
  })

  it('toda tela do jogo está na barra, ou está escrita como exceção', () => {
    const orphans = routes()
      .filter(route => !NOT_A_DESTINATION(route))
      .filter(route => !linked(route))

    expect(orphans).toEqual([])
  })

  /**
   * O outro lado: a barra não pode citar uma rota que não existe.
   *
   * É o defeito que segurou a barra até este PR — ela liga `/rules` e
   * `/settings`, e ligá-los antes de as páginas existirem seria um 404 na
   * navegação principal do jogo.
   */
  it('e a barra não aponta para tela que não existe', () => {
    const declared = [...nav.matchAll(/to: '([^']+)'|to="([^"]+)"/g)]
      .map(([, quoted, attribute]) => quoted ?? attribute ?? '')
      .map(route => route.split('?')[0] ?? route)
      .filter(route => route.startsWith('/'))

    const known = new Set(routes())
    expect([...new Set(declared)].filter(route => !known.has(route))).toEqual([])
  })
})
