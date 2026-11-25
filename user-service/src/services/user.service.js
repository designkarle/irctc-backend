const { config } = require("../config");
const prisma = require('../config/prisma');
const logger = require('../config/logger');
const { NotFoundError } = require('../utils/error');
const { cacheGet, cacheSet, cacheDel } = require('../utils/cache');

const userCacheKey = (userId) => `user:${userId}`;

const getProfile = async (userId) => {
     // B4: cache-aside. A Redis failure returns null here rather than throwing,
     // so the request falls through to the database instead of 500-ing.
     const cached = await cacheGet(userCacheKey(userId));
     if (cached) {
          logger.info(`Profile cache hit for user ${userId}`);
          return cached;
     }

     const userProfile = await prisma.user.findUnique({ where: { id: userId } });

     // Previously this destructured straight into `userProfile`, which threw a
     // TypeError for a deleted or unknown id instead of returning a clean 404.
     if (!userProfile) {
          throw new NotFoundError('User not found');
     }

     const { password: _password, ...safeUser } = userProfile;

     await cacheSet(userCacheKey(userId), safeUser, config.REDIS_USER_TTL);

     return safeUser;
};

/**
 * Drop a user's cached profile.
 *
 * The cache carries a 24h TTL and nothing has ever invalidated it — harmless only
 * because updateProfile/deleteProfile are still unimplemented stubs. Call this from
 * every write path when those are filled in, or profile edits will appear to be
 * ignored for up to a day.
 */
const invalidateProfile = async (userId) => {
     await cacheDel(userCacheKey(userId));
};

module.exports = { getProfile, invalidateProfile };
