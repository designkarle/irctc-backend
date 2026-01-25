const { verifyAccessToken } = require("../utils/auth");
const { UnauthorizedError } = require("../utils/error");

function requireAuth(req, res, next) {
     const authHeader = req.headers.authorization;

     if (!authHeader || !authHeader.startsWith("Bearer ")) {
          return next(new UnauthorizedError("Authorization token missing"));
     }

     const accessToken = authHeader.split(" ")[1];

     try {
          const payload = verifyAccessToken(accessToken);
          req.user = {
               id: payload.id
          };
          next();
     } catch (err) {
          return next(new UnauthorizedError("Invalid or expired access token"));
     }
}

module.exports = { requireAuth };
