const express = require('express');
const { requireAuth } = require('../middlewares/auth.middleware');
const { getProfile } = require('../controllers/user.controller');

const router = express.Router();

router.get("/get-profile", requireAuth, getProfile);

module.exports = router;