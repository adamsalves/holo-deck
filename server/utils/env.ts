/**
 * Leitura de variável de ambiente que falha alto.
 *
 * O repositório proíbe `as` e `!` (`consistent-type-assertions: never` e
 * `no-non-null-assertion` no `eslint.config.mjs`), e `process.env.X` é
 * `string | undefined`. Sem esta função, cada consumidor resolveria a diferença
 * com um cast — que é exatamente o buraco que a regra existe para fechar.
 *
 * Falhar no boot é deliberado: uma `DATABASE_URL` ausente descoberta no primeiro
 * `PUT /api/save` é um 500 no meio de uma gravação de save; descoberta aqui, é o
 * servidor não subindo, com o nome da variável na mensagem.
 */
export function requireEnv(name: string): string {
  const value = process.env[name]

  if (value === undefined || value === '') {
    throw new Error(`Variável de ambiente ausente ou vazia: ${name}`)
  }

  return value
}
