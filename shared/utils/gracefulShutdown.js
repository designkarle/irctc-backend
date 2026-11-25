/**
 * Ordered graceful shutdown.
 *
 * ─── What was wrong (B7) ─────────────────────────────────────────────────────
 * Every service did some variant of:
 *
 *      server.close(async () => {          // <-- callback may never fire
 *           await disconnectAll();          //     if a keep-alive connection hangs
 *           process.exit(0);
 *      });
 *
 * Kafka teardown was nested INSIDE the HTTP close callback, so a single lingering
 * connection meant the consumer was never disconnected and in-flight messages were
 * abandoned. KafkaJS auto-commits every 5s / 100 messages, so a handler could be
 * half-done with its offset already committed — a `payment.success` that confirmed
 * seats in inventory but never marked the booking CONFIRMED, with nothing to
 * replay it. notification-service was worse: it called process.exit(0) directly,
 * draining nothing.
 *
 * Background jobs only called clearInterval, never waiting for the running cycle,
 * so SIGTERM mid-compensation left a saga half-rolled-back.
 *
 * ─── The order that matters ──────────────────────────────────────────────────
 *   1. stop accepting new HTTP work        (but don't block on it)
 *   2. stop consuming Kafka, draining in-flight handlers
 *   3. stop background jobs, awaiting the current cycle
 *   4. drain the outbox so queued events aren't left for the next instance
 *   5. disconnect the producer — AFTER everything that might still publish
 *   6. close database and cache connections
 *
 * Each step is independently guarded: one failure never prevents the rest from
 * running. A hard timeout guarantees the process eventually exits either way.
 */

/**
 * Close an HTTP server without hanging on keep-alive connections.
 * Node's server.close() waits for every open connection to end on its own, which
 * a keep-alive client will happily never do.
 */
function closeHttpServer(server, logger, graceMs = 10_000) {
     return new Promise((resolve) => {
          let settled = false;
          const done = () => {
               if (settled) return;
               settled = true;
               resolve();
          };

          server.close(done);

          // Let in-flight requests finish, but evict idle keep-alive sockets now.
          if (typeof server.closeIdleConnections === 'function') {
               server.closeIdleConnections();
          }

          const forceTimer = setTimeout(() => {
               if (settled) return;
               logger.warn(`HTTP server still had open connections after ${graceMs}ms — forcing close`);
               if (typeof server.closeAllConnections === 'function') {
                    server.closeAllConnections();
               }
               done();
          }, graceMs);

          if (typeof forceTimer.unref === 'function') forceTimer.unref();
     });
}

/**
 * @param {object}   opts
 * @param {object}   opts.logger
 * @param {Array<{name: string, fn: Function}>} opts.steps  run in order
 * @param {number}  [opts.timeoutMs]  hard deadline before force-exit
 */
function installGracefulShutdown({ logger, steps, timeoutMs = 30_000 }) {
     let shuttingDown = false;

     const shutdown = async (signal) => {
          if (shuttingDown) {
               // Second signal: the operator is asking us to stop waiting.
               logger.warn(`Received ${signal} during shutdown — exiting immediately`);
               process.exit(1);
          }
          shuttingDown = true;

          logger.info(`Received ${signal}, shutting down gracefully...`);

          const forceExit = setTimeout(() => {
               logger.error(`Graceful shutdown exceeded ${timeoutMs}ms — forcing exit`);
               process.exit(1);
          }, timeoutMs);
          if (typeof forceExit.unref === 'function') forceExit.unref();

          for (const { name, fn } of steps) {
               try {
                    await fn();
                    logger.info(`Shutdown step complete: ${name}`);
               } catch (error) {
                    // Never let one failed step strand the others — especially the
                    // consumer drain, which is the one that prevents message loss.
                    logger.error(`Shutdown step failed: ${name}`, { error: error.message });
               }
          }

          clearTimeout(forceExit);
          logger.info('Shutdown complete');
          process.exit(0);
     };

     process.on('SIGTERM', () => shutdown('SIGTERM'));
     process.on('SIGINT', () => shutdown('SIGINT'));

     return { shutdown, isShuttingDown: () => shuttingDown };
}

module.exports = { installGracefulShutdown, closeHttpServer };
