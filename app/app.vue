<template>
  <UApp>
    <!-- O aviso de save recuperado fica acima do layout e fora dele: ele é
         estado do **boot**, não de uma tela, e o jogador precisa vê-lo em
         qualquer rota que tenha aberto o jogo. `ClientOnly` porque o plugin que
         o alimenta é `.client` — não há save no servidor. -->
    <ClientOnly>
      <SaveRecoveryNotice />
    </ClientOnly>

    <!-- Sem NuxtLayout aqui, o primeiro app/layouts/default.vue da Fase 2 é
         ignorado em silêncio: com app.vue presente, o layout só entra por ele. -->
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
