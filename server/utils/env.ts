/**
 * Leitura de variável de ambiente que falha alto.
 *
 * O repositório proíbe `as` e `!` (`consistent-type-assertions: never` e
 * `no-non-null-assertion` no `eslint.config.mjs`), e `process.env.X` é
 * `string | undefined`. Sem esta função, cada consumidor resolveria a diferença
 * com um cast — que é exatamente o buraco que a regra existe para fechar.
 *
 * **Onde a falta aparece, medido e não suposto:** esta função só roda quando
 * alguém chama uma rota que precisa da variável. Com o `.env` fora do lugar,
 * `yarn build` passa limpo, a raiz do site responde 200, e só `/api/auth/*`
 * devolve 500 com o nome da variável na mensagem. (Uma versão anterior deste
 * comentário afirmava que o servidor não subiria. Não é o que acontece.)
 *
 * **E isso deixou de ser garantido pelo bundler na Fase 8.** O comentário antigo
 * creditava a preguiça ao Nitro — "importa o chunk de cada rota sob demanda" —, e
 * isso era verdade por acidente de empacotamento. Ao registrar o `@nuxtjs/i18n`,
 * que instala um plugin de servidor, `server/db/index.ts` e `server/utils/auth.ts`
 * foram puxados para o chunk de **boot**, e o servidor passou a morrer na partida
 * por falta de `DATABASE_URL`. Hoje quem garante a preguiça são os próprios
 * módulos — `getDb()` e `getAuth()` constroem na primeira chamada —, e não o lugar
 * onde o bundler decidiu pôr o arquivo. Ver o docblock de `server/db/index.ts`.
 *
 * E é o comportamento certo para este jogo, não um defeito a consertar: ele é
 * local-first, e tudo menos conta e sincronização funciona sem servidor. Recusar
 * o boot por causa de uma credencial de banco transformaria uma queda de sync em
 * queda total — o contrário do que o plano decidiu ao dizer que, se o servidor
 * sumisse, o jogo continuaria abrindo do `localStorage`.
 */
export function requireEnv(name: string): string {
  const value = process.env[name]

  if (value === undefined || value === '') {
    throw new Error(`Variável de ambiente ausente ou vazia: ${name}`)
  }

  return value
}
