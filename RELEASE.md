# Release

O versionamento é automático: quem decide a próxima versão são as mensagens de
commit que chegam em `main`. Ninguém edita `package.json` ou `CHANGELOG.md` na
mão — o [release-please](https://github.com/googleapis/release-please) faz isso
num PR e você só aprova.

## Como funciona

O [`release.yml`](.github/workflows/release.yml) roda a cada push em `main`. Ele
lê os commits desde a última tag, calcula a próxima versão e mantém aberto um PR
`chore(main): release X.Y.Z` com o `CHANGELOG.md`, o `package.json` e o
[`.release-please-manifest.json`](.release-please-manifest.json) já atualizados.

Esse PR fica se reescrevendo sozinho a cada commit novo em `main`. Ele não é a
release — é a proposta dela. **Quem faz a release existir é o merge desse PR**:
aí sim o workflow cria a tag `vX.Y.Z` e a GitHub Release com as notas.

São, portanto, dois merges por release: o do seu trabalho, e o do PR que o
release-please abriu depois.

## A regra que quebra tudo: merge commit, não squash

O release-please lê o **assunto** de cada commit em `main`. No squash o GitHub
colapsa a branch num commit só, cujo assunto vira o título do PR — e os commits
originais viram bullets no corpo:

```
* chore: fundação do Nuxt 4
* fix: corrige o token de superfície
```

Esses bullets **não** são lidos. O parser casa `tipo(escopo): assunto` no início
da linha, e o `* ` na frente quebra o match. Com um título de PR começando em
`chore:`, um `fix:` de verdade lá dentro some, o workflow passa em verde e
nenhuma release sai — falha silenciosa, do pior tipo.

Então: **merge commit**, sempre. Os commits chegam individuais em `main` e cada
um é lido pelo que é.

Se algum dia precisar mesmo squashar, o assunto do commit final tem que carregar
o tipo mais forte da branch (um `feat:` engole os `chore:` juntos).

## O que cada tipo faz com a versão

O projeto está em `0.x` e a config usa `bump-minor-pre-major`, então breaking
change ainda não estoura major:

| Commit                            | Efeito em `0.x` | Aparece no CHANGELOG |
| --------------------------------- | --------------- | -------------------- |
| `fix:`                            | patch           | Bug Fixes            |
| `feat:`                           | minor           | Features             |
| `feat!:` / `BREAKING CHANGE:`     | minor           | Breaking Changes     |
| `chore:` `docs:` `test:` `refactor:` `style:` `ci:` | nada | não          |

Uma branch inteira de `chore:` não gera release nenhuma — e isso é o
comportamento correto, não um bug. Na dúvida sobre o que vai sair, o PR de
release é a fonte da verdade: ele mostra o número e o changelog antes de
qualquer tag existir.

## Passo a passo

1. Merge do PR da fase em `main`, **com merge commit**.
2. O push dispara dois workflows: o [`ci.yml`](.github/workflows/ci.yml)
   (lint · typecheck · test + e2e) e o `release.yml`.
3. Se havia commit versionável, o release-please abre — ou atualiza — o PR
   `chore(main): release X.Y.Z`. Confira o número e o changelog.
4. O CI roda nesse PR também, incluindo o `e2e`, que faz build completo. É lento
   e é de propósito: o que vira tag passou pelos mesmos portões que o resto.
5. Merge do PR de release. O `release.yml` roda de novo e cria a tag `vX.Y.Z`
   mais a GitHub Release. Aqui o método de merge não importa — o release-please
   acha o próprio PR pelo label `autorelease: pending`.

## Consertar as notas depois do merge

Se uma release saiu com o texto errado, dá para editar o **corpo do PR já
mergeado** e envolver a mensagem certa nos marcadores abaixo. Só funciona em PR
squashado:

```
BEGIN_COMMIT_OVERRIDE
fix: a mensagem que deveria ter entrado
END_COMMIT_OVERRIDE
```

## Do que a release depende no repositório

Duas configurações fora do código, que falham de formas pouco óbvias:

- **Settings → Actions → General → "Allow GitHub Actions to create and approve
  pull requests"** precisa estar ligado, senão o release-please não consegue
  abrir o PR e o job falha sem dizer direito o motivo. *(Já está ligado.)*
- O **default workflow permission** do repositório é `read`, mas o `release.yml`
  declara o próprio bloco `permissions:` com `contents: write`. Isso é permitido
  — a configuração do repositório define o padrão, não o teto. Não mexa nesse
  bloco achando que é redundante.

O `GITHUB_TOKEN` padrão basta. Não precisa de PAT.
