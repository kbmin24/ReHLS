<script setup lang="ts">
import { ref, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useSession } from './composables/useSession';
import Navbar from './components/Navbar.vue';

const route = useRoute();
const router = useRouter();
const session = useSession();

const pageType = computed(() => route.meta.pageType);
const maxWidth = computed(() => route.meta.maxWidth ?? '5xl');

async function retrySession() {
  await session.load(true);
  if (!session.error.value) await router.replace({ name: 'login' });
}
</script>

<template>
  <div data-theme="dark" class="app-grain min-h-[100dvh] bg-[var(--color-base-100)] text-base-content">
    <div  v-if="!session.ready.value" role="status" class="grid h-screen place-items-center">
      <img src="./assets/ReHLS_logo_full.png" alt="ReHLS logo" class="max-w-full animate-pulse w-s" />
    </div>
    <div v-else-if="session.error.value" class="max-w-lg px-5 py-16 mx-auto">
      <p role="alert" class="alert alert-error">{{ session.error.value }}</p>
      <button type="button" class="mt-4 btn btn-link" @click="retrySession">Try again</button>
    </div>
    <template v-else>
      <Navbar v-if="pageType !== 'special'" :max-width="maxWidth"><RouterView /></Navbar>
      <RouterView v-else />
    </template>
  </div>
</template>

<style scoped>
.app-grain {
  --grain-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.75' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' opacity='.12' filter='url(%23noise)'/%3E%3C/svg%3E");
  background-image: var(--grain-image);
}
</style>
