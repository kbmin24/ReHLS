<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { api, errorText, type Account } from '../api';
import { useSession } from '../composables/useSession';

const router = useRouter();
const session = useSession();
const username = ref('');
const password = ref('');
const busy = ref(false);
const error = ref('');

async function signIn() {
  busy.value = true;
  error.value = '';
  try {
    const result = await api<{ user: Account }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: username.value, password: password.value }),
    });
    password.value = '';
    session.setUser(result.user);
    await router.replace({ name: result.user.role === 'admin' ? 'admin-users' : 'account' });
  } catch (cause) {
    error.value = errorText(cause);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <main class="login-background grid min-h-[100dvh] place-items-center px-5 py-10">
    <section aria-labelledby="sign-in-title"
      class="card w-full max-w-md border border-base-content/10 bg-base-200/65 shadow-2xl backdrop-blur-xl">
      <div class="card-body gap-0 p-7 sm:p-9">
        <img src="../assets/ReHLS_logo_full.png" width="100%">
        <form class="mt-7 space-y-5" @submit.prevent="signIn">
          <fieldset class="fieldset">
            <label for="username" class="fieldset-legend">Username</label>
            <input id="username" v-model="username" name="username" autocomplete="username" required maxlength="100"
              class="input w-full" />
          </fieldset>
          <fieldset class="fieldset">
            <label for="password" class="fieldset-legend">Password</label>
            <input id="password" v-model="password" name="password" type="password" autocomplete="current-password"
              required class="input w-full" />
          </fieldset>
          <p v-if="error" role="alert" class="alert alert-error text-sm">{{ error }}</p>
          <button type="submit" :disabled="busy" class="btn btn-primary w-full">{{ busy ? 'Signing in...' : 'Sign in'
            }}</button>
        </form>
      </div>
    </section>
  </main>
  <div class="image-copyright text-sm text-base-content/50">Image by Antonio Cansino on Pixabay</div>
</template>

<style scoped>
.login-background {
  background: center / cover no-repeat url('../assets/antonio_cansino-cinema-5069314_1920.jpg');
}

.image-copyright {
  position: fixed;
  bottom: 1rem;
  right: 1.5rem;
}
</style>
