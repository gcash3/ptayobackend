const express = require('express');
const router = express.Router();
const SystemSettings = require('../models/SystemSettings');
const logger = require('../config/logger');

/**
 * PUBLIC VERSION CHECK ENDPOINT
 * GET /api/v1/public/app-version
 * 
 * Headers Required:
 * - X-App-Version: Current app version (e.g., "1.0.0")
 * - X-App-Platform: Platform (android/ios)
 * - X-App-Type: App type (host/client)
 * 
 * Response Headers:
 * - X-Latest-Version: Latest available version
 * - X-Minimum-Version: Minimum required version
 * - X-Update-Available: true/false
 * - X-Update-Required: true/false (mandatory update)
 * - X-Force-Update: true/false
 */
router.get('/app-version', async (req, res) => {
  const startTime = Date.now();
  const timestamp = new Date().toISOString();

  logger.info('\n🚀 ===== PUBLIC VERSION CHECK =====');
  logger.info(`⏰ Request Time: ${timestamp}`);
  logger.info(`🌍 IP: ${req.ip || req.connection.remoteAddress}`);
  logger.info(`👤 User-Agent: ${req.get('User-Agent')}`);

  try {
    // Extract version info from headers
    const currentVersion = req.get('X-App-Version');
    const platform = req.get('X-App-Platform') || 'android';
    const appType = req.get('X-App-Type') || 'host';

    logger.info('📊 Request Headers Analysis:');
    logger.info(`   📱 Current Version: ${currentVersion}`);
    logger.info(`   📱 Platform: ${platform}`);
    logger.info(`   👤 App Type: ${appType}`);

    // CHECK MAINTENANCE MODE FIRST (before version validation)
    logger.info('🔧 Checking maintenance mode...');
    const maintenanceSettings = await SystemSettings.findOne({ settingsType: 'Maintenance' });

    if (maintenanceSettings && maintenanceSettings.settings) {
      const maintenance = maintenanceSettings.settings;

      logger.info('🔧 Maintenance settings found:');
      logger.info(`   🛠️ Enabled: ${maintenance.enabled}`);
      logger.info(`   📱 Affects Client: ${maintenance.affectsClient}`);
      logger.info(`   🏠 Affects Host: ${maintenance.affectsHost}`);

      // Check if maintenance mode is enabled for this app type
      const isInMaintenance = maintenance.enabled &&
        ((appType === 'client' && maintenance.affectsClient) ||
         (appType === 'host' && maintenance.affectsHost));

      if (isInMaintenance) {
        logger.info(`🛠️ MAINTENANCE MODE ACTIVE for ${appType} app`);
        logger.info(`   💬 Message: ${maintenance.message}`);
        logger.info(`   ⏰ Expected End: ${maintenance.expectedEndTime}`);

        return res.status(503).json({
          status: 'maintenance',
          message: 'System is currently under maintenance',
          data: {
            maintenance: {
              enabled: true,
              message: maintenance.message || 'We are currently performing scheduled maintenance. Please check back soon.',
              expectedEndTime: maintenance.expectedEndTime || null,
              title: maintenance.title || 'Maintenance Mode'
            }
          },
          timestamp: new Date().toISOString(),
          processingTime: `${Date.now() - startTime}ms`
        });
      } else {
        logger.info(`✅ No maintenance mode for ${appType} app`);
      }
    } else {
      logger.info('✅ No maintenance settings found - proceeding normally');
    }

    // Validate required headers
    if (!currentVersion) {
      logger.warn('❌ Missing X-App-Version header');
      return res.status(400).json({
        status: 'error',
        message: 'X-App-Version header is required',
        example: 'X-App-Version: 1.0.0',
        timestamp: new Date().toISOString()
      });
    }
    
    // Validate version format
    if (!isValidVersionFormat(currentVersion)) {
      logger.warn(`❌ Invalid version format: ${currentVersion}`);
      return res.status(400).json({
        status: 'error',
        message: 'Invalid version format. Use semantic versioning (e.g., 1.0.0)',
        provided: currentVersion,
        timestamp: new Date().toISOString()
      });
    }
    
    logger.info('🔍 Fetching system settings...');
    
    // Get system settings from database
    const systemSettings = await SystemSettings.findOne({ settingsType: 'AppVersion' });
    
    if (!systemSettings || !systemSettings.settings || !systemSettings.settings[appType]) {
      logger.error(`❌ No settings found for app type: ${appType}`);
      return res.status(404).json({
        status: 'error',
        message: `Version settings not found for app type: ${appType}`,
        availableTypes: systemSettings ? Object.keys(systemSettings.settings || {}) : [],
        timestamp: new Date().toISOString()
      });
    }
    
    const versionData = systemSettings.settings[appType];
    
    logger.info('📊 Version Data Retrieved:');
    logger.info(`   📈 Latest: ${versionData.latestVersion}`);
    logger.info(`   📉 Minimum: ${versionData.minimumVersion}`);
    logger.info(`   🔒 Force Update: ${versionData.forceUpdate}`);
    
    // Perform version comparison
    const comparison = compareVersions(currentVersion, versionData);
    
    logger.info('⚖️ Version Comparison Results:');
    logger.info(`   📈 Update Available: ${comparison.updateAvailable}`);
    logger.info(`   🚨 Update Required: ${comparison.updateRequired}`);
    logger.info(`   ⚠️ Below Minimum: ${comparison.belowMinimum}`);
    logger.info(`   🔒 Force Update: ${comparison.forceUpdate}`);
    
    // Set response headers with version info
    res.set({
      'X-Latest-Version': versionData.latestVersion,
      'X-Minimum-Version': versionData.minimumVersion,
      'X-Update-Available': comparison.updateAvailable.toString(),
      'X-Update-Required': comparison.updateRequired.toString(),
      'X-Force-Update': versionData.forceUpdate.toString(),
      'X-Below-Minimum': comparison.belowMinimum.toString(),
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    });
    
    // Prepare response body
    const responseBody = {
      status: 'success',
      message: 'Version check completed',
      data: {
        current: {
          version: currentVersion,
          platform: platform,
          appType: appType
        },
        latest: {
          version: versionData.latestVersion,
          minimumVersion: versionData.minimumVersion,
          forceUpdate: versionData.forceUpdate,
          updateMessage: versionData.updateMessage,
          releaseNotes: versionData.releaseNotes || [],
          downloadUrls: {
            android: versionData.androidUrl,
            ios: versionData.iosUrl
          }
        },
        comparison: {
          updateAvailable: comparison.updateAvailable,
          updateRequired: comparison.updateRequired,
          belowMinimum: comparison.belowMinimum,
          needsUpdate: comparison.updateAvailable || comparison.belowMinimum
        }
      },
      timestamp: new Date().toISOString(),
      processingTime: `${Date.now() - startTime}ms`
    };
    
    logger.info('✅ Sending successful response');
    logger.info(`⏱️ Processing time: ${Date.now() - startTime}ms`);
    logger.info('📤 Response headers set:');
    logger.info(`   X-Latest-Version: ${versionData.latestVersion}`);
    logger.info(`   X-Update-Available: ${comparison.updateAvailable}`);
    logger.info(`   X-Update-Required: ${comparison.updateRequired}`);
    
    res.status(200).json(responseBody);
    
  } catch (error) {
    logger.error('❌ Error in version check:', error);
    logger.error('📍 Stack trace:', error.stack);
    
    res.status(500).json({
      status: 'error',
      message: 'Internal server error during version check',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Server error',
      timestamp: new Date().toISOString(),
      processingTime: `${Date.now() - startTime}ms`
    });
  } finally {
    logger.info(`🏁 Version check completed in ${Date.now() - startTime}ms`);
    logger.info('===== END VERSION CHECK =====\n');
  }
});

