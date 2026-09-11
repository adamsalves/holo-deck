import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { hasExtension, REPO_ROOT, walkFiles } from '../support/source-tree'
import { NAV_ACCOUNT, NAV_DESTINATIONS, NAV_LINKS } from '~~/app/utils/nav-links'

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
 * **Ele importa a lista, e não lê o arquivo.** A primeira versão perguntava
 * `AppNav.vue.includes("'/deck'")`, que é presença de string e não link
 * renderizado: `v-if="false"` em volta do link, um `v-if` de feature flag
 * esquecido, ou a rota citada só num comentário mantinham o portão verde com a
 * tela fora da barra. `NAV_DESTINATIONS` é o mesmo dado que o componente
 * renderiza, e a busca por substring deixou de existir.
 *
 * Ele anda por `app/pages/`, e a lista abaixo é de **saída**: uma página nova
 * cai do lado de dentro por omissão e reprova. É a mesma inversão que a Fase 6
 * fez no portão de tema, pelo mesmo motivo — lista de entrada falha em silêncio.
 */

const PAGES = 'app/pages'
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
 *
 * **`/login` saiu desta lista, e a saída é a correção de um defeito.** Ela estava
 * escrita aqui como exceção, justificada assim: *"quem chega em `/login` vem do
 * convite ou do canto da barra — e, com sessão, do próprio avatar, que a Fase 7
 * ainda vai pôr lá"*. Nenhum dos três existia: nenhum arquivo de `app/` linkava a
 * rota, não havia `signOut` em lugar nenhum do repositório, e nada na interface
 * dizia se havia sessão. Era exatamente o defeito deste portão — a tela no build e
 * fora do alcance de quem joga — passando porque a exceção descrevia o PR
 * seguinte. Agora `/login` é destino de verdade (`NAV_ACCOUNT`, no canto da
 * barra), e o portão voltou a medir em vez de acreditar.
 */
const NOT_A_DESTINATION = (route: string): boolean =>
  route.includes('[') || route.startsWith('/battle')
  || route === '/styleguide'

/** As rotas estáticas que `app/pages/` produz, no formato que o `to=` usa. */
function routes(): string[] {
  return walkFiles(join(REPO_ROOT, PAGES), SKIP, hasExtension(['.vue']))
    .map(file => file.slice(`${PAGES}/`.length).replace(/\.vue$/, ''))
    .map(name => (name === 'index' ? '/' : `/${name.replace(/\/index$/, '')}`))
}

describe('portão da barra global', () => {
  it('encontra as páginas em disco', () => {
    expect(routes().length).toBeGreaterThan(8)
    expect(routes()).toContain('/')
  })

  /**
   * O outro lado da importação: `[] === []` passa, e uma lista que ficasse vazia
   * — refactor que a monta por `map`, arquivo renomeado — deixaria os dois
   * testes abaixo verdes para sempre sem nada a conferir.
   */
  it('e a barra declara destinos', () => {
    expect(NAV_DESTINATIONS.length).toBeGreaterThan(5)
    expect(NAV_LINKS.filter(link => link.exact)).toHaveLength(1)
  })

  /**
   * A conta tem entrada, e **`/login` não é uma das seis seções**.
   *
   * As duas metades são a mesma decisão: jogar nunca exige conta, então a entrada
   * mora no canto direito junto do saldo e da engrenagem, e não entre *Packs* e
   * *Liga*. A primeira asserção é a que reprova se alguém tirar o canto da barra —
   * o estado em que este PR nasceu; a segunda, se a conta virar destino do jogo.
   */
  it('a conta é alcançável, e fora das seções do jogo', () => {
    expect(NAV_ACCOUNT.to).toBe('/login')
    expect(NAV_DESTINATIONS).toContain(NAV_ACCOUNT.to)
    expect(NAV_LINKS.map(link => link.to)).not.toContain(NAV_ACCOUNT.to)
  })

  it('toda tela do jogo está na barra, ou está escrita como exceção', () => {
    const orphans = routes()
      .filter(route => !NOT_A_DESTINATION(route))
      .filter(route => !NAV_DESTINATIONS.includes(route))

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
    const known = new Set(routes())

    expect(NAV_DESTINATIONS.filter(route => !known.has(route))).toEqual([])
  })
})
