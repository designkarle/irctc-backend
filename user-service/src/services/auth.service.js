const { ConflictError, BadRequestError, ForbiddenError, UnauthorizedError } = require("../utils/error")
const {generateAndStoreOtp, verifyOtp} = require('../utils/otp');
const {sendOtpEmail, verifyOtpEmail} = require('../utils/email');
const {generateAccessToken, generateRefreshToken, verifyRefreshToken} = require('../utils/auth');
const bcrypt = require('bcrypt');
const prisma = require('../config/prisma');
const {redis} = require('../config/redis');
const { config } = require("../config");
const logger = require('../config/logger');
const jwt = require('jsonwebtoken');
const { generate } = require("otp-generator");
const {OAuth2Client} = require("google-auth-library");
const client = new OAuth2Client(config.GOOGLE_CLIENT_ID);

const sendOTP = async(firstName, lastName, email, password) =>{
     const existingUser = await prisma.user.findUnique({
          where: {email}
     })

     if(existingUser){
          throw new ConflictError("user already exists");
     }
     const hashedPassword = await bcrypt.hash(password, 12);
     const meta = {firstName, lastName, email, hashedPassword};
     const {otp, otpSessionId} = await generateAndStoreOtp(meta);
     await sendOtpEmail(email, otp);
     return {otpSessionId}
}

const verifyOTP = async(otp, otpSessionId) =>{
     const meta = await verifyOtp(otp, otpSessionId);
     if(meta === null){
          throw new BadRequestError("Invalid or expired OTP", "OTP_INVALID");
     }
     const user = await prisma.user.create({
          data: {
               firstName: meta.firstName,
               lastName: meta.lastName,
               email: meta.email,
               password: meta.hashedPassword,
               emailVerified: true
          }
     })

     await verifyOtpEmail(meta);
     return user;

}

const login = async(email, password, deviceId) =>{
     const existingUser = await prisma.user.findUnique({
          where: {email}
     })
     if(!existingUser){
          throw new BadRequestError("Email not found")
     }
     const doesPasswordMatch = await bcrypt.compare(password, existingUser.password);
     if(!doesPasswordMatch){
          throw new BadRequestError("Incorrect Password");
     }
     const accessToken = generateAccessToken(existingUser.id);
     const refreshToken = generateRefreshToken(existingUser.id);
     const {jti} = jwt.decode(refreshToken);
     await redis.set(`refresh:${existingUser.id}:${deviceId}`, jti, 'EX', config.REFRESH_TOKEN_EXP_SEC);
     const {password: _password, ...safeUser} = existingUser;
     await redis.set(`user:${existingUser.id}`, JSON.stringify(safeUser), 'EX', config.REDIS_USER_TTL);
     return {accessToken, refreshToken, loggedInUser: safeUser};
}


const rotateRefreshToken = async(refreshToken, deviceId) =>{
     const payload = verifyRefreshToken(refreshToken);
     const {id: userId, jti} = payload;
     const storedJti = await redis.get(`refresh:${userId}:${deviceId}`);
     if(!storedJti){
          throw new ForbiddenError("Session Expired", "Login AGAIN")
     }
     if(storedJti !== jti){
          await redis.del(`refresh:${userId}:${deviceId}`);
          throw new ForbiddenError("Refresh token reused", "LOGIN AGAIN")
     }
     const newAccessToken = generateAccessToken(payload.id);
     const newRefreshToken = generateRefreshToken(payload.id);
     const {jti: newJti} = jwt.decode(newRefreshToken);
     await redis.set(`refresh:${payload.id}:${deviceId}`, newJti, 'EX', config.REFRESH_TOKEN_EXP_SEC);
     return {newAccessToken, newRefreshToken};
}

const verifyGoogleIdToken = async(idToken, deviceId) =>{
     const ticket = await client.verifyIdToken({
          idToken,
          audience: config.GOOGLE_CLIENT_ID
     })
     const payload = ticket.getPayload();

     if(!payload.sub || !payload.email){
          throw new UnauthorizedError("Invalid Google Token Payload")
     }

     const googleUser = {
          provider: payload.iss,
          providerId: payload.sub,
          email: payload.email,
          firstName: payload.given_name,
          lastName: payload.family_name,
          emailVerified: payload.email_verified || false
     }


     const user = await prisma.$transaction(async (tx) =>{
          let googleAuth = await tx.authProvider.findUnique({
               where: {
                    provider_providerId: {
                         provider: googleUser.provider,
                         providerId: googleUser.providerId
                    }
               },
               include: {user: true}
          })

          if(googleAuth){
               return googleAuth.user;
          }

          let existingUser = await tx.user.findUnique({
               where: {email: googleUser.email}
          })

          if(existingUser){
               await tx.authProvider.create({
                    data: {
                         provider: googleUser.provider,
                         providerId: googleUser.providerId,
                         userId: existingUser.id
                    }
               })
               return existingUser;
          }

          return await tx.user.create({
               data: {
                    email: googleUser.email,
                    firstName: googleUser.firstName,
                    lastName: googleUser.lastName,
                    emailVerified: googleUser.emailVerified,
                    AuthProviders: {
                         create: {
                              provider: googleUser.provider,
                              providerId: googleUser.providerId
                         }
                    }
               }
          })
     })

     const accessToken = generateAccessToken(user.id);
     const refreshToken = generateRefreshToken(user.id);
     const {jti} = jwt.decode(refreshToken);
     await redis.set(`refresh:${user.id}:${deviceId}`, jti, 'EX', config.REFRESH_TOKEN_EXP_SEC);
     const {password: _password, ...safeUser} = user;
     await redis.set(`user:${user.id}`, JSON.stringify(safeUser), 'EX', config.REDIS_USER_TTL);
     return {accessToken, refreshToken, loggedInUser: safeUser};
     
}
module.exports = {sendOTP, verifyOTP, login, rotateRefreshToken, verifyGoogleIdToken}