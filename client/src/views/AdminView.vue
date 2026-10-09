<script setup lang="ts">
const adminMenus = [
  { name: 'admin-users', label: 'Accounts', icon: ['fa-solid', 'fa-users'] },
];
</script>

<template>
  <main class="mx-auto max-w-5xl px-5 py-10 md:px-10">
    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <RouterLink v-for="menu in adminMenus" :key="menu.name" :to="{ name: menu.name }"
        class="card border border-base-content/10 bg-base-200 transition-colors hover:bg-base-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
        <div class="card-body items-center gap-4 text-center">
          <font-awesome-icon :icon="menu.icon" aria-hidden="true" class="text-5xl text-primary" />
          <h2 class="card-title">{{ menu.label }}</h2>
        </div>
      </RouterLink>
    </div>
  </main>
</template>
