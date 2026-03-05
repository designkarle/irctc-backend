const express = require('express');
const { createStation, updateStation, deleteStation, getAllStations, getStationById } = require('../controllers/station.controller');

const {getUserContext} = require('../middlewares/getUserContext.middleware');

const router = express.Router();

router.get("/station", getUserContext, getAllStations);
router.get("/station/:stationId", getUserContext, getStationById);
router.post("/station", getUserContext, createStation);

module.exports = router;