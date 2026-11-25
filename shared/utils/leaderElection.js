const os = require('os');
const crypto = require('crypto');

/**
 * Database-backed leader election with a lease.
 *
 * Replaces two different broken mechanisms (B3, and the pooling hazard in the
 * inventory job):
 *
 *   booking-service used Redis `SET NX EX`. When Redis was down, tryAcquire
 *   returned false for every instance, so NO instance ran the expiry job at all —
 *   held seats accumulated indefinitely, and the outage silently disabled the one
 *   thing that recovers them.
 *
 *   inventory-service used `pg_try_advisory_lock`. Advisory locks are SESSION
 *   scoped, but Prisma's pooled adapter can hand the acquire and the release to
 *   different pooled connections. The unlock then targets a session that doesn't
 *   hold the lock, and the real holder keeps it until that connection is recycled
 *   — permanently wedging the job, with no symptom except seats slowly becoming
 *   unbookable.
 *
 * A lease row has neither problem: the write is a single atomic statement, it is
 * connection-agnostic, and it self-heals because a crashed leader's lease simply
 * expires. It also lives in the same database as the work being coordinated, so
 * it cannot be unavailable while the job still has something to do.
 */

// Identity must be unique per PROCESS INSTANCE, not per pid: a restarted process
// can reuse a pid, and two hosts can share one. The nonce makes reuse impossible.
const HOLDER_ID = `${os.hostname()}:${process.pid}:${crypto.randomBytes(4).toString('hex')}`;

function createLeaderElection({ prisma, logger, name, leaseSeconds = 60 }) {
     if (!prisma || !logger || !name) {
          throw new Error('createLeaderElection requires prisma, logger and name');
     }

     let renewTimer = null;

     /**
      * Atomically claim or renew the lease.
      *
      * The ON CONFLICT ... WHERE clause is the whole mechanism: the row is only
      * taken over if the existing lease has expired, or if we already hold it
      * (which makes this double as the renewal statement). Otherwise zero rows
      * come back and someone else is leader.
      */
     async function acquire() {
          try {
               const rows = await prisma.$queryRaw`
                    INSERT INTO leader_leases ("name", "holder", "expiresAt", "updatedAt")
                    VALUES (${name}, ${HOLDER_ID}, NOW() + make_interval(secs => ${leaseSeconds}), NOW())
                    ON CONFLICT ("name") DO UPDATE
                         SET "holder"    = EXCLUDED."holder",
                             "expiresAt" = EXCLUDED."expiresAt",
                             "updatedAt" = NOW()
                         WHERE leader_leases."expiresAt" < NOW()
                            OR leader_leases."holder" = EXCLUDED."holder"
                    RETURNING "holder"
               `;
               return rows.length > 0 && rows[0].holder === HOLDER_ID;
          } catch (err) {
               logger.error(`Leader election failed for "${name}"`, { error: err.message });
               return false;
          }
     }

     /** Give the lease up immediately so another instance can take over. */
     async function release() {
          try {
               await prisma.$executeRaw`
                    DELETE FROM leader_leases
                    WHERE "name" = ${name} AND "holder" = ${HOLDER_ID}
               `;
          } catch (err) {
               // Non-fatal: the lease expires on its own.
               logger.warn(`Failed to release leadership for "${name}"`, { error: err.message });
          }
     }

     /**
      * Run `fn` as the leader, holding the lease for as long as it takes.
      *
      * The lease is renewed on a timer at a third of its duration. Without this a
      * long cycle (the expiry job makes serial HTTP calls, each with retries) would
      * outlive its own lease and a second instance would start the same work
      * concurrently — which is exactly the race the old 25s Redis TTL had.
      *
      * @returns {Promise<boolean>} false if another instance holds the lease.
      */
     async function withLeadership(fn) {
          const isLeader = await acquire();
          if (!isLeader) {
               logger.debug(`Not the leader for "${name}", skipping cycle`);
               return false;
          }

          const renewIntervalMs = Math.max(5_000, Math.floor((leaseSeconds * 1000) / 3));
          renewTimer = setInterval(async () => {
               const stillLeader = await acquire();
               if (!stillLeader) {
                    logger.warn(`Lost leadership for "${name}" mid-cycle — lease was taken over`);
               }
          }, renewIntervalMs);
          if (typeof renewTimer.unref === 'function') renewTimer.unref();

          try {
               await fn();
               return true;
          } finally {
               clearInterval(renewTimer);
               renewTimer = null;
               await release();
          }
     }

     return { acquire, release, withLeadership, holderId: HOLDER_ID };
}

module.exports = { createLeaderElection, HOLDER_ID };
