const express = require('express');
const {getUserContext} = require('../middlewares/getUserContext.middleware');
const { getProfile, updateProfile, deleteProfile } = require('../controllers/user.controller');

const router = express.Router();

router.get("/profile", getUserContext, getProfile);
router.put("/profile", getUserContext, updateProfile);
router.delete("/profile", getUserContext, deleteProfile);

module.exports = router;