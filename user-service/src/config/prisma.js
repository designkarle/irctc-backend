const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { config } = require('./');
const connectionString = config.DATABASE_URL;

const globalForPrisma = global;

if (!globalForPrisma.prisma) {
     // B5: the adapter used to be constructed with only a connection string, which
     // left node-postgres on its defaults: max 10 connections and — critically — NO
     // acquisition timeout. Once the pool saturated, requests queued forever instead
     // of failing, health checks queued behind them, and the instance looked healthy
     // right up until it stopped responding. Nothing ever surfaced an error.
     //
     // Sizing note: DB_POOL_MAX is PER PROCESS. Keep
     //   (DB_POOL_MAX x instances x services) < postgres max_connections (default 100).
     const adapter = new PrismaPg({
          connectionString,

          // Pool size.
          max: config.DB_POOL_MAX,

          // Fail fast when the pool is saturated instead of queueing indefinitely.
          // Callers get a real error they can surface, retry, or trip a breaker on.
          connectionTimeoutMillis: config.DB_CONNECTION_TIMEOUT_MS,

          // Reap idle connections so a traffic spike doesn't pin the pool open forever.
          idleTimeoutMillis: config.DB_IDLE_TIMEOUT_MS,

          // Server-side ceiling: Postgres itself aborts a runaway query. This is the
          // backstop for a missing index or an accidental full scan under load.
          statement_timeout: config.DB_STATEMENT_TIMEOUT_MS,
     });

     globalForPrisma.prisma = new PrismaClient({
          adapter,
          log: ['error', 'warn'],
     });
}

const prisma = globalForPrisma.prisma;

module.exports = prisma;
