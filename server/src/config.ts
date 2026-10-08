export type Config = {
  databaseUrl: string;
  sessionSecret: string;
  appOrigin: string;
  port: number;
  trustProxy: boolean;
};

export function loadConfig(env: Record<string, string | undefined>): Config {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL must be a PostgreSQL URL');
  let database: URL;
  try {
    database = new URL(databaseUrl);
  } catch {
    throw new Error('DATABASE_URL must be a PostgreSQL URL');
  }
  if (!['postgres:', 'postgresql:'].includes(database.protocol) || !database.hostname) {
    throw new Error('DATABASE_URL must be a PostgreSQL URL');
  }

  const sessionSecret = env.SESSION_SECRET;
  if (!sessionSecret || sessionSecret.length < 32) {
    throw new Error('SESSION_SECRET must have at least 32 characters');
  }

  const appOrigin = env.APP_ORIGIN;
  if (!appOrigin) throw new Error('APP_ORIGIN must be an HTTP(S) origin');
  let origin: URL;
  try {
    origin = new URL(appOrigin);
  } catch {
    throw new Error('APP_ORIGIN must be an HTTP(S) origin');
  }
  if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== appOrigin) {
    throw new Error('APP_ORIGIN must be an HTTP(S) origin');
  }

  const port = Number(env.PORT ?? '3000');
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be between 1 and 65535');
  }

  const trustProxy = env.TRUST_PROXY ?? 'false';
  if (trustProxy !== 'true' && trustProxy !== 'false') {
    throw new Error('TRUST_PROXY must be true or false');
  }

  return { databaseUrl, sessionSecret, appOrigin, port, trustProxy: trustProxy === 'true' };
}
