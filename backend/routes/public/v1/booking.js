'use strict';

const express = require('express');
const { apiKeyAuth, rateLimitByClient } = require('../../../middleware/publicApi');
const { resolveBookingDuration } = require('../../../services/bookingDurationService');

const router = express.Router();
const SCOPE = 'booking:duration:read';

router.get('/duration', apiKeyAuth(SCOPE), rateLimitByClient(), async (req, res) => {
  try {
    const result = await resolveBookingDuration(req.query);
    res.json({
      ok: true,
      doctor_id: result.doctorId,
      clinic_id: result.clinicId,
      service_id: result.serviceId,
      duration: result.duration,
      default_duration: result.defaultDuration,
      source: result.source,
      updated_at: result.updatedAt
    });
  } catch (error) {
    const status = error.status || 500;
    const code = error.code || 'internal_error';
    res.locals.errorCode = code;
    if (status >= 500) console.error('[public booking duration]', error.message);
    res.status(status).json({
      ok: false,
      error: code,
      message: status >= 500 ? 'Не удалось получить длительность услуги' : error.message
    });
  }
});

module.exports = router;
