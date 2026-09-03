/**
 * A economia do jogo — moedas, recompensa de ginásio, pack diário, loja.
 *
 * **Este módulo nasce quase vazio de propósito.** O plano o coloca inteiro na
 * Fase 6, junto com a Liga e a loja, e é lá que ele ganha as cinco linhas
 * restantes: recompensa por ginásio (`200 + 100 × ginásio`), revanche a 25%,
 * bônus por vitória imaculada, pack diário e o preço de 150 na loja. Nada disso
 * pode ser calibrado antes de existir batalha que pague.
 *
 * O que chega aqui agora é a única fonte de carta que a Fase 5 precisa, e a
 * razão de ela não poder esperar está abaixo. Ela mora neste arquivo, e não em
 * `packs.ts`, porque `/rules` vai procurá-la onde o plano diz que ela está — e
 * porque um módulo que nasce com uma linha é mais honesto que uma constante de
 * economia escondida dentro do sorteador.
 */

/**
 * Três packs na primeira execução, uma vez só.
 *
 * **O jogo tem um ciclo fechado na partida.** Um jogador novo tem zero cartas;
 * precisa de 6 para montar deck, de deck para enfrentar o Ginásio 1, de ginásio
 * para ter moedas, e de moedas para comprar pack. Sem uma concessão inicial
 * nenhuma dessas portas abre, e a primeira tela do jogo seria uma coleção vazia
 * pedindo moedas que não há como ganhar.
 *
 * Três, e não um: 30 cartas é o mínimo para o deck de 6 da Fase 6 ter **escolha
 * real** em vez de ser o que sobrou. E fazem o primeiro minuto do jogo ser o
 * `PackOpener`, que é o momento mais forte que o jogo tem.
 *
 * A prancha *Abertura de pack* já desenha isto: o cabeçalho dela estampa
 * `BOAS-VINDAS · 1 DE 3`.
 */
export const WELCOME_PACKS = 3
