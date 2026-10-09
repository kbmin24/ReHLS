import { createRouter, createWebHistory } from 'vue-router';
import { useSession } from './composables/useSession';
import AccountView from './views/AccountView.vue';
import AdminUsersView from './views/AdminUsersView.vue';
import LoginView from './views/LoginView.vue';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/login' },
    { path: '/login', name: 'login', component: LoginView },
    { path: '/admin/users', name: 'admin-users', component: AdminUsersView, meta: { requiresAdmin: true } },
    { path: '/account', name: 'account', component: AccountView },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});

router.beforeEach(async (to) => {
  const session = useSession();
  await session.load();
  if (session.error.value) return true;

  if (!session.user.value) return to.name === 'login' ? true : { name: 'login' };
  if (to.name === 'login') return { name: session.user.value.role === 'admin' ? 'admin-users' : 'account' };
  if (to.meta.requiresAdmin && session.user.value.role !== 'admin') return { name: 'account' };
  return true;
});

export default router;
