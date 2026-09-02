import type { ChainsData, CoreData, FlavorData, GenerationData, IndexData, SearchEntry } from '~~/shared/types/dex'
import { isChainsData, isCoreData, isFlavorData, isGenerationData, isIndexData } from '~~/shared/types/dex'

/**
 * Leitura do dex gerado em `public/data/`.
 *
 * Nada aqui chama a PokeAPI: os arquivos são artefato commitado de
 * `scripts/build-dex.ts`, e é isso que permite grid de 1025 cartas, evolução sem
 * requisição e o modo offline da Fase 8.
 *
 * O carregamento é **por geração**, sob demanda. O dex inteiro são 448 KB de
 * JSON mais 144 KB de descrições; puxar tudo para abrir Kanto seria pagar 9
 * gerações para ver uma — a maior das gerações são 48 KB. `flavor-N.json` é
 * separado pelo mesmo motivo: o grid precisa de id, nome, tipos e stats, e a
 * descrição só a página de detalhe usa.
 */

/**
 * O cache vive em escopo de módulo, **não em `useState`**.
 *
 * `useState` serializa o valor no payload de SSR. Uma página que só lesse
 * `core.moves.length` sairia com 66 KB de HTML: os 54 KB de `core.json` viajam
 * duas vezes, uma como arquivo estático e outra dentro do documento — o que
 * anula justamente o motivo de o dex ser arquivo estático, que é ser cacheado
 * pela CDN e, na Fase 8, pelo service worker.
 *
 * O que normalmente proíbe estado em escopo de módulo no servidor é o vazamento
 * entre requisições. Aqui não existe: o dex é imutável e idêntico para todo
 * visitante — é o mesmo arquivo em disco. Não há nada de um usuário para vazar
 * para outro.
 *
 * `shallowRef` e não `ref` porque nenhuma tela edita o dex por dentro: o `ref`
 * criaria proxies reativos recursivos sobre 368 golpes e, adiante, 1025
 * espécies, para observar mutações que nunca acontecem.
 */
const core = shallowRef<CoreData | null>(null)
const index = shallowRef<IndexData | null>(null)
const chains = shallowRef<ChainsData | null>(null)
const generations = shallowRef<Readonly<Record<number, GenerationData>>>({})
const flavors = shallowRef<Readonly<Record<number, FlavorData>>>({})

/**
 * As requisições em voo, por chave.
 *
 * Memoizar só o valor resolvido deixa a janela entre a chamada e a resposta
 * aberta: dois componentes que peçam `loadGeneration(1)` no mesmo tick disparam
 * dois `$fetch` para o mesmo arquivo. Guardar a promessa fecha a janela, e
 * limpá-la ao final é o que permite uma nova tentativa depois de uma falha.
 */
let corePending: Promise<CoreData> | null = null
let indexPending: Promise<IndexData> | null = null
let chainsPending: Promise<ChainsData> | null = null
const generationPending = new Map<number, Promise<GenerationData>>()
const flavorPending = new Map<number, Promise<FlavorData>>()

export function useDex() {
  async function loadCore(): Promise<CoreData> {
    if (core.value !== null) return core.value

    const pending = corePending ?? fetchGuarded('core.json', isCoreData)
      .then((data) => {
        core.value = data
        return data
      })
      .finally(() => {
        corePending = null
      })

    corePending = pending
    return pending
  }

  /**
   * `index.json` — as 1025 linhas de nome, tipo e geração.
   *
   * Dois leitores, e nenhum deles cabe no carregamento por geração: a busca
   * global precisa dos 1025 nomes de uma vez, e `/pokemon/[name]` recebe um slug
   * sem saber em qual `gen-N.json` procurar. São 15 KB gzipados contra os ~60 KB
   * dos nove arquivos completos, e ele fica em cache para os dois.
   */
  async function loadIndex(): Promise<IndexData> {
    if (index.value !== null) return index.value

    const pending = indexPending ?? fetchGuarded('index.json', isIndexData)
      .then((data) => {
        index.value = data
        return data
      })
      .finally(() => {
        indexPending = null
      })

    indexPending = pending
    return pending
  }

  async function loadChains(): Promise<ChainsData> {
    if (chains.value !== null) return chains.value

    const pending = chainsPending ?? fetchGuarded('chains.json', isChainsData)
      .then((data) => {
        chains.value = data
        return data
      })
      .finally(() => {
        chainsPending = null
      })

    chainsPending = pending
    return pending
  }

  async function loadGeneration(generation: number): Promise<GenerationData> {
    const cached = generations.value[generation]
    if (cached !== undefined) return cached

    const inFlight = generationPending.get(generation)
    if (inFlight !== undefined) return inFlight

    const name = `gen-${generation}.json`
    const pending = fetchGuarded(name, isGenerationData)
      .then((data) => {
        generations.value = { ...generations.value, [generation]: data }
        return data
      })
      .finally(() => {
        generationPending.delete(generation)
      })

    generationPending.set(generation, pending)
    return pending
  }

  /**
   * Registra no cache uma geração que já chegou por outro caminho.
   *
   * `/pokedex/[gen]` resolve a geração no `useAsyncData`, e o resultado viaja no
   * payload de SSR — 11,3 KB gzipados contra os 7,0 KB do `gen-1.json` que ele
   * duplica, porque o `devalue` cobra o próprio overhead. Na hidratação o
   * handler não roda, então esse dado chega ao cliente e o cache de módulo
   * continua vazio: duas cópias da mesma geração, nenhuma das duas sabendo da
   * outra.
   *
   * **Isto é defesa, não economia medida.** Com tudo pré-renderizado o cliente
   * não chega a rebaixar `gen-N.json`: navegar para uma espécie busca o
   * `_payload.json` dela, e o handler de `[name].vue` também não roda. Medido —
   * num fluxo de grid → busca → espécie o único `/data/` que sai é o
   * `index.json` da busca. O que esta função conserta é a divergência entre os
   * dois caches, que passa a valer no dia em que uma rota deixar de ser
   * pré-renderizada; ela não devolve bytes hoje.
   */
  function seedGeneration(generation: number, data: GenerationData): void {
    if (generations.value[generation] !== undefined) return
    generations.value = { ...generations.value, [generation]: data }
  }

  async function loadFlavor(generation: number): Promise<FlavorData> {
    const cached = flavors.value[generation]
    if (cached !== undefined) return cached

    const inFlight = flavorPending.get(generation)
    if (inFlight !== undefined) return inFlight

    const name = `flavor-${generation}.json`
    const pending = fetchGuarded(name, isFlavorData)
      .then((data) => {
        flavors.value = { ...flavors.value, [generation]: data }
        return data
      })
      .finally(() => {
        flavorPending.delete(generation)
      })

    flavorPending.set(generation, pending)
    return pending
  }

  /**
   * A linha do índice de um slug, ou `null` — que é o 404 de `/pokemon/[name]`.
   *
   * Busca linear sobre 1025 registros: são ~0,02 ms, e cada tela a chama uma vez
   * na navegação. Um `Map` construído a cada leitura custaria mais que a
   * varredura, e um `Map` memoizado seria um segundo cache a invalidar junto com
   * o primeiro.
   */
  async function findBySlug(slug: string): Promise<SearchEntry | null> {
    const entries = await loadIndex()
    return entries.find(entry => entry.slug === slug) ?? null
  }

  return {
    core,
    index,
    chains,
    generations,
    flavors,
    loadCore,
    loadIndex,
    loadChains,
    loadGeneration,
    loadFlavor,
    seedGeneration,
    findBySlug,
  }
}

