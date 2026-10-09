import { ref } from 'vue';
import { api, ApiError, errorText, type Account } from '../api';

const user = ref<Account | null>(null);
const ready = ref(false);
const error = ref('');
let pending: Promise<void> | null = null;

function load(force = false): Promise<void> {
  if (pending) return pending;
  if (ready.value && !force) return Promise.resolve();

  pending = (async () => {
    error.value = '';
    try {
      user.value = (await api<{ user: Account }>('/api/auth/me')).user;
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) user.value = null;
      else error.value = errorText(cause);
    } finally {
      ready.value = true;
    }
  })().finally(() => { pending = null; });
  return pending;
}

function setUser(account: Account): void {
  user.value = account;
  ready.value = true;
  error.value = '';
}

function clearUser(): void {
  user.value = null;
  ready.value = true;
  error.value = '';
}

export function useSession() {
  return { user, ready, error, load, setUser, clearUser };
}
