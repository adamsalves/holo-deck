<script setup lang="ts">
const { appVersion, gitSha } = useRuntimeConfig().public
</script>

<template>
  <span class="numeric text-xs text-muted">
    v{{ appVersion }} · {{ gitSha }}
  </span>
</template>
