const axios = require('axios');
const logger = require('../config/logger');

/**
 * Google Weather Service - Uses Google Maps API for weather data
 * Note: Google doesn't have a dedicated weather API, but we can use their geocoding
 * with OpenWeatherMap as a backup, or integrate with other weather services
 */
class GoogleWeatherService {
  constructor() {
    this.apiKey = process.env.GOOGLE_MAPS_API_KEY;
    // OpenWeatherMap for actual weather data
    this.openWeatherApiKey = process.env.OPENWEATHER_API_KEY;
    logger.info(`🌤️ Weather service initialized with OpenWeatherMap: ${this.openWeatherApiKey ? 'ENABLED' : 'DISABLED'}`);
  }

  /**
   * Get current weather using Google's geocoding + OpenWeatherMap
   * Or use simple estimation based on time/location
   */
  async getCurrentWeather(latitude, longitude) {
    try {
      // If we have OpenWeatherMap API key, use it
      if (this.openWeatherApiKey) {
        logger.info(`🌤️ Fetching real weather data for coordinates: ${latitude}, ${longitude}`);
        return await this.getOpenWeatherMapData(latitude, longitude);
      }

      logger.info('🌤️ OpenWeatherMap API key not available, using estimated weather');
      // Otherwise, provide estimated weather based on location and time
      return this.getEstimatedWeather(latitude, longitude);
    } catch (error) {
      logger.error('Weather API error:', error.message);
      logger.info('🌤️ Falling back to default weather data');
      return this.getDefaultWeather();
    }
  }

  /**
   * Get weather from OpenWeatherMap API
   */
  async getOpenWeatherMapData(latitude, longitude) {
    const url = `https://api.openweathermap.org/data/2.5/weather?lat=${latitude}&lon=${longitude}&appid=${this.openWeatherApiKey}&units=metric`;
    
    logger.info(`🌤️ Calling OpenWeatherMap API: ${url.replace(this.openWeatherApiKey, 'API_KEY_HIDDEN')}`);
    
    const response = await axios.get(url, {
      timeout: 10000, // Increased timeout
      headers: {
        'User-Agent': 'ParkTayo-Backend/1.0'
      }
    });

    const data = response.data;
    
    const weatherData = {
      temperature: Math.round(data.main.temp),
      condition: data.weather[0].main.toLowerCase(),
      description: data.weather[0].description,
      humidity: data.main.humidity,
      windSpeed: data.wind?.speed || 0,
      visibility: data.visibility || 10000,
      precipitation: data.rain?.['1h'] || data.snow?.['1h'] || 0,
      source: 'openweathermap',
      location: data.name,
      country: data.sys?.country
    };
    
    logger.info(`🌤️ OpenWeatherMap response: ${weatherData.temperature}°C, ${weatherData.condition} in ${weatherData.location}`);
    return weatherData;
  }

  /**
   * Estimate weather based on location and time
   * This is a fallback when no weather API is available
   */
  getEstimatedWeather(latitude, longitude) {
    const now = new Date();
    const hour = now.getHours();
    const month = now.getMonth() + 1; // 1-12

    // Basic estimation for Philippines climate
    const isPhilippines = latitude >= 4 && latitude <= 21 && longitude >= 116 && longitude <= 127;
    
    let temperature = 28; // Default tropical temperature
    let condition = 'clear';
    let description = 'Clear sky';

    if (isPhilippines) {
      // Philippines weather patterns
      if (month >= 6 && month <= 11) {
        // Rainy season
        temperature = 26;
        condition = 'rain';
        description = 'Rainy season';
      } else if (month >= 12 || month <= 2) {
        // Cool dry season
        temperature = 25;
        condition = 'clear';
        description = 'Cool and dry';
      } else {
        // Hot dry season
        temperature = 32;
        condition = 'clear';
        description = 'Hot and dry';
      }

      // Time of day adjustments
      if (hour >= 6 && hour <= 18) {
        temperature += 2; // Daytime is warmer
      } else {
        temperature -= 3; // Nighttime is cooler
      }
    }

    return {
      temperature,
      condition,
      description,
      humidity: 70,
      windSpeed: 2,
      visibility: 10000,
      precipitation: condition === 'rain' ? 5 : 0,
      source: 'estimated'
    };
  }

  /**
   * Get default weather when all else fails
   */
  getDefaultWeather() {
    return {
      temperature: 28,
      condition: 'clear',
      description: 'Weather data unavailable',
      humidity: 65,
      windSpeed: 1,
      visibility: 10000,
      precipitation: 0,
      source: 'default'
    };
  }

  /**
   * Calculate weather impact on travel time
   */
  calculateWeatherImpact(weatherData) {
    let delayMinutes = 0;
    let description = 'No weather impact';

    if (!weatherData) {
      return { delayMinutes, description };
    }

    const { condition, precipitation, visibility, windSpeed } = weatherData;

    // Rain impact
    if (condition === 'rain' || precipitation > 0) {
      if (precipitation > 10) {
        delayMinutes += 15; // Heavy rain
        description = 'Heavy rain may cause significant delays';
      } else if (precipitation > 2) {
        delayMinutes += 8; // Moderate rain
        description = 'Moderate rain may cause delays';
      } else {
        delayMinutes += 3; // Light rain
        description = 'Light rain may cause minor delays';
      }
    }

    // Storm conditions
    if (condition === 'thunderstorm') {
      delayMinutes += 20;
      description = 'Thunderstorm conditions may cause major delays';
    }

    // Fog/low visibility
    if (visibility < 1000) {
      delayMinutes += 10;
      description = 'Poor visibility may cause delays';
    }

    // Strong wind
    if (windSpeed > 15) {
      delayMinutes += 5;
      description = 'Strong winds may affect travel time';
    }

    // Hot weather (Philippines specific)
    if (weatherData.temperature > 35) {
      delayMinutes += 2;
      description = 'Extreme heat may cause minor delays';
    }

    return {
      delayMinutes: Math.min(delayMinutes, 30), // Cap at 30 minutes
      description,
      severity: delayMinutes > 15 ? 'high' : delayMinutes > 5 ? 'medium' : 'low'
    };
  }

  /**
   * Get weather forecast for the next few hours
   */
  async getWeatherForecast(latitude, longitude, hoursAhead = 2) {
    try {
      const currentWeather = await this.getCurrentWeather(latitude, longitude);
      
      // For now, return the same weather data
      // In a real implementation, you'd call a forecast API
      return {
        current: currentWeather,
        forecast: Array(hoursAhead).fill(currentWeather),
        source: currentWeather.source
      };
    } catch (error) {
      logger.error('Weather forecast error:', error.message);
      return {
        current: this.getDefaultWeather(),
        forecast: [],
        source: 'default'
      };
    }
  }

  /**
   * Check if weather conditions are safe for travel
   */
  isWeatherSafeForTravel(weatherData) {
    if (!weatherData) return { safe: true, reason: 'Weather data unavailable' };

    const { condition, precipitation, visibility, windSpeed } = weatherData;

    // Dangerous conditions
    if (condition === 'thunderstorm') {
      return { safe: false, reason: 'Thunderstorm conditions are dangerous for travel' };
    }

    if (precipitation > 20) {
      return { safe: false, reason: 'Heavy rainfall makes travel dangerous' };
    }

    if (visibility < 500) {
      return { safe: false, reason: 'Very poor visibility makes travel dangerous' };
    }

    if (windSpeed > 25) {
      return { safe: false, reason: 'Very strong winds make travel dangerous' };
    }

    // Caution conditions
    if (precipitation > 10 || visibility < 2000 || windSpeed > 15) {
      return { safe: true, reason: 'Weather conditions require extra caution' };
    }

    return { safe: true, reason: 'Weather conditions are suitable for travel' };
  }
}

module.exports = new GoogleWeatherService();