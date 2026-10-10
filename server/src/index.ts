import path from 'node:path';
import { fileURLToPath } from 'node:url';

import express from 'express';
import session, { type Store } from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import { sql } from 'kysely';
import helmet from 'helmet';

import { loadConfig, type Config } from './config.js';
import { createDb, createPool } from './db/pool.js';
import { AppError, NotFoundError, errorHandler } from './utils/errors/errors.js';
import { app as appErrors } from './utils/errors/errorCodes.js';
import { loginRateLimit, publicRateLimit } from './middlewares/rate-limit.js';
import { UserRepository } from './user/user.repository.js';
import { UserService } from './user/user.service.js';
import { userRoutes, type UserActions } from './user/user.routes.js';
import { AdminService } from './admin/admin.service.js';
import { adminRoutes, type AdminActions } from './admin/admin.routes.js';
import { ChannelRepository } from './channel/channel.repository.js';
import { ChannelService } from './channel/channel.service.js';
import { channelRoutes } from './channel/channel.routes.js';
import { PlaylistRepository } from './playlist/playlist.repository.js';
import { PlaylistService } from './playlist/playlist.service.js';
import { playlistRoutes } from './playlist/playlist.routes.js';

export type HealthDatabase = { query(sql: string): Promise<unknown> };
export type AuthSetup = { config: Config; users: UserActions; sessionStore: Store; admin?: AdminActions;
  playlists?: PlaylistService; channels?: ChannelService };

export function createApp(db: HealthDatabase, auth?: AuthSetup): express.Express {
  const app = express();
  if (auth?.config.trustProxy) app.set('trust proxy', 1);
  app.use(helmet());
  app.use(publicRateLimit());
  app.use('/api/auth/login', loginRateLimit());
  app.use(express.json({ limit: '16kb' }));

  if (auth) {
    app.use(session({
      name: 'rehls.sid',
      secret: auth.config.sessionSecret,
      store: auth.sessionStore,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: auth.config.appOrigin.startsWith('https:'),
        maxAge: 7 * 24 * 60 * 60_000,
      },
    }));
    app.use((request, _response, next) => {
      if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return next();
      if (request.get('sec-fetch-site') === 'cross-site' || request.get('origin') !== auth.config.appOrigin) {
        return next(new AppError(403, appErrors.INVALID_ORIGIN));
      }
      next();
    });
    app.use('/api/auth', userRoutes(auth.users));
    if (auth.admin) app.use('/api/admin', adminRoutes(auth.users, auth.admin));
    if (auth.playlists) app.use('/api/playlists', playlistRoutes(auth.users, auth.playlists));
    if (auth.channels) app.use('/api/channels', channelRoutes(auth.users, auth.channels));
  }

  app.get('/health', async (_request, response) => {
    try {
      await db.query('SELECT 1');
      response.json({ status: 'ok' });
    } catch {
      response.status(503).json({ status: 'unavailable' });
    }
  });

  const client = path.resolve('dist/client');
  app.use('/api', (_request, _response, next) => next(new NotFoundError()));
  app.use(express.static(client));
  app.get(/^(?!\/api\/).*/, (_request, response) => response.sendFile(path.join(client, 'index.html')));
  app.use(errorHandler);

  return app;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = loadConfig(process.env);
  const pool = createPool(config);
  const db = createDb(config, pool);
  const PgSession = connectPgSimple(session);
  const store = new PgSession({ pool, tableName: 'session', createTableIfMissing: false });
  const users = new UserService(new UserRepository(db));
  const admin = new AdminService(users);
  const channelRepository = new ChannelRepository(db);
  const channels = new ChannelService(channelRepository);
  const playlists = new PlaylistService(new PlaylistRepository(db, channelRepository));
  const app = createApp({ query: () => sql`SELECT 1`.execute(db) }, { config, users, admin, playlists, channels, sessionStore: store });

  const server = app.listen(config.port, '0.0.0.0');
  process.on('SIGTERM', () => {
    server.close(() => {
      store.close();
      void db.destroy();
    });
  });
}
