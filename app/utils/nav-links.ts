/**
 * Os destinos da barra global, como dado — e não como marcação.
 *
 * **Ele existe porque o portão precisava importar isto, e não lê-lo.**
 * `nav-gate.spec.ts` nasceu perguntando `AppNav.vue.includes("'/deck'")`, que é
 * presença de string no arquivo e não link renderizado: um `v-if="false"` em
 * volta do link, um `v-if` de feature flag esquecido, ou a rota citada só num
 * comentário mantinham o portão verde com a tela fora da barra. Com a lista num
 * módulo, o portão importa a mesma coisa que o componente renderiza, e a busca
 * por substring deixa de existir.
 *
 * A ordem é a da prancha, e é a ordem em que os links aparecem.
 */

export interface NavLink {
  readonly to: string
  readonly label: string
  /**
   * `exact` só na Base — e ele é load-bearing, não decorativo.
   *
   * A barra marca a seção atual por **prefixo de caminho** (ver `isCurrent` no
   * `AppNav`), que é o que acende *Pokédex* em `/pokedex/1`. `/` é prefixo de
   * toda rota, então sem `exact` a Base ficaria acesa em todas elas.
   */
  readonly exact: boolean
}

/** As seis seções da esquerda. */
export const NAV_LINKS: readonly NavLink[] = [
  { to: '/', label: 'Base', exact: true },
  { to: '/packs', label: 'Packs', exact: false },
  { to: '/pokedex', label: 'Pokédex', exact: false },
  { to: '/collection', label: 'Coleção', exact: false },
  { to: '/deck', label: 'Deck', exact: false },
  { to: '/league', label: 'Liga', exact: false },
]

/** O link de *Regras*, à direita do saldo. */
export const NAV_RULES: NavLink = { to: '/rules', label: 'Regras', exact: false }

/** A engrenagem. O rótulo é o nome acessível — ela não tem texto visível. */
export const NAV_SETTINGS: NavLink = { to: '/settings', label: 'Ajustes', exact: false }

/**
 * O canto da conta — *Entrar* sem sessão, o avatar com ela. Ver `AppAccount`.
 *
 * **Ele está aqui, e não numa exceção do portão**, e a diferença é a que este
 * arquivo existe para fazer: `/login` foi escrita no PR anterior sem nenhum link
 * para ela, e a exceção do `nav-gate` se justificava com "o canto da barra, e o
 * avatar que a Fase 7 ainda vai pôr lá" — três mecanismos inexistentes. Com a
 * rota na lista, o portão deixa de aceitar a promessa e passa a medir o link.
 *
 * Fica fora de `NAV_LINKS` porque não é uma das seis seções do jogo: jogar nunca
 * exige conta, e um sétimo link entre *Packs* e *Liga* transformaria a conta em
 * destino.
 */
export const NAV_ACCOUNT: NavLink = { to: '/login', label: 'Entrar', exact: false }

/**
 * Toda rota que a barra liga, sem repetição.
 *
 * O saldo aponta para `/packs` e a marca para `/`, e as duas já estão em
 * `NAV_LINKS` — o `Set` é o que impede a lista de dizer que há oito destinos
 * quando há sete.
 */
export const NAV_DESTINATIONS: readonly string[] = [
  ...new Set([...NAV_LINKS, NAV_RULES, NAV_SETTINGS, NAV_ACCOUNT].map(link => link.to)),
]
