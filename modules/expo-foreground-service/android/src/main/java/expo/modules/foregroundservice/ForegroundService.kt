package expo.modules.foregroundservice

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

/**
 * Android foreground service that keeps the app process alive during
 * long-running LLM streaming. Shows a persistent notification so the
 * user knows generation is in progress.
 */
class ForegroundService : Service() {

    companion object {
        const val CHANNEL_ID = "tavern_streaming"
        const val NOTIFICATION_ID = 1001
        const val ACTION_STOP = "expo.modules.foregroundservice.STOP"

        private var currentTitle: String = "AI 正在生成回复"
        private var currentText: String = "酒馆正在等待模型输出，请稍候..."

        fun updateNotificationText(title: String, text: String) {
            currentTitle = title
            currentText = text
        }

        fun createNotification(context: Context): Notification {
            createNotificationChannel(context)

            val stopIntent = Intent(context, ForegroundService::class.java).apply {
                action = ACTION_STOP
            }
            val stopPendingIntent = PendingIntent.getService(
                context,
                0,
                stopIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )

            return NotificationCompat.Builder(context, CHANNEL_ID)
                .setContentTitle(currentTitle)
                .setContentText(currentText)
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setOngoing(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setShowWhen(false)
                .addAction(
                    android.R.drawable.ic_media_pause,
                    "停止生成",
                    stopPendingIntent,
                )
                .build()
        }

        private fun createNotificationChannel(context: Context) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val channel = NotificationChannel(
                    CHANNEL_ID,
                    "AI 生成状态",
                    NotificationManager.IMPORTANCE_LOW,
                ).apply {
                    description = "显示 AI 文本生成的进度状态"
                    setShowBadge(false)
                }
                val manager =
                    context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                manager.createNotificationChannel(channel)
            }
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            return START_NOT_STICKY
        }

        val notification = createNotification(this)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC,
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }

        return START_NOT_STICKY
    }

    override fun onDestroy() {
        super.onDestroy()
        stopForeground(STOP_FOREGROUND_REMOVE)
    }
}
