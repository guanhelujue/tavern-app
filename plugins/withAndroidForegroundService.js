const { withAndroidManifest } = require('expo/config-plugins');

/**
 * Inject FOREGROUND_SERVICE permission and register the ForegroundService
 * component in AndroidManifest.xml so the expo-foreground-service module
 * can keep the app alive during LLM streaming.
 */
function withAndroidForegroundService(config) {
  return withAndroidManifest(config, (config) => {
    const app = config.modResults;

    // Ensure <manifest> has the correct namespace attributes (AGP 8+).
    app.manifest.$ = app.manifest.$ || {};
    if (!app.manifest.$['xmlns:android']) {
      app.manifest.$['xmlns:android'] =
        'http://schemas.android.com/apk/res/android';
    }

    // --- 1. Add FOREGROUND_SERVICE permission ---
    app.manifest['uses-permission'] = app.manifest['uses-permission'] || [];
    const permissions = app.manifest['uses-permission'];
    const permNames = new Set(
      permissions.map((p) => p.$?.['android:name']).filter(Boolean),
    );

    if (!permNames.has('android.permission.FOREGROUND_SERVICE')) {
      permissions.push({
        $: { 'android:name': 'android.permission.FOREGROUND_SERVICE' },
      });
    }

    if (!permNames.has('android.permission.FOREGROUND_SERVICE_DATA_SYNC')) {
      permissions.push({
        $: {
          'android:name': 'android.permission.FOREGROUND_SERVICE_DATA_SYNC',
        },
      });
    }

    if (!permNames.has('android.permission.POST_NOTIFICATIONS')) {
      permissions.push({
        $: {
          'android:name': 'android.permission.POST_NOTIFICATIONS',
        },
      });
    }

    // --- 2. Register ForegroundService in <application> ---
    const application = app.manifest.application?.[0];
    if (application) {
      application.service = application.service || [];
      const existingServices = new Set(
        application.service.map(
          (s) => s.$?.['android:name'],
        ).filter(Boolean),
      );

      const serviceName =
        'expo.modules.foregroundservice.ForegroundService';

      if (!existingServices.has(serviceName)) {
        application.service.push({
          $: {
            'android:name': serviceName,
            'android:foregroundServiceType': 'dataSync',
            'android:exported': 'false',
          },
        });
      }
    }

    return config;
  });
}

module.exports = withAndroidForegroundService;
