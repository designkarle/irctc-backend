const os = require('os');
const crypto = require('crypto');

/**
 * Transactional outbox.
 *
 * ─── The problem this solves (B1) ────────────────────────────────────────────
 * Every cross-service event was published AFTER its database transaction
 * committed, in a separate try/catch that only logged on failure:
 *
 *      await prisma.$transaction(...)        // seats confirmed, booking CONFIRMED
 *      try { await producer.send(...) }      // <-- Kafka down? just a log line
 *      catch (e) { logger.error('CRITICAL: ... search may be stale') }
 *
 * So a Kafka outage left the database perfectly correct and the rest of the
 * system permanently wrong: search kept showing seats that were already booked,
 * and paying customers never got a ticket email. Nothing repaired either — there
 * was no outbox, no CDC and no reconciliation.
 *
 * ─── How this fixes it ───────────────────────────────────────────────────────
 * The event row is written INSIDE the same transaction as the state change, so
 * the commit is the single point at which "this happened" and "this will be
 * announced" both become true — or neither does. A relay then publishes rows and
 * stamps them published.
 *
 * Delivery becomes at-least-once rather than at-most-once. That is the right
 * trade here because every consumer in this system is already idempotent
 * (state-machine guards on the booking side, idempotency keys on the inventory
 * side), so a duplicate is harmless while a loss is not.
 *
 * Kafka being down now means events queue up and drain on recovery, instead of
 * being lost.
 */

const RELAY_ID = `${os.hostname()}:${process.pid}:${crypto.randomBytes(4).toString('hex')}`;

// A claimed-but-unfinished row (relay crashed mid-publish) becomes eligible again
// after this long.
const CLAIM_STALE_SECONDS = 120;

// Cap the exponential backoff so a long outage doesn't push retries hours out.
const MAX_BACKOFF_SECONDS = 300;

/**
 * @param {object}   opts
 * @param {object}   opts.prisma       service's Prisma client
 * @param {object}   opts.logger       service's Winston logger
 * @param {Function} opts.sendMessage  (topic, key, payload) => Promise — the service's producer
 * @param {number}  [opts.intervalMs]  relay poll interval
 * @param {number}  [opts.batchSize]   rows claimed per pass
 */
function createOutbox({ prisma, logger, sendMessage, intervalMs = 1000, batchSize = 100 }) {
     if (!prisma || !logger || !sendMessage) {
          throw new Error('createOutbox requires prisma, logger and sendMessage');
     }

     let relayTimer = null;
     let passInFlight = null;
     let stopped = false;

     /**
      * Record an event as part of the caller's transaction.
      *
      * MUST be passed the transaction client (`tx`), not the base prisma client —
      * passing the base client silently reintroduces the very dual-write bug this
      * module exists to prevent.
      */
     async function enqueue(tx, { topic, key, payload }) {
          if (!tx || typeof tx.outboxEvent?.create !== 'function') {
               throw new Error('enqueue() requires a Prisma transaction client');
          }
          if (!topic) throw new Error('enqueue() requires a topic');

          await tx.outboxEvent.create({
               data: {
                    topic,
                    eventKey: key || `${topic}-${Date.now()}`,
                    payload,
               },
          });
     }

     /**
      * Claim a batch of due rows.
      *
      * FOR UPDATE SKIP LOCKED lets every instance run the relay concurrently
      * without coordination — each claims a disjoint set — so this needs no leader
      * election and scales with the service.
      */
     async function claimBatch() {
          return prisma.$queryRaw`
               UPDATE outbox_events o
               SET "claimedAt" = NOW(),
                   "claimedBy" = ${RELAY_ID},
                   "attempts"  = o."attempts" + 1
               FROM (
                    SELECT id FROM outbox_events
                    WHERE "publishedAt" IS NULL
                      AND "nextAttemptAt" <= NOW()
                      AND ("claimedAt" IS NULL
                           OR "claimedAt" < NOW() - make_interval(secs => ${CLAIM_STALE_SECONDS}))
                    ORDER BY "createdAt"
                    LIMIT ${batchSize}
                    FOR UPDATE SKIP LOCKED
               ) due
               WHERE o.id = due.id
               RETURNING o.id, o.topic, o."eventKey", o.payload, o.attempts
          `;
     }

     async function markPublished(id) {
          await prisma.$executeRaw`
               UPDATE outbox_events
               SET "publishedAt" = NOW(), "claimedAt" = NULL, "lastError" = NULL
               WHERE id = ${id}
          `;
     }

     async function markFailed(id, attempts, error) {
          const backoffSeconds = Math.min(2 ** Math.min(attempts, 10), MAX_BACKOFF_SECONDS);
          await prisma.$executeRaw`
               UPDATE outbox_events
               SET "claimedAt"     = NULL,
                   "lastError"     = ${String(error).slice(0, 500)},
                   "nextAttemptAt" = NOW() + make_interval(secs => ${backoffSeconds})
               WHERE id = ${id}
          `;
     }

     /** One relay pass. Exposed for tests and for a final drain on shutdown. */
     async function relayOnce() {
          const batch = await claimBatch();
          if (batch.length === 0) return { published: 0, failed: 0 };

          let published = 0;
          let failed = 0;

          for (const row of batch) {
               try {
                    await sendMessage(row.topic, row.eventKey, row.payload);
                    await markPublished(row.id);
                    published++;
               } catch (error) {
                    failed++;
                    await markFailed(row.id, row.attempts, error.message);

                    // Kafka is almost certainly down for the whole batch; stop hammering
                    // it and let the next pass retry.
                    logger.warn('Outbox publish failed — will retry', {
                         outboxId: row.id,
                         topic: row.topic,
                         attempts: row.attempts,
                         error: error.message,
                    });
                    break;
               }
          }

          if (published > 0) {
               logger.info(`Outbox relay published ${published} event(s)`);
          }

          return { published, failed };
     }

     async function runPass() {
          if (stopped || passInFlight) return passInFlight;

          passInFlight = (async () => {
               try {
                    await relayOnce();
               } catch (error) {
                    logger.error('Outbox relay pass failed', { error: error.message });
               } finally {
                    passInFlight = null;
               }
          })();

          return passInFlight;
     }

     function startRelay() {
          stopped = false;
          relayTimer = setInterval(runPass, intervalMs);
          if (typeof relayTimer.unref === 'function') relayTimer.unref();
          logger.info(`Outbox relay started (interval: ${intervalMs}ms, batch: ${batchSize})`);
     }

     /**
      * Stop polling, wait for the in-flight pass, then make one final attempt to
      * drain whatever is pending so a clean shutdown doesn't leave events sitting
      * until the next instance picks them up.
      */
     async function stopRelay() {
          stopped = true;
          if (relayTimer) {
               clearInterval(relayTimer);
               relayTimer = null;
          }

          if (passInFlight) {
               try { await passInFlight; } catch { /* logged inside */ }
          }

          try {
               stopped = false;             // allow the final drain
               const { published } = await relayOnce();
               if (published > 0) logger.info(`Outbox drained ${published} event(s) on shutdown`);
          } catch (error) {
               logger.warn('Outbox final drain failed — events remain queued for another instance', {
                    error: error.message,
               });
          } finally {
               stopped = true;
          }

          logger.info('Outbox relay stopped');
     }

     return { enqueue, startRelay, stopRelay, relayOnce, relayId: RELAY_ID };
}

module.exports = { createOutbox, RELAY_ID };
