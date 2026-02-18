const asyncHandler = require("../utils/asyncHandler");
const { BadRequestError } = require("../utils/error");
const userService = require('../services/user.service');
const logger = require("../config/logger");


exports.getProfile = asyncHandler(async(req, res) =>{
     const userId = req.user.id;
     if(!userId){
          throw new BadRequestError("User Id is missing");
     }

     const user = await userService.getProfile(userId);
     return res.status(200).json({
          success: true,
          message: "Fetched user details",
          data: {
               user
          }
     })
})

exports.updateProfile = asyncHandler(async(req, res) =>{
     // TODO TASK FOR YOU
})

exports.deleteProfile = asyncHandler(async(req, res) =>{
     // TODO TASK FOR YOU
})