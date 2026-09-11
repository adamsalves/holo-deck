<template>
  <UApp>
    <!-- O aviso de save recuperado fica acima do layout e fora dele: ele é
         estado do **boot**, não de uma tela, e o jogador precisa vê-lo em
         qualquer rota que tenha aberto o jogo. `ClientOnly` porque o plugin que
         o alimenta é `.client` — não há save no servidor. -->
    <ClientOnly>
      <SaveRecoveryNotice />

      <!-- A escolha do primeiro login fica no mesmo lugar e pelo mesmo motivo:
           é estado do **boot**, não de uma tela, e enquanto ela estiver de pé o
           jogo não sabe qual coleção é a do jogador. Ver a prancha
           *Duas coleções* — a única do sistema que pede decisão. -->
      <SaveChoice />
    </ClientOnly>

    <!-- Sem NuxtLayout aqui, o primeiro app/layouts/default.vue da Fase 2 é
         ignorado em silêncio: com app.vue presente, o layout só entra por ele. -->
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
