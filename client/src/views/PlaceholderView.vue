<script setup lang="ts">
defineProps<{ description: string }>();
</script>

<template>
  <main class="py-10">
    <p class="rounded-xl border border-dashed border-base-content/20 bg-base-200/50 p-8 text-base-content/70">
      {{ description }}
    </p>
  </main>
</template>
