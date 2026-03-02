const express = require('express');
const { createSchedule } = require('../controllers/schedule.controller');
const { getUserContext } = require('../middlewares/getUserContext.middleware');

const router = express.Router();

router.post("/schedule", getUserContext, createSchedule);

module.exports = router;