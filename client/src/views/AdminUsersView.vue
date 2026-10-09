<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api, ApiError, errorText, type Account } from '../api';
import { useSession } from '../composables/useSession';

const router = useRouter();
const session = useSession();
const users = ref<Account[]>([]);
const loading = ref(true);
const busy = ref(false);
const error = ref('');
const notice = ref('');
const username = ref('');
const password = ref('');
const role = ref<'admin' | 'user'>('user');
const resetId = ref<string | null>(null);
const replacement = ref('');

function failed(cause: unknown) {
  if (cause instanceof ApiError && cause.status === 401) {
    session.clearUser();
    void router.replace({ name: 'login' });
  } else error.value = errorText(cause);
}

async function loadUsers() {
  loading.value = true;
  error.value = '';
  try {
    users.value = (await api<{ users: Account[] }>('/api/admin/users')).users;
  } catch (cause) {
    failed(cause);
  } finally {
    loading.value = false;
  }
}

async function createUser() {
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    await api('/api/admin/users', { method: 'POST', body: JSON.stringify({ username: username.value, password: password.value, role: role.value }) });
    username.value = '';
    password.value = '';
    role.value = 'user';
    notice.value = 'Account created.';
    await loadUsers();
  } catch (cause) {
    failed(cause);
  } finally {
    busy.value = false;
  }
}

async function disableUser(user: Account) {
  if (!window.confirm(`Disable ${user.username}? They will be signed out.`)) return;
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    await api(`/api/admin/users/${user.id}/disable`, { method: 'POST' });
    notice.value = `${user.username} disabled.`;
    await loadUsers();
  } catch (cause) {
    failed(cause);
  } finally {
    busy.value = false;
  }
}

async function resetPassword(user: Account) {
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    await api(`/api/admin/users/${user.id}/reset-password`, { method: 'POST', body: JSON.stringify({ password: replacement.value }) });
    replacement.value = '';
    resetId.value = null;
    if (user.id === session.user.value?.id) {
      session.clearUser();
      await router.replace({ name: 'login' });
    }
    else notice.value = `Password reset for ${user.username}.`;
  } catch (cause) {
    failed(cause);
  } finally {
    busy.value = false;
  }
}

onMounted(loadUsers);
</script>

<template>
  <main class="mx-auto max-w-5xl space-y-10 px-5 py-10 md:px-10">
    <div>
      <p class="text-base-content/70">Create accounts and manage access to this ReHLS instance.</p>
    </div>

    <p v-if="error" role="alert" class="alert alert-error text-sm">{{ error }}</p>
    <p v-if="notice" role="status" class="alert alert-success text-sm">{{ notice }}</p>

    <section aria-labelledby="create-title" class="card border border-base-content/10 bg-base-200 p-6">
      <h2 id="create-title" class="text-xl font-semibold">Create account</h2>
      <form class="mt-5 grid gap-4 md:grid-cols-[1fr_1fr_9rem_auto] md:items-end" @submit.prevent="createUser">
        <div class="space-y-2">
          <label for="new-username" class="block text-sm font-medium">Username</label>
          <input id="new-username" v-model="username" autocomplete="off" required maxlength="100" class="input w-full" />
        </div>
        <div class="space-y-2">
          <label for="new-password" class="block text-sm font-medium">Initial password</label>
          <input id="new-password" v-model="password" type="password" autocomplete="new-password" required minlength="12" maxlength="4096" class="input w-full" />
        </div>
        <div>
          <label for="new-role" class="mb-2 block text-sm font-medium">Role</label>
          <select id="new-role" v-model="role" class="select w-full max-w-48"><option value="user">User</option><option value="admin">Admin</option></select>
        </div>
        <button type="submit" :disabled="busy" class="btn btn-primary">{{ busy ? 'Working...' : 'Create' }}</button>
      </form>
    </section>

    <section aria-labelledby="users-title">
      <div class="flex items-center justify-between gap-4">
        <h2 id="users-title" class="text-xl font-semibold">People</h2>
        <button type="button" :disabled="loading" class="btn btn-link btn-sm" @click="loadUsers">Refresh</button>
      </div>
      <p v-if="loading" role="status" class="mt-4 text-sm text-base-content/70">Loading accounts...</p>
      <p v-else-if="users.length === 0 && !error" class="mt-4 rounded-lg border border-dashed border-base-content/20 p-6 text-base-content/70">No accounts yet. Create one above.</p>
      <ul v-else-if="users.length > 0" class="mt-4 divide-y divide-base-content/10 overflow-hidden rounded-xl border border-base-content/10 bg-base-200">
        <li v-for="user in users" :key="user.id" class="p-5">
          <div class="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p class="font-semibold">{{ user.username }} <span v-if="user.id === session.user.value?.id" class="text-sm font-normal text-base-content/50">(you)</span></p>
              <p class="mt-1 text-sm text-base-content/70">{{ user.role === 'admin' ? 'Admin' : 'User' }} | {{ user.disabled_at ? 'Disabled' : 'Active' }}</p>
            </div>
            <div class="flex flex-wrap gap-4 text-sm font-semibold">
              <button type="button" :disabled="busy" class="btn btn-link btn-sm" @click="resetId = resetId === user.id ? null : user.id; replacement = ''">Reset password</button>
              <button v-if="!user.disabled_at && user.id !== session.user.value?.id" type="button" :disabled="busy" class="btn btn-link btn-error btn-sm" @click="disableUser(user)">Disable</button>
            </div>
          </div>
          <form v-if="resetId === user.id" class="mt-5 flex flex-col gap-3 border-t border-base-content/10 pt-5 sm:flex-row sm:items-end" @submit.prevent="resetPassword(user)">
            <div class="max-w-sm flex-1 space-y-2">
              <label :for="`reset-${user.id}`" class="block text-sm font-medium">New password for {{ user.username }}</label>
              <input :id="`reset-${user.id}`" v-model="replacement" type="password" autocomplete="new-password" required minlength="12" maxlength="4096" class="input w-full" />
            </div>
            <button type="submit" :disabled="busy" class="btn btn-primary">Save password</button>
          </form>
        </li>
      </ul>
    </section>
  </main>
</template>
