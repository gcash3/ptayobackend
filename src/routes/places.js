const express = require('express');
const router = express.Router();
const { Client } = require('@googlemaps/google-maps-services-js');

const client = new Client({});

router.post('/details', async (req, res, next) => {
  try {
    const { placeId, language = 'en' } = req.body || {};
    if (!placeId) {
      return res.status(400).json({ success: false, message: 'placeId is required' });
    }
    const params = {
      place_id: placeId,
      key: process.env.GOOGLE_MAPS_API_KEY,
      language,
      fields: ['geometry', 'name'].join(','),
    };
    console.log('🔎 [Places] Details params:', params);
    const response = await client.placeDetails({ params, timeout: 5000 });
    const result = response.data?.result || {};
    const geometry = result?.geometry?.location || {};
    console.log('✅ [Places] Details status:', response.data?.status, 'lat:', geometry?.lat, 'lng:', geometry?.lng);
    return res.json({
      success: true,
      data: {
        name: result?.name,
        location: { lat: geometry?.lat, lng: geometry?.lng },
      },
      message: 'OK',
    });
  } catch (err) {
    console.error('❌ [Places] Details error:', err?.response?.data || err.message);
    return next(err);
  }
});

router.post('/autocomplete', async (req, res, next) => {
  try {
    const {
      query,
      sessionToken,
      location = { lat: 14.5995, lng: 120.9842 },
      radius = 30000,
      components = 'country:ph',
      language = 'en',
    } = req.body || {};

    if (!query || typeof query !== 'string') {
      return res.status(400).json({ success: false, message: 'query is required' });
    }

    const params = {
      input: query,
      key: process.env.GOOGLE_MAPS_API_KEY,
      language,
      components,
      types: 'establishment',
      location: `${location.lat},${location.lng}`,
      radius,
      strictbounds: true,
      sessiontoken: sessionToken,
    };

    console.log('🔎 [Places] Autocomplete params:', params);
    const response = await client.placeAutocomplete({ params, timeout: 5000 });
    console.log('✅ [Places] Autocomplete status:', response.data?.status, 'count:', response.data?.predictions?.length);
    const predictions = (response.data.predictions || []).map((p) => ({
      description: p.description,
      placeId: p.place_id,
      mainText: p.structured_formatting?.main_text,
      secondaryText: p.structured_formatting?.secondary_text,
    }));

    return res.json({ success: true, data: { predictions }, message: 'OK' });
  } catch (err) {
    console.error('❌ [Places] Autocomplete error:', err?.response?.data || err.message);
    return next(err);
  }
});

router.post('/textsearch', async (req, res, next) => {
  try {
    const {
      query,
      location = { lat: 14.5995, lng: 120.9842 },
      radius = 30000,
      language = 'en',
    } = req.body || {};

    if (!query || typeof query !== 'string') {
      return res.status(400).json({ success: false, message: 'query is required' });
    }

    const params = {
      query,
      key: process.env.GOOGLE_MAPS_API_KEY,
      language,
      location: `${location.lat},${location.lng}`,
      radius,
    };

    console.log('🔎 [Places] TextSearch params:', params);
    const response = await client.textSearch({ params, timeout: 5000 });
    console.log('✅ [Places] TextSearch status:', response.data?.status, 'count:', response.data?.results?.length);
    const results = (response.data.results || []).map((r) => ({
      description: r.formatted_address,
      placeId: r.place_id,
      mainText: r.name,
      secondaryText: r.formatted_address,
    }));

    return res.json({ success: true, data: { results }, message: 'OK' });
  } catch (err) {
    console.error('❌ [Places] TextSearch error:', err?.response?.data || err.message);
    return next(err);
  }
});

module.exports = router;


