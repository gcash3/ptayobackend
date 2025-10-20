const axios = require('axios');
const env = require('../config/environment');
const logger = require('../config/logger');

class WeatherService {
  constructor() {
    this.apiKey = env.WEATHER_API_KEY;
    this.baseUrl = env.WEATHER_API_BASE_URL;
  }

  /**
   * Get current weather conditions for a location
   * @param {number} latitude 
   * @param {number} longitude 
   * @returns {Promise<Object>} Weather data
   */
  async getCurrentWeather(latitude, longitude) {
    try {
      const response = await axios.get(`${this.baseUrl}/current.json`, {
        params: {
          key: this.apiKey,
          q: `${latitude},${longitude}`,
          aqi: 'no'
        }
      });

      const weather = response.data;
      
      return {
        success: true,
        data: {
          condition: weather.current.condition.text.toLowerCase(),
          temperature: weather.current.temp_c,
          humidity: weather.current.humidity,
          windSpeed: weather.current.wind_kph,
          visibility: weather.current.vis_km,
          precipitation: weather.current.precip_mm,
          isRaining: weather.current.condition.text.toLowerCase().includes('rain'),
          isStormy: weather.current.condition.text.toLowerCase().includes('storm') || 
                   weather.current.condition.text.toLowerCase().includes('thunder'),
          isFoggy: weather.current.vis_km < 5,
          severity: this.calculateWeatherSeverity(weather.current)
        }
      };

    } catch (error) {
      logger.error('Weather API error:', error.response?.data || error.message);
      return {
        success: false,
        error: 'Failed to fetch weather data',
        data: this.getDefaultWeather()
      };
    }
  }

  /**
   * Get weather forecast for route planning
   * @param {number} latitude 
   * @param {number} longitude 
   * @param {number} hours - Hours ahead to forecast (1-24)
   * @returns {Promise<Object>} Forecast data
   */
  async getWeatherForecast(latitude, longitude, hours = 2) {
    try {
      const days = Math.ceil(hours / 24) || 1;
      
      const response = await axios.get(`${this.baseUrl}/forecast.json`, {
        params: {
          key: this.apiKey,
          q: `${latitude},${longitude}`,
          days: days,
          aqi: 'no',
          alerts: 'yes'
        }
      });

      const forecast = response.data;
      const forecastHours = [];

      // Get hourly forecast for the specified hours
      for (let day of forecast.forecast.forecastday) {
        for (let hour of day.hour) {
          const hourTime = new Date(hour.time);
          const now = new Date();
          const hoursFromNow = (hourTime - now) / (1000 * 60 * 60);
          
          if (hoursFromNow >= 0 && hoursFromNow <= hours) {
            forecastHours.push({
              time: hour.time,
              condition: hour.condition.text.toLowerCase(),
              temperature: hour.temp_c,
              chanceOfRain: hour.chance_of_rain,
              precipitation: hour.precip_mm,
              windSpeed: hour.wind_kph,
              visibility: hour.vis_km,
              severity: this.calculateHourlyWeatherSeverity(hour)
            });
          }
        }
      }

      return {
        success: true,
        data: {
          current: await this.getCurrentWeather(latitude, longitude),
          forecast: forecastHours,
          alerts: forecast.alerts?.alert || [],
          maxSeverity: Math.max(...forecastHours.map(h => h.severity))
        }
      };

    } catch (error) {
      logger.error('Weather forecast error:', error.response?.data || error.message);
      return {
        success: false,
        error: 'Failed to fetch weather forecast',
        data: { current: this.getDefaultWeather(), forecast: [], alerts: [], maxSeverity: 0 }
      };
    }
  }

  /**
   * Calculate weather impact on travel time (in minutes)
   * @param {Object} weatherData 
   * @param {number} baseTravel TimeMinutes 
   * @returns {number} Additional minutes due to weather
   */
  calculateWeatherImpact(weatherData, baseTravelTimeMinutes) {
    if (!weatherData.success) return 0;

    const weather = weatherData.data;
    let impactMinutes = 0;

    // Rain impact
    if (weather.isRaining) {
      if (weather.precipitation > 10) {
        impactMinutes += baseTravelTimeMinutes * 0.4; // Heavy rain: +40% travel time
      } else if (weather.precipitation > 2) {
        impactMinutes += baseTravelTimeMinutes * 0.2; // Moderate rain: +20% travel time
      } else {
        impactMinutes += baseTravelTimeMinutes * 0.1; // Light rain: +10% travel time
      }
    }

    // Storm impact
    if (weather.isStormy) {
      impactMinutes += baseTravelTimeMinutes * 0.5; // Storm: +50% travel time
    }

    // Fog/visibility impact
    if (weather.isFoggy) {
      if (weather.visibility < 1) {
        impactMinutes += baseTravelTimeMinutes * 0.6; // Very low visibility: +60%
      } else if (weather.visibility < 3) {
        impactMinutes += baseTravelTimeMinutes * 0.3; // Low visibility: +30%
      } else {
        impactMinutes += baseTravelTimeMinutes * 0.15; // Reduced visibility: +15%
      }
    }

    // Wind impact (for motorcycles especially)
    if (weather.windSpeed > 40) {
      impactMinutes += baseTravelTimeMinutes * 0.2; // High wind: +20%
    } else if (weather.windSpeed > 25) {
      impactMinutes += baseTravelTimeMinutes * 0.1; // Moderate wind: +10%
    }

    // Cap the weather impact at 100% of base travel time
    return Math.min(impactMinutes, baseTravelTimeMinutes);
  }

