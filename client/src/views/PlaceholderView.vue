<script setup lang="ts">
defineProps<{ description: string }>();
</script>

<template>
  <main class="mx-auto max-w-5xl px-5 py-10 md:px-10">
    <p class="rounded-xl border border-dashed border-base-content/20 bg-base-200/50 p-8 text-base-content/70">
      {{ description }}
    </p>
  </main>
</template>
