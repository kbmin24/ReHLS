<script setup lang="ts">
import { useSession } from '../composables/useSession';

const { user } = useSession();
</script>

<template>
  <main class="mx-auto max-w-5xl px-5 py-10 md:px-10">
    <p class="text-base-content/70">Signed in as {{ user?.username }}.</p>
  </main>
</template>