/**
 * Onde o dex mora para quem está lendo — e são dois lugares, não um.
 *
 * No **navegador** é um arquivo estático em `/data/`, buscado por HTTP e
 * cacheado pela CDN (e, na Fase 8, pelo service worker). É o desenho que a
 * Fase 1 escolheu e ele continua valendo.
 *
 * No **servidor** é o mesmo arquivo, pedido à rota interna `/__dex/`, que o lê
 * do `serverAssets` do Nitro. O `$fetch` de `/data/` não serve aqui, e o motivo
 * é estrutural: em SSR ele não sai pela rede, ele chama o app h3 por dentro — e
 * asset público não é rota do h3, é middleware estático na frente dele. O
 * caminho cai no renderizador de páginas, que devolve o HTML de 404. Uma rota
 * **é** rota do h3, e é isso que a torna alcançável.
 *
 * **A versão anterior lia o disco por `process.cwd()`, e isso quebrava em
 * produção.** `public/` e `.output/public/` relativos ao diretório de trabalho
 * só são a raiz do projeto no build e no `yarn preview`. Num deploy serverless o
 * `cwd` é a raiz da função, e o dex não está lá: no preset da Vercel ele vai
 * inteiro para `.vercel/output/static/` e a função não recebe cópia nenhuma.
 * Como toda rota válida é pré-renderizada, a única classe de URL que chega ao
 * servidor é a inválida — que é justamente quando o índice precisa ser lido para
 * responder 404. O sintoma medido era `/pokemon/missingno` respondendo **500,
 * com o caminho absoluto do servidor na linha de status e no corpo**.
 *
 * O guarda roda igual nos dois caminhos, e é ele que faz esta divisão ser
 * segura: um dos lados lendo arquivo diferente do outro reprova na leitura em
 * vez de renderizar meio dex.
 */

/**
 * `$fetch` devolve `any`, e é por aí que um `any` entra num projeto que baniu a
 * palavra. O `unknown` explícito força o guarda.
 *
 * O guarda não existe contra entrada adversária: o arquivo é nosso e já passou
 * pelo `zod` no build. Ele existe contra o modo real de falhar — um 404 servindo
 * HTML, ou um deploy parcial em que `core.json` é novo e `gen-1.json` é velho.
 * Esse segundo caso produz arquivo bem-formado e errado, e é por isso que os
 * guardas de `shared/types/dex.ts` cobram faixa e teto, não só forma.
 *
 * **Falha de rede sobe crua, de propósito.** Um `$fetch` que rejeita por 500 ou
 * por estar offline não vira `createError` aqui: quem decide entre repetir,
 * degradar e avisar é a tela. Envolver o erro aqui só escolheria por ela — e
 * esconderia a causa.
 */
async function fetchGuarded<T>(
  name: string,
  guard: (value: unknown) => value is T,
): Promise<T> {
  // Em servidor a rota interna; no navegador o arquivo estático da CDN. Os dois
  // devolvem o mesmo JSON e passam pelo mesmo guarda.
  const raw = await $fetch<unknown>(import.meta.server ? `/__dex/${name}` : `/data/${name}`)

  if (!guard(raw)) {
    throw createError({
      statusCode: 500,
      statusMessage: `${name} não tem a forma esperada — dex desatualizado ou build incompleto`,
    })
  }
  return raw
}
