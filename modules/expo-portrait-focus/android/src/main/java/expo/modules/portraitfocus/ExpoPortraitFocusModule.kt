package expo.modules.portraitfocus

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.util.Base64
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.face.Face
import com.google.mlkit.vision.face.FaceDetection
import com.google.mlkit.vision.face.FaceDetectorOptions
import com.google.mlkit.vision.face.FaceLandmark
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.FileInputStream
import java.io.InputStream
import kotlin.math.max

/** Finds the most useful eye anchor without modifying the source image. */
class ExpoPortraitFocusModule : Module() {

    private val context: Context
        get() = requireNotNull(appContext.reactContext) {
            "React context is not available"
        }

    override fun definition() = ModuleDefinition {
        Name("ExpoPortraitFocus")

        AsyncFunction("detect") Coroutine { uri: String ->
            detectPortraitFocus(uri)
        }
    }

    private fun decodeBitmap(value: String): Bitmap? {
        val raw = value.trim()
        if (raw.isEmpty()) return null

        if (raw.startsWith("data:", ignoreCase = true)) {
            val comma = raw.indexOf(',')
            if (comma < 0) return null
            return try {
                val bytes = Base64.decode(raw.substring(comma + 1), Base64.DEFAULT)
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
            } catch (_: IllegalArgumentException) {
                null
            }
        }

        val parsed = Uri.parse(raw)
        val stream: InputStream? = try {
            when (parsed.scheme?.lowercase()) {
                "content" -> context.contentResolver.openInputStream(parsed)
                "file" -> parsed.path?.let(::FileInputStream)
                null -> FileInputStream(raw)
                else -> null
            }
        } catch (_: Exception) {
            null
        }
        return stream?.use { BitmapFactory.decodeStream(it) }
    }

    private fun selectFace(faces: List<Face>): Face? {
        if (faces.isEmpty()) return null
        return faces.maxByOrNull { face ->
            val bounds = face.boundingBox
            val area = bounds.width().toLong() * bounds.height().toLong()
            val hasEyes = face.getLandmark(FaceLandmark.LEFT_EYE) != null &&
                face.getLandmark(FaceLandmark.RIGHT_EYE) != null
            area * if (hasEyes) 2 else 1
        }
    }

    private fun detectPortraitFocus(uri: String): Map<String, Any?>? {
        val bitmap = decodeBitmap(uri) ?: return null
        val options = FaceDetectorOptions.Builder()
            .setPerformanceMode(FaceDetectorOptions.PERFORMANCE_MODE_ACCURATE)
            .setLandmarkMode(FaceDetectorOptions.LANDMARK_MODE_ALL)
            .setClassificationMode(FaceDetectorOptions.CLASSIFICATION_MODE_NONE)
            .setMinFaceSize(0.04f)
            .build()
        val detector = FaceDetection.getClient(options)

        return try {
            val faces = Tasks.await(detector.process(InputImage.fromBitmap(bitmap, 0)))
            val face = selectFace(faces) ?: return null
            val left = face.getLandmark(FaceLandmark.LEFT_EYE)?.position
            val right = face.getLandmark(FaceLandmark.RIGHT_EYE)?.position
            val bounds = face.boundingBox
            val eyeX: Float
            val eyeY: Float
            val confidence: Double

            if (left != null && right != null) {
                eyeX = (left.x + right.x) / 2f
                eyeY = (left.y + right.y) / 2f
                confidence = 1.0
            } else {
                // A face anchor still works for a profile, hair, glasses, or a
                // low-resolution source where one/both eye landmarks are absent.
                eyeX = bounds.centerX().toFloat()
                eyeY = bounds.top + bounds.height() * 0.38f
                confidence = 0.55
            }

            val width = max(bitmap.width, 1)
            val height = max(bitmap.height, 1)
            mapOf(
                "eyeX" to (eyeX / width).coerceIn(0f, 1f).toDouble(),
                "eyeY" to (eyeY / height).coerceIn(0f, 1f).toDouble(),
                "confidence" to confidence,
                "detector" to "mlkit",
            )
        } finally {
            detector.close()
            if (!bitmap.isRecycled) bitmap.recycle()
        }
    }
}