// Helper Functions
function isValidVersionFormat(version) {
  // Validate semantic versioning format (x.y.z)
  const versionRegex = /^\d+\.\d+\.\d+$/;
  const isValid = versionRegex.test(version);
  logger.info(`🔧 Version format validation: ${version} -> ${isValid}`);
  return isValid;
}

function compareVersions(currentVersion, versionData) {
  logger.info('🔄 Starting version comparison...');
  
  const current = parseVersion(currentVersion);
  const latest = parseVersion(versionData.latestVersion);
  const minimum = parseVersion(versionData.minimumVersion);
  
  logger.info('🔢 Parsed versions:');
  logger.info(`   📱 Current: [${current.join('.')}]`);
  logger.info(`   📈 Latest: [${latest.join('.')}]`);
  logger.info(`   📉 Minimum: [${minimum.join('.')}]`);
  
  const belowMinimum = isVersionLower(current, minimum);
  const updateAvailable = isVersionLower(current, latest);
  const updateRequired = belowMinimum || versionData.forceUpdate;
  
  logger.info('⚖️ Comparison logic:');
  logger.info(`   Below minimum (${minimum.join('.')}): ${belowMinimum}`);
  logger.info(`   Update available (${latest.join('.')}): ${updateAvailable}`);
  logger.info(`   Force update flag: ${versionData.forceUpdate}`);
  logger.info(`   Update required: ${updateRequired}`);
  
  return {
    updateAvailable,
    updateRequired,
    belowMinimum,
    forceUpdate: versionData.forceUpdate
  };
}

function parseVersion(version) {
  const parts = version.split('.').map(part => parseInt(part) || 0);
  logger.info(`🔧 Parsed ${version} -> [${parts.join(', ')}]`);
  return parts;
}

function isVersionLower(version1, version2) {
  logger.info(`🔧 Comparing [${version1.join('.')}] < [${version2.join('.')}]`);
  
  for (let i = 0; i < Math.max(version1.length, version2.length); i++) {
    const v1 = version1[i] || 0;
    const v2 = version2[i] || 0;
    
    if (v1 < v2) {
      logger.info(`🔧 ${v1} < ${v2} -> true`);
      return true;
    }
    if (v1 > v2) {
      logger.info(`🔧 ${v1} > ${v2} -> false`);
      return false;
    }
  }
  
  logger.info('🔧 Versions equal -> false');
  return false;
}

module.exports = router;
