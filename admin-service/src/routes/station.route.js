const express = require('express');
const { createStation, updateStation, deleteStation, getAllStations, getStationById, getStationByIdInternal } = require('../controllers/station.controller');

const {getUserContext} = require('../middlewares/getUserContext.middleware');
const { internalAuth } = require('../middlewares/internalAuth.middleware');

const router = express.Router();

router.get("/station/internal/:stationId", internalAuth, getStationByIdInternal);

router.get("/station", getUserContext, getAllStations);
router.get("/station/:stationId", getUserContext, getStationById);
router.post("/station", getUserContext, createStation);

module.exports = router;