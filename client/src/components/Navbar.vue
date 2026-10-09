<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { FontAwesomeIcon } from '@fortawesome/vue-fontawesome';
import { useSession } from '../composables/useSession';
import { api, errorText } from '../api';

const route = useRoute();
const router = useRouter();
const session = useSession();
const sidebarExpanded = ref(false);
const mobileSidebarOpen = ref(false);
const sidebarButton = ref<HTMLButtonElement | null>(null);
const mobileMoreButton = ref<HTMLButtonElement | null>(null);
const sidebarElement = ref<HTMLElement | null>(null);
const accountMenuElement = ref<HTMLElement | null>(null);
const accountMenuButton = ref<HTMLButtonElement | null>(null);
const accountMenuOpen = ref(false);
const signingOut = ref(false);
const actionError = ref('');

const primaryLinks = [
  { name: 'home', label: 'Home', icon: ['fa-solid', 'fa-home'] },
  { name: 'library', label: 'Library', icon: ['fa-solid', 'fa-folder-open'] },
  { name: 'player', label: 'Player', icon: ['fa-solid', 'fa-play'] },
];
const isAdmin = computed(() => session.user.value?.role === 'admin');
const pageTitle = computed(() => route.meta.title ?? 'ReHLS');
const moreActive = computed(() => route.name === 'account' || route.name === 'admin-users' || route.name === 'admin');
const showSidebarLabels = computed(() => sidebarExpanded.value || mobileSidebarOpen.value);

async function openMobileSidebar() {
  mobileSidebarOpen.value = true;
  await nextTick();
  sidebarButton.value?.focus();
}

function closeMobileSidebar(restoreFocus = false) {
  mobileSidebarOpen.value = false;
  accountMenuOpen.value = false;
  if (restoreFocus) void nextTick(() => mobileMoreButton.value?.focus());
}

function toggleSidebar() {
  if (desktopLayout.matches) sidebarExpanded.value = !sidebarExpanded.value;
  else closeMobileSidebar(true);
}

watch(() => route.fullPath, () => closeMobileSidebar());

const desktopLayout = window.matchMedia('(min-width: 768px)');
function handleDesktopLayout(event: MediaQueryListEvent) {
  if (event.matches) closeMobileSidebar();
}
function handleEscape(event: KeyboardEvent) {
  if (event.key !== 'Escape') return;
  if (accountMenuOpen.value) {
    accountMenuOpen.value = false;
    accountMenuButton.value?.focus();
  } else if (mobileSidebarOpen.value) closeMobileSidebar(true);
}
function closeAccountMenuOnOutsideClick(event: PointerEvent) {
  if (!accountMenuElement.value?.contains(event.target as Node)) accountMenuOpen.value = false;
}
function trapMobileFocus(event: KeyboardEvent) {
  if (!mobileSidebarOpen.value || event.key !== 'Tab') return;
  const controls = sidebarElement.value?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href]');
  if (!controls?.length) return;
  const first = controls[0];
  const last = controls[controls.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first?.focus();
  }
}
onMounted(() => {
  desktopLayout.addEventListener('change', handleDesktopLayout);
  window.addEventListener('keydown', handleEscape);
  document.addEventListener('pointerdown', closeAccountMenuOnOutsideClick);
});
onUnmounted(() => {
  desktopLayout.removeEventListener('change', handleDesktopLayout);
  window.removeEventListener('keydown', handleEscape);
  document.removeEventListener('pointerdown', closeAccountMenuOnOutsideClick);
});

async function signOut() {
  signingOut.value = true;
  actionError.value = '';
  try {
    await api('/api/auth/logout', { method: 'POST' });
    closeMobileSidebar();
    session.clearUser();
    await router.replace({ name: 'login' });
  } catch (cause) {
    closeMobileSidebar();
    actionError.value = errorText(cause);
  } finally {
    signingOut.value = false;
  }
}
</script>

<template>
  <div class="min-h-[100dvh] md:flex">
    <button v-if="mobileSidebarOpen" type="button" class="fixed inset-0 z-30 bg-black/60 md:hidden"
      aria-label="Close menu" @click="closeMobileSidebar(true)" />
    <aside id="app-sidebar" ref="sidebarElement" class="shrink-0 flex-col border-r border-base-content/10 bg-base-200 md:sticky md:top-0 md:h-[100dvh]"
      :class="[
        mobileSidebarOpen ? 'fixed inset-y-0 left-0 z-40 flex w-60 max-w-[calc(100vw-3rem)] shadow-2xl md:static md:shadow-none' : 'hidden md:flex',
        sidebarExpanded ? 'md:w-60' : 'md:w-16'
      ]"
      :role="mobileSidebarOpen ? 'dialog' : undefined" :aria-modal="mobileSidebarOpen ? 'true' : undefined"
      :aria-label="mobileSidebarOpen ? 'Main menu' : undefined" @keydown="trapMobileFocus">
      <div class="flex min-h-18 items-center border-b border-base-content/10 px-3">
        <button ref="sidebarButton" type="button" class="btn btn-ghost btn-square shrink-0"
          :aria-label="mobileSidebarOpen ? 'Close menu' : sidebarExpanded ? 'Collapse sidebar' : 'Expand sidebar'"
          :aria-expanded="mobileSidebarOpen || sidebarExpanded" @click="toggleSidebar">
          <font-awesome-icon :icon="['fa-solid', 'fa-bars']" class="text-xl leading-none"/>
        </button>
        <RouterLink v-show="showSidebarLabels" to="/" custom v-slot="{ navigate }">
            <img src="../assets/ReHLS_logo_full.png" routerLink="/" alt="ReHLS" class="ml-3 w-full cursor-pointer" @click="navigate" />
        </RouterLink>
      </div>

      <nav aria-label="Main navigation" class="flex flex-1 flex-col gap-1 p-2 text-sm">
        <RouterLink v-for="link in primaryLinks" :key="link.name" :to="{ name: link.name }"
          class="flex min-h-11 items-center rounded-lg px-3 hover:bg-base-content/10"
          :class="route.name === link.name ? 'bg-primary/20 font-semibold text-primary' : ''"
          :aria-label="link.label" :aria-current="route.name === link.name ? 'page' : undefined"
          @click="closeMobileSidebar()">
            <font-awesome-icon :icon=link.icon aria-hidden="true" class="w-6 shrink-0 text-center text-lg"/>
            <span v-show="showSidebarLabels" class="ml-3">{{ link.label }}</span>
        </RouterLink>

      </nav>
      <div ref="accountMenuElement" class="relative border-t border-base-content/10 p-2 text-sm">
        <button ref="accountMenuButton" type="button" class="flex min-h-11 w-full min-w-0 items-center rounded-lg px-3 text-left hover:bg-base-content/10"
          aria-label="Account menu" aria-controls="account-menu" :aria-expanded="accountMenuOpen" @click="accountMenuOpen = !accountMenuOpen">
          <font-awesome-icon :icon="['fa-solid', 'fa-circle-user']" aria-hidden="true" class="w-6 shrink-0 text-center text-lg" />
          <span v-show="showSidebarLabels" class="ml-3 min-w-0 truncate">{{ session.user.value?.username }}</span>
        </button>
        <div v-if="accountMenuOpen" id="account-menu" class="absolute bottom-full left-2 z-50 mb-2 w-52 rounded-lg border border-base-content/15 bg-base-200 p-1 shadow-xl">
          <RouterLink :to="{ name: 'account' }" class="flex min-h-11 items-center rounded-lg px-3 gap-3 hover:bg-base-content/10"
            :aria-current="route.name === 'account' ? 'page' : undefined" @click="closeMobileSidebar()"><font-awesome-icon :icon="['fa-solid', 'fa-circle-user']" aria-hidden="true" />Your Account</RouterLink>
          <RouterLink v-if="isAdmin" :to="{ name: 'admin' }" class="flex min-h-11 items-center gap-3 rounded-lg px-3 hover:bg-base-content/10"
            :aria-current="route.name === 'admin' ? 'page' : undefined" @click="closeMobileSidebar()">
            <font-awesome-icon :icon="['fa-solid', 'fa-screwdriver-wrench']" aria-hidden="true" />Admin
          </RouterLink>
          <button type="button" :disabled="signingOut" class="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left hover:bg-base-content/10 disabled:opacity-50"
            @click="signOut"><font-awesome-icon :icon="['fa-solid', 'fa-right-from-bracket']" aria-hidden="true" />Sign out</button>
        </div>
      </div>
    </aside>

    <div class="min-w-0 flex-1 pb-24 md:pb-0">
      <div class="mx-auto max-w-5xl px-5 pt-7 md:px-10 md:pt-9">
        <h1 class="text-3xl font-semibold tracking-tight">{{ pageTitle }}</h1>
      </div>
      <slot />
    </div>

    <nav aria-label="Mobile navigation" class="fixed inset-x-0 bottom-0 z-20 grid grid-cols-4 border-t border-base-content/15 bg-base-200 px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] text-center text-sm md:hidden">
      <button ref="mobileMoreButton" type="button" class="flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-lg px-1 hover:bg-base-content/10"
        :class="moreActive || mobileSidebarOpen ? 'bg-primary/20 font-semibold text-primary' : ''"
        aria-controls="app-sidebar" :aria-expanded="mobileSidebarOpen" @click="openMobileSidebar">
        <font-awesome-icon :icon="['fa-solid', 'fa-bars']" class="text-xl leading-none"/><span class="text-xs">Menu</span>
      </button>
      <RouterLink v-for="link in primaryLinks" :key="link.name" :to="{ name: link.name }"
        class="flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-lg px-1 hover:bg-base-content/10"
        :class="route.name === link.name ? 'bg-primary/20 font-semibold text-primary' : ''"
        :aria-current="route.name === link.name ? 'page' : undefined">
        <font-awesome-icon :icon="link.icon" aria-hidden="true" class="text-xl leading-none" /><span class="text-xs">{{ link.label }}</span>
      </RouterLink>
    </nav>

    <dialog v-if="actionError" open class="modal" role="alertdialog" aria-modal="true"
      aria-labelledby="signout-error-title" @click.self="actionError = ''">
      <div class="modal-box">
        <h2 id="signout-error-title" class="text-lg font-semibold">Sign out failed</h2>
        <p>{{ actionError }}</p>
        <div class="modal-action">
          <button type="button" class="btn btn-primary" @click="actionError = ''">Close</button>
        </div>
      </div>
    </dialog>
  </div>
</template>
