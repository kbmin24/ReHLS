import { createRouter, createWebHistory } from 'vue-router';
import { useSession } from './composables/useSession';
import AccountView from './views/AccountView.vue';
import AdminView from './views/AdminView.vue';
import AdminUsersView from './views/AdminUsersView.vue';
import LoginView from './views/LoginView.vue';
import NotFoundView from './views/404.vue';
import PlaceholderView from './views/PlaceholderView.vue';
import LibraryView from './views/LibraryView.vue';
import PlayerView from './views/PlayerView.vue';

declare module 'vue-router' {
  interface RouteMeta {
    pageType?: 'special' | 'app' | 'admin' | 'user';
    requiresAdmin?: boolean;
    title?: string;
    maxWidth?: '5xl' | '7xl' | 'none';
  }
}

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      redirect: '/home'
    },
    { path: '/login',
      name: 'login',
      component: LoginView,
      meta: { pageType: 'special' }
    },
    { path: '/home', name: 'home', component: PlaceholderView,
      props: { description: 'Your favorite channels will appear here.' },
      meta: { pageType: 'app', title: 'Home' }
    },
    { path: '/library', name: 'library', component: LibraryView,
      meta: { pageType: 'app', title: 'Library' }
    },
    { path: '/player',
      name: 'player', 
      component: PlayerView,
      meta: { pageType: 'app', title: 'Player', maxWidth: 'none' }
    },
    {
      path: '/admin',
      name: 'admin',
      component: AdminView,
      meta: {requiresAdmin: true, pageType: 'admin', title: 'Admin' }
    },
    {
      path: '/admin/users',
      name: 'admin-users',
      component: AdminUsersView,
      meta: {requiresAdmin: true, pageType: 'admin', title: 'Accounts'}
    },
    {
      path: '/account',
      name: 'account', 
      component: AccountView,
      meta: { pageType: 'user', title: 'Your account' }
    },
    {
      path: '/:pathMatch(.*)*',
      name: 'not-found',
      component: NotFoundView,
      meta: { pageType: 'special' }
    },
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