  /**
   * Calculate weather severity score (0-10)
   * @param {Object} currentWeather 
   * @returns {number} Severity score
   */
  calculateWeatherSeverity(currentWeather) {
    let severity = 0;

    // Precipitation severity
    if (currentWeather.precip_mm > 10) severity += 4;
    else if (currentWeather.precip_mm > 2) severity += 2;
    else if (currentWeather.precip_mm > 0) severity += 1;

    // Wind severity
    if (currentWeather.wind_kph > 40) severity += 3;
    else if (currentWeather.wind_kph > 25) severity += 2;
    else if (currentWeather.wind_kph > 15) severity += 1;

    // Visibility severity
    if (currentWeather.vis_km < 1) severity += 3;
    else if (currentWeather.vis_km < 3) severity += 2;
    else if (currentWeather.vis_km < 5) severity += 1;

    // Condition-based severity
    const condition = currentWeather.condition.text.toLowerCase();
    if (condition.includes('thunder') || condition.includes('storm')) severity += 3;
    if (condition.includes('heavy')) severity += 2;
    if (condition.includes('snow') || condition.includes('ice')) severity += 3;

    return Math.min(severity, 10);
  }

  /**
   * Calculate hourly weather severity for forecasting
   * @param {Object} hourData 
   * @returns {number} Severity score
   */
  calculateHourlyWeatherSeverity(hourData) {
    let severity = 0;

    // Rain chance and precipitation
    if (hourData.chance_of_rain > 80) severity += 2;
    else if (hourData.chance_of_rain > 50) severity += 1;

    if (hourData.precip_mm > 5) severity += 2;
    else if (hourData.precip_mm > 1) severity += 1;

    // Wind and visibility
    if (hourData.wind_kph > 30) severity += 2;
    else if (hourData.wind_kph > 20) severity += 1;

    if (hourData.vis_km < 3) severity += 2;
    else if (hourData.vis_km < 5) severity += 1;

    return Math.min(severity, 8);
  }

  /**
   * Get default weather data for fallback
   * @returns {Object} Default weather
   */
  getDefaultWeather() {
    return {
      condition: 'clear',
      temperature: 28,
      humidity: 65,
      windSpeed: 10,
      visibility: 10,
      precipitation: 0,
      isRaining: false,
      isStormy: false,
      isFoggy: false,
      severity: 0
    };
  }

  /**
   * Get weather impact summary for UI display
   * @param {Object} weatherData 
   * @returns {Object} Weather summary
   */
  getWeatherSummary(weatherData) {
    if (!weatherData.success) {
      return {
        impact: 'none',
        message: 'Weather data unavailable',
        icon: '🌤️',
        impactMinutes: 0
      };
    }

    const weather = weatherData.data;
    
    if (weather.isStormy) {
      return {
        impact: 'severe',
        message: 'Severe weather detected - expect significant delays',
        icon: '⛈️',
        impactMinutes: 30
      };
    }

    if (weather.isRaining && weather.precipitation > 5) {
      return {
        impact: 'high',
        message: 'Heavy rain - allow extra travel time',
        icon: '🌧️',
        impactMinutes: 15
      };
    }

    if (weather.isRaining || weather.isFoggy) {
      return {
        impact: 'moderate',
        message: 'Weather conditions may affect travel time',
        icon: weather.isRaining ? '🌦️' : '🌫️',
        impactMinutes: 10
      };
    }

    if (weather.windSpeed > 25) {
      return {
        impact: 'low',
        message: 'Windy conditions - drive carefully',
        icon: '💨',
        impactMinutes: 5
      };
    }

    return {
      impact: 'none',
      message: 'Good weather conditions',
      icon: '☀️',
      impactMinutes: 0
    };
  }

  /**
   * Check if weather conditions are suitable for smart booking
   * @param {Object} weatherData 
   * @returns {boolean} Whether conditions are suitable
   */
  isWeatherSuitableForSmartBooking(weatherData) {
    if (!weatherData.success) return true; // Default to allowing if no weather data

    const weather = weatherData.data;
    
    // Don't allow smart booking in severe weather conditions
    if (weather.isStormy) return false;
    if (weather.precipitation > 15) return false; // Very heavy rain
    if (weather.visibility < 1) return false; // Very low visibility
    if (weather.windSpeed > 50) return false; // Very high winds
    
    return true;
  }
}

module.exports = new WeatherService();