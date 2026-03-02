const asyncHandler = require("../utils/asyncHandler");
const {BadRequestError} = require('../utils/error');
const scheduleService = require('../services/schedule.service');

exports.createSchedule = asyncHandler(async(req, res) =>{
     const {trainId, departureDate} = req.body;

     if(!trainId || !departureDate){
          throw new BadRequestError('trainId and departureDate are required');
     }

     const schedule = await scheduleService.createSchedule({trainId, departureDate});
     return res.status(201).json({
          success: true,
          message: "Train Schedule created successfully",
          data: schedule
     })
})

exports.getAllSchedules = asyncHandler(async(req, res) =>{

})

exports.getScheduleById = asyncHandler(async(req, res) =>{
     
})