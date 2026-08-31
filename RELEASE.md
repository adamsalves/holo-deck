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

### O merge commit também entra no changelog

O `commitlint` ignora merge commits por padrão — é o que mantém o job de CI
passando no PR de release. **O release-please não os ignora**, e as duas
ferramentas lendo a mesma mensagem com regras diferentes é o que surpreende aqui.

O GitHub monta a mensagem do merge commit assim:

```
Merge pull request #7 from adamsalves/feat/dex-pipeline

feat: pipeline de dados — o dex da PokeAPI gerado em build-time
```

A segunda linha é o **título do PR**, e é ela que o release-please lê. Se o
título começa com tipo convencional, ele vira mais uma entrada do changelog, ao
lado das que os commits da branch já geraram.

Isto é o efeito observado, não a fonte lida: se o release-please pega o título do
corpo do merge commit ou o busca pela associação do PR na API não foi conferido —
e não muda o que fazer, porque as duas rotas chegam ao mesmo texto. O que decide
é o título do PR.

Aconteceu na `v0.2.0`: o changelog saiu com cinco Features, e a quinta —
`pipeline de dados — o dex da PokeAPI gerado em build-time` — é o merge commit do
PR #7 resumindo as outras quatro.

**Isso não muda a versão calculada.** O tipo mais forte da branch já mandava, e
uma entrada a mais do mesmo tipo não soma nada. O efeito é uma linha redundante
no changelog, e a decisão é de gosto:

| Título do PR                   | Changelog                                    |
| ------------------------------ | -------------------------------------------- |
| `feat: pipeline de dados — …`  | ganha uma linha-resumo além das dos commits  |
| `Pipeline de dados — …`        | só as entradas dos commits da branch         |

Nada a corrigir na `v0.2.0` — a linha extra descreve a fase corretamente. Vale
saber para escolher o título da próxima com a decisão na mão, em vez de descobrir
o efeito depois de mergear.

## O que cada tipo faz com a versão

O projeto está em `0.x` e a config usa `bump-minor-pre-major`, então breaking
change ainda não estoura major:

| Commit                            | Efeito em `0.x` | Aparece no CHANGELOG |
| --------------------------------- | --------------- | -------------------- |
| `fix:`                            | patch           | Bug Fixes            |
| `feat:`                           | minor           | Features             |
| `feat!:` / `BREAKING CHANGE:`     | minor           | Breaking Changes     |
| `perf:`                           | patch           | Performance Improvements |
| `revert:`                         | patch           | Reverts              |
| `chore:` `docs:` `test:` `refactor:` `style:` `ci:` `build:` | nada | não |

**O assunto começa em minúscula.** O `commitlint` reprova quando o primeiro
caractere é maiúsculo — a regra existe para barrar `fix: Corrige o dano`, mas ela
pega junto o nome próprio no início, que neste projeto é o caso comum:
`feat: PokeAPI vira a fonte do dex` reprova. As duas saídas são baratas — pôr o
artigo antes (`feat: a PokeAPI vira a fonte do dex`) ou o nome entre crases. A
mensagem de erro fala em `sentence-case`, que não deixa isso óbvio; daí esta
nota. Vale para o resto do assunto também? Não: só o primeiro caractere importa,
então `fix: o alias de shared quebra no Nuxt 4` passa.

O `commitlint` valida o corpo além do assunto — linhas de corpo têm teto de 100
caracteres, e linhas com URL são isentas (os trailers `Co-Authored-By:` e
`Claude-Session:` passam).

**O tipo errado não é deslize de estilo — é a versão decidida sem querer.** Já
aconteceu aqui: `ad21429` entrou como `fix:` numa Fase 0 planejada como `chore:`
puro, e a release saiu `v0.1.1` em vez de a versão apenas nascer em `0.1.0`. Por
isso o assunto é validado por `commitlint` em dois lugares: no hook `commit-msg`
(local, e burlável com `--no-verify`) e num job do
[`ci.yml`](.github/workflows/ci.yml) sobre todos os commits do PR — que é o que
pega commit feito pela interface do GitHub, onde hook nenhum roda. Merge commits
são ignorados pelo commitlint por padrão, então o job não trava no PR de release —
o release-please, esse os lê, e a seção acima explica o que isso faz no changelog.

`perf:` e `revert:` estão na tabela porque **cortam release**, e isso surpreende:
a regra do release-please não é "só `fix` versiona". Ele soma breaking e `feat`,
e **todo o resto cai em patch** — o que segura os `chore:`/`docs:` da vida não é
a versão, é o changelog ficar vazio, aí a release inteira é pulada. Os tipos que
o preset marca como visíveis são exatamente `feat`, `fix`, `perf` e `revert`;
`build:` é oculto como `chore:`. Conferido na fonte do release-please e do
preset, e batendo com o que se vê aqui: o `docs:` que entrou em `main` depois da
`v0.1.1` não abriu PR de release nenhum.

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
4. O CI **não** roda sozinho nesse PR — veja a seção abaixo.
5. Merge do PR de release. O `release.yml` roda de novo e cria a tag `vX.Y.Z`
   mais a GitHub Release. Aqui o método de merge não importa — o release-please
   acha o próprio PR pelo label `autorelease: pending`.
6. Varra as branches órfãs e apague — a release não fecha antes disso. Veja a
   seção abaixo.

## Fechar a release apagando as branches órfãs

Uma release deixa branch para trás por conta própria: além da branch da fase,
o release-please cria a dele
(`release-please--branches--main--components--<pacote>`). A primeira release do
projeto terminou com quatro. Sem varrer no fim, o repositório acumula lixo que
esconde as branches que ainda importam.

`delete_branch_on_merge` está **desligado de propósito** — a convenção aqui é uma
branch por fase, e a branch da fase pode valer como registro. Por isso a limpeza
é decisão de cada release, não automatismo do GitHub, e por isso este passo
existe.

Órfã é branch já mergeada no `main`. Prove antes de apagar, nunca confie no nome:

```bash
git fetch --prune origin
for b in $(git ls-remote --heads origin | sed 's|.*refs/heads/||' | grep -v '^main$'); do
  git merge-base --is-ancestor "origin/$b" origin/main \
    && echo "MERGEADA  $b" || echo "MANTER    $b"
done
```

Só as `MERGEADA` saem:

```bash
git push origin --delete <branch>   # remota
git branch -d <branch>              # local; o -d minúsculo recusa não-mergeada
```

A branch do release-please pode ir junto — ele recria na release seguinte.

## O CI do PR de release fica pendente

O GitHub não dispara workflow em pull request aberto pelo `GITHUB_TOKEN` — é
proteção contra loop de automação. Como quem abre o PR de release é o
`github-actions[bot]`, o run do `ci.yml` nasce com status `action_required` e
fica parado esperando aprovação.

Isso engana à primeira vista: o PR aparece com checks verdes, mas são os da
Vercel, não os do projeto. Não confunda um com o outro.

Para rodar, vá em **Actions → o run pendente → "Approve and run"**, ou pela CLI:

```bash
gh run list --branch release-please--branches--main--components--holo-deck
gh api --method POST repos/:owner/:repo/actions/runs/<run-id>/approve
```

Aprovar é conferência, não obrigação: o PR de release só mexe em `CHANGELOG.md`,
`package.json` e no manifest, e o código já passou pelos portões quando entrou em
`main`. O que a aprovação garante é que a árvore que vira tag foi testada como
está.

## Consertar as notas depois do merge

Se uma release saiu com o texto errado, dá para editar o **corpo do PR já
mergeado** e envolver a mensagem certa nos marcadores abaixo. Só funciona em PR
squashado:

```
BEGIN_COMMIT_OVERRIDE
fix: a mensagem que deveria ter entrado
END_COMMIT_OVERRIDE
```

## Por que `include-component-in-tag: false`

O [`release-please-config.json`](release-please-config.json) declara o pacote em
`packages: { "." }`. Nesse formato o release-please assume monorepo: ele deriva
um *component* do nome no `package.json` e prefixa a tag com ele, porque
`include-component-in-tag` vem `true` por padrão. Sem a flag, a tag sairia
`holo-deck-v0.1.1`.

Component é mecanismo de repositório com vários artefatos versionados
separadamente. Aqui é um só. A flag desliga o prefixo e as tags ficam `v0.1.1`.
Não remova achando que é ruído: ela é o que mantém o formato.

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
