<script setup lang="ts">
import { useSession } from '../composables/useSession';
const accountMenus = [
  { name: 'library', label: 'Library', icon: ['fa-solid', 'fa-folder-open'] },
  { name: 'guide_sources', label: 'Guide Sources', icon: ['fa-solid', 'fa-tv'] },
];
const { user } = useSession();
</script>

<template>
  <main class="py-10">
    <h3 class="mb-4 text-xl font-bold">Hi, {{ user?.username }}.</h3>
    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <RouterLink v-for="menu in accountMenus" :key="menu.name" :to="{ name: menu.name }"
        class="card border border-base-content/10 bg-base-200 transition-colors hover:bg-base-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
        <div class="card-body items-center gap-4 text-center">
          <font-awesome-icon :icon="menu.icon" aria-hidden="true" class="text-5xl text-primary" />
          <h2 class="card-title">{{ menu.label }}</h2>
        </div>
      </RouterLink>
    </div>
  </main>
</template>
