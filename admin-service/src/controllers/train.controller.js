const asyncHandler = require("../utils/asyncHandler");
const { BadRequestError } = require("../utils/error");
const trainService = require('../services/train.service');


exports.createTrain = asyncHandler(async(req, res) =>{
     const {trainNumber, trainName, coachName, seats} = req.body;

     if(!trainNumber || !trainName || !coachName || !seats){
          throw new BadRequestError("trainNumber, trainName, and seats are required");
     }

     if(seats.length === 0){
          throw new BadRequestError("Atleast one seat must be defined...")
     }

     const train = await trainService.createTrain({trainNumber, trainName, coachName, seats});
     return res.status(201).json({
          success: true,
          message: "Train added successfully",
          data: train
     })
})

exports.createRoute = asyncHandler(async(req, res) =>{
     const {trainId, stations} = req.body;
     if(!trainId || !stations){
          throw new BadRequestError("Train Id and stations are required");
     }

     if(stations.length < 2){
          throw new BadRequestError("A route must have at least 2 stations (origin and destination)");
     }

     const route = await trainService.createRoute({trainId, stations});
     return res.status(201).json({
          success: true,
          message: "Route Created",
          data: route
     });
});

exports.getAllTrains = asyncHandler(async(req, res) =>{
     const trains = await trainService.getAllTrains();
     return res.status(200).json({
          success: true,
          data: trains
     })
})

exports.getTrainById = asyncHandler(async(req, res) =>{
     const {trainId} = req.params;
     if(!trainId){
          throw new BadRequestError("Train Id is missing");
     }
     const train = await trainService.getTrainById(trainId);
     return res.status(200).json({
          success: true,
          data: train
     })
})