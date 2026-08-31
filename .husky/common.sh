# Põe o Node do `.nvmrc` no PATH antes de qualquer hook rodar.
#
# Hook de git executa em shell não-interativo e não-login: nada do que o
# `~/.zshrc` carrega existe aqui. Medido neste repo com `env -i` — num PATH cru
# **nem `node` nem `yarn` existem**, porque os dois só vivem dentro do
# diretório de versão do nvm. Sem este arquivo, commitar pelo source control do
# VS Code (ou por qualquer cliente gráfico) morre em `command not found`.
#
# **Sourcear o `nvm.sh` aqui não funciona, e falha mentindo.** O husky roda os
# hooks com `sh -e`, que no Ubuntu é o dash; sob dash o `nvm use` responde
# `version "v24.20.0" is not yet installed` para uma versão que está instalada
# — o mesmo comando sob bash resolve. Conferido nesta máquina.
#
# Então nada de sourcear: o `.nvmrc` fixa a versão exata, o que torna o
# diretório dela previsível. Montar o caminho é determinístico, custa zero e
# independe de o gerenciador de versão saber conversar com o shell da vez.

# `want` vazio (sem .nvmrc, ou com um .nvmrc ilegível) desliga o bloco inteiro,
# porque sem versão alvo não há o que resolver. Sem esta guarda ele erra dos dois
# lados: com Node no PATH, trava todo commit num "precisa do Node  (.nvmrc)" sem
# versão no meio da frase; sem Node, `want` e `have` empatam em vazio, o guard
# passa e o hook morre num `command not found` — que é o que ele veio prevenir.
want=''
[ -f .nvmrc ] && want=$(tr -d 'v \t\n\r' < .nvmrc)

if [ -n "$want" ]; then
  have=$(node -v 2>/dev/null | tr -d 'v \t\n\r')

  # O caso comum é o barato: shell que já tem a versão certa não paga nada.
  if [ "$have" != "$want" ]; then
    for candidate in \
      "${NVM_DIR:-$HOME/.nvm}/versions/node/v$want/bin" \
      "${FNM_DIR:-$HOME/.local/share/fnm}/node-versions/v$want/installation/bin"
    do
      if [ -x "$candidate/node" ]; then
        PATH="$candidate:$PATH"
        export PATH
        break
      fi
    done

    have=$(node -v 2>/dev/null | tr -d 'v \t\n\r')
  fi

  # Falhar aqui, dizendo o motivo, é melhor que falhar três linhas abaixo num
  # `command not found` que não explica nada.
  if [ "$have" != "$want" ]; then
    echo "hook: este repo precisa do Node $want (.nvmrc), e ele não está no PATH." >&2
    if [ -n "$have" ]; then
      echo "      o PATH tem a $have — o yarn recusaria com" >&2
      echo "      \"Commands cannot run with an incompatible environment\"." >&2
    fi
    echo "      instale a $want no gerenciador que você usa (\`nvm install\`," >&2
    echo "      \`fnm install\`, Volta, asdf, mise) e repita." >&2
    exit 1
  fi
fi
