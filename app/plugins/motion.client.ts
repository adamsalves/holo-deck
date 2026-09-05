import { defineNuxtPlugin } from 'nuxt/app'
import { storedReduceMotion, useMotionSwitch } from '~/composables/useMotion'

/**
 * Carimba o interruptor de movimento no `<html>` antes de a tela existir.
 *
 * É `.client` pelo mesmo motivo do plugin de save: a preferência mora no
 * armazenamento do navegador, e o HTML pré-renderizado não conhece o aparelho de
 * ninguém.
 *
 * **Roda antes de qualquer elemento animado existir**, e é isso que evita o
 * lampejo: as animações que este jogo tem — o pulso do baralho selado e a virada
 * do `PackOpener` — vivem dentro de `<ClientOnly>`, então nascem depois da
 * montagem. O que o HTML pré-renderizado traz são transições, que só disparam
 * quando algo muda, e nada mudou ainda.
 *
 * A chamada a `set` regrava o valor que acabou de ler, e isso é de propósito:
 * um `holodeck:reduce-motion` com lixo dentro sai normalizado do boot em vez de
 * ficar lá para confundir a próxima leitura.
 *
 * É `useMotionSwitch` e não `useReduceMotion`: o boot não pode assinar a media
 * query do sistema. Ver o docblock do interruptor — a assinatura criada aqui
 * ficaria viva para sempre e congelaria o `matchMedia` do app inteiro.
 */
export default defineNuxtPlugin(() => {
  useMotionSwitch().set(storedReduceMotion())
})
