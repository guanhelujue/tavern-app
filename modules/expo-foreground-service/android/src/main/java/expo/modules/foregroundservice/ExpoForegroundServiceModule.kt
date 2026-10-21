package expo.modules.foregroundservice

import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Expo module that exposes start/stop/update for the Android foreground service
 * to JavaScript. On iOS this module simply does nothing (platform guard).
 */
class ExpoForegroundServiceModule : Module() {

    private val context: Context
        get() = requireNotNull(appContext.reactContext) {
            "React context is not available"
        }

    override fun definition() = ModuleDefinition {
        Name("ExpoForegroundService")

        Function("startForegroundService") {
            val intent = Intent(context, ForegroundService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        Function("stopForegroundService") {
            val intent = Intent(context, ForegroundService::class.java)
            context.stopService(intent)
        }

        Function("updateNotification") { title: String, text: String ->
            ForegroundService.updateNotificationText(title, text)

            val notification = ForegroundService.createNotification(context)
            val manager =
                context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            manager.notify(ForegroundService.NOTIFICATION_ID, notification)
        }
    }
}
