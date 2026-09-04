// @vitest-environment nuxt
import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { isIndexData } from '~~/shared/types/dex'
import type { SearchEntry } from '~~/shared/types/dex'
import CollectionCard from '~/components/collection/Card.vue'
import index from '~~/public/data/index.json'

/**
 * A carta do binder, e a única promessa dela que não é visual: **as duas
 * versões têm a mesma altura**.
 *
 * A issue #24 descreve o defeito e a Fase 6 o corrigiu. O que ele fazia: a
 * etiqueta de raridade morava dentro do rodapé da `PokeCard` e o botão de moer
 * morava fora do link, embaixo do artigo. Dois lugares para dois estados
 * exclusivos, mais o `padding` extra do botão, deixavam a carta com duplicata
 * ~22px mais alta — e como a fileira estica até a mais alta, a altura da fileira
 * passava a depender de haver ou não uma repetida dentro dela.
 *
 * ## Por que este portão não mede altura
 *
 * **Não existe motor de CSS aqui.** `happy-dom` monta a árvore e não resolve
 * `aspect-ratio`, `padding` nem `margin`, então toda medida de altura devolveria
 * zero nos dois casos e o teste passaria com o defeito plantado de volta. Foi
 * exatamente esse erro que a Fase 5 cometeu no portão do `PackOpener`, e a lição
 * é a mesma: quando o efeito não é observável, afirme o **mecanismo** que o
 * produz.
 *
 * O mecanismo aqui é estrutural, e é observável: a altura só pode divergir se as
 * duas versões tiverem **árvores diferentes**. Enquanto o artigo tiver os mesmos
 * filhos e o rodapé pendurar no mesmo pai, nenhuma folha de estilo consegue
 * fazer uma ficar mais alta que a outra sem que este teste veja.
 */

const raw: unknown = index
if (!isIndexData(raw)) throw new Error('index.json não passou pelo guarda de leitura')

/** Bulbasaur — comum, dois tipos. Qualquer entrada serve; esta é a primeira. */
const ENTRY: SearchEntry = raw[0] ?? unreachable()

/** O índice tem 1025 entradas; um `!` aqui seria o cast que o lint recusa. */
function unreachable(): never {
  throw new Error('index.json chegou vazio ao portão da carta do binder')
}

function card(duplicates: number, extra: { copies?: number, shinies?: number } = {}) {
  return mountSuspended(CollectionCard, {
    props: {
      entry: ENTRY,
      copies: extra.copies ?? duplicates + 1,
      shinies: extra.shinies ?? 0,
      duplicates,
    },
  })
}

/** As tags dos filhos diretos do artigo — a assinatura da árvore que decide a altura. */
function childTags(html: string): string[] {
  const root = document.createElement('div')
  root.innerHTML = html
  const article = root.querySelector('article.binder-card')
  return [...(article?.children ?? [])].map(child => child.tagName.toLowerCase())
}

/** A classe do elemento que hospeda o rodapé, nos dois estados. */
function footerParent(html: string): string | null {
  const root = document.createElement('div')
  root.innerHTML = html
  const foot = root.querySelector('.binder-card__foot')
  return foot?.parentElement?.className ?? null
}

describe('o rodapé único da carta do binder', () => {
  it('mantém a mesma árvore com e sem duplicata — a altura não tem por onde divergir', async () => {
    const comDup = (await card(2)).html()
    const semDup = (await card(0)).html()

    // Se o botão de moer voltar para fora do artigo, esta lista ganha um item
    // só num dos lados, que é a forma exata do defeito da #24.
    expect(childTags(comDup), 'filhos diretos do artigo').toEqual(childTags(semDup))

    // E se ele voltar para um rodapé próprio em vez do slot compartilhado, o pai
    // deixa de ser o mesmo.
    expect(footerParent(comDup)).toBe(footerParent(semDup))
    expect(footerParent(comDup)).not.toBeNull()
  })

  it('põe os dois estados na mesma caixa, e só um de cada vez', async () => {
    const comDup = (await card(2))
    const semDup = (await card(0))

    // Um rodapé, nunca dois: os estados são exclusivos.
    expect(comDup.findAll('.binder-card__foot')).toHaveLength(1)
    expect(semDup.findAll('.binder-card__foot')).toHaveLength(1)

    // E cada um é o elemento certo — botão quando há o que moer, texto quando não.
    expect(comDup.find('.binder-card__foot').element.tagName).toBe('BUTTON')
    expect(semDup.find('.binder-card__foot').element.tagName).toBe('P')
  })

  /**
   * O botão fora do `<a>`, que é a razão de a `PokeCard` ter passado a hospedar
   * o link em vez de ser envolvida por ele.
   *
   * `<button>` dentro de `<a>` é conteúdo inválido: o navegador reparenteia, o
   * teclado alcança um dos dois e o clique escolhe sozinho qual ação executar.
   * Era essa a razão de o botão viver fora do artigo — e foi essa restrição que
   * o link-camada removeu.
   */
  it('nunca aninha o botão dentro do link', async () => {
    const comDup = await card(2)

    expect(comDup.find('a').exists(), 'a carta continua navegando').toBe(true)
    expect(comDup.findAll('a button'), 'botão aninhado no link').toHaveLength(0)
    expect(comDup.findAll('button')).toHaveLength(1)
  })

  it('dá ao link o nome que substitui o conteúdo visual', async () => {
    const semDup = await card(0, { copies: 1 })
    const link = semDup.find('a')

    // O link cobre a carta e não tem texto dentro: sem o rótulo ele seria
    // anunciado pelo destino cru.
    expect(link.attributes('aria-label')).toContain(ENTRY.displayName)
    expect(link.attributes('aria-label')).toContain('uma cópia')
    expect(link.attributes('href')).toBe(`/pokemon/${ENTRY.slug}`)
  })
})
