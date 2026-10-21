import { resolvePortraitDisplayUri } from '@/utils/character-card-portraits';
import {
  normalizePortraitFocus,
  type PortraitFocus,
} from '@/utils/portrait-focus.shared';

export * from '@/utils/portrait-focus.shared';

type CvMat = {
  cols: number;
  rows: number;
  data32F: Float32Array;
  delete: () => void;
};

type CvFaceDetector = {
  setInputSize: (size: unknown) => unknown;
  detect: (image: CvMat, faces: CvMat) => unknown;
  delete?: () => void;
};

type CvRuntime = {
  Mat: new () => CvMat;
  Size: new (width?: number, height?: number) => unknown;
  FaceDetectorYN: new (
    model: string,
    config: string,
    inputSize: unknown,
    scoreThreshold?: number,
    nmsThreshold?: number,
    topK?: number,
  ) => CvFaceDetector;
  imread: (source: HTMLCanvasElement) => CvMat;
  cvtColor: (source: CvMat, target: CvMat, code: number, channels?: number) => void;
  COLOR_RGBA2BGR: number;
  FS_createDataFile: (
    parent: string,
    name: string,
    data: Uint8Array,
    canRead: boolean,
    canWrite: boolean,
  ) => unknown;
};

type WebCvContext = {
  cv: CvRuntime;
  detector: CvFaceDetector;
};

const WEB_FACE_MODEL = {
  name: 'face_detection_yunet_2023mar.onnx',
  // Keep mirrors because some browsers/networks cannot reach the GitHub media
  // host even though the app itself is reachable.
  urls: [
    'https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx',
    'https://huggingface.co/pollen-robotics/face_detection_yunet_2023mar/resolve/main/face_detection_yunet_2023mar.onnx',
    'https://kde-applicationdata.mirrors.omnilance.com/digikam/facesengine/yunet/face_detection_yunet_2023mar.onnx',
    'https://raw.githubusercontent.com/opencv/opencv_zoo/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx',
    'https://cdn.jsdelivr.net/gh/opencv/opencv_zoo@main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx',
  ],
} as const;

let webCvPromise: Promise<WebCvContext | null> | undefined;

function isOpenCvGraphBackendWarning(args: unknown[]): boolean {
  const message = args
    .filter((value): value is string => typeof value === 'string')
    .join(' ');
  return (
    message.includes('net_impl_backend.cpp:345') &&
    message.includes('setPreferableTarget') &&
    message.includes('Targets are not supported by the new graph engine')
  );
}

async function loadWebCv(): Promise<WebCvContext | null> {
  if (webCvPromise) {
    return webCvPromise;
  }

  webCvPromise = (async () => {
    // OpenCV.js writes a harmless backend-selection warning while its DNN
    // bindings are initialized. Emscripten captures `console.error` when the
    // module is evaluated, so install a narrowly-scoped filter during that
    // import. This keeps Expo's error overlay from treating the known warning
    // as an application error without hiding any later errors.
    const previousConsoleError = console.error;
    const filteredConsoleError = (...args: unknown[]) => {
      if (!isOpenCvGraphBackendWarning(args)) {
        previousConsoleError(...args);
      }
    };
    console.error = filteredConsoleError;
    let imported: { default?: unknown };
    try {
      imported = (await import('@techstark/opencv-js')) as unknown as {
        default?: unknown;
      };
    } finally {
      if (console.error === filteredConsoleError) {
        console.error = previousConsoleError;
      }
    }
    let runtimeValue = imported.default ?? imported;
    if (
      runtimeValue &&
      typeof (runtimeValue as Promise<unknown>).then === 'function'
    ) {
      runtimeValue = await runtimeValue;
    }

    const cv = runtimeValue as CvRuntime & {
      onRuntimeInitialized?: () => void;
    };
    if (!cv.Mat && typeof cv.onRuntimeInitialized === 'function') {
      await new Promise<void>((resolve) => {
        const previous = cv.onRuntimeInitialized;
        cv.onRuntimeInitialized = () => {
          previous?.();
          resolve();
        };
      });
    }
    if (
      !cv.Mat ||
      !cv.FaceDetectorYN ||
      !cv.imread ||
      typeof cv.cvtColor !== 'function' ||
      typeof cv.COLOR_RGBA2BGR !== 'number' ||
      !cv.FS_createDataFile
    ) {
      return null;
    }

    let modelBytes: Uint8Array | undefined;
    for (const url of WEB_FACE_MODEL.urls) {
      const controller = typeof AbortController === 'function' ? new AbortController() : undefined;
      const timeout = controller ? setTimeout(() => controller.abort(), 10_000) : undefined;
      try {
        const candidate = await fetch(url, {
          cache: 'force-cache',
          signal: controller?.signal,
        });
        if (!candidate.ok) {
          continue;
        }

        const bytes = new Uint8Array(await candidate.arrayBuffer());
        // GitHub's raw endpoint can return a tiny Git LFS pointer with HTTP
        // 200 instead of the ONNX binary. YuNet is over 100 KiB, so reject
        // that pointer and continue with the next mirror.
        if (bytes.byteLength >= 100_000) {
          modelBytes = bytes;
          break;
        }
      } catch {
        // Try the next mirror. A failed mirror should not prevent detection
        // when another host is reachable from the user's browser.
      } finally {
        if (timeout) {
          clearTimeout(timeout);
        }
      }
    }
    if (!modelBytes) {
      throw new Error('OpenCV face model download failed.');
    }
    try {
      cv.FS_createDataFile('/', WEB_FACE_MODEL.name, modelBytes, true, false);
    } catch {
      // The file may already exist when the module is hot-reloaded.
    }

    const detector = new cv.FaceDetectorYN(
      WEB_FACE_MODEL.name,
      '',
      new cv.Size(320, 320),
      0.6,
      0.3,
      5000,
    );
    return { cv, detector };
  })().catch(() => null);

  return webCvPromise;
}

function loadWebImage(uri: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = document.createElement('img');
    image.crossOrigin = 'anonymous';
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('无法读取人像图片。'));
    image.src = uri;
  });
}

async function detectWebPortraitFocus(uri: string): Promise<PortraitFocus | undefined> {
  const context = await loadWebCv();
  if (!context) {
    return undefined;
  }

  const image = await loadWebImage(uri);
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  if (!sourceWidth || !sourceHeight) {
    return undefined;
  }

  const maxDimension = 1280;
  const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const canvasContext = canvas.getContext('2d');
  if (!canvasContext) {
    return undefined;
  }
  canvasContext.drawImage(image, 0, 0, width, height);

  const { cv, detector } = context;
  let source: CvMat | undefined;
  let sourceBgr: CvMat | undefined;
  let faces: CvMat | undefined;
  try {
    source = cv.imread(canvas);
    sourceBgr = new cv.Mat();
    cv.cvtColor(source, sourceBgr, cv.COLOR_RGBA2BGR);
    detector.setInputSize(new cv.Size(width, height));
    faces = new cv.Mat();
    detector.detect(sourceBgr, faces);
    if (!faces.data32F || faces.data32F.length < 15) {
      return undefined;
    }

    const detections = Array.from(
      { length: Math.floor(faces.data32F.length / 15) },
      (_, index) => faces!.data32F.slice(index * 15, index * 15 + 15),
    ).sort((a, b) => b[2] * b[3] - a[2] * a[3]);
    const face = detections[0];
    if (!face || face.length < 15) {
      return undefined;
    }

    // YuNet returns five landmarks after x/y/w/h: right eye, left eye,
    // nose, right mouth corner, left mouth corner. Average the two eye
    // landmarks instead of estimating from the full-body composition.
    const eyeX = (face[4] + face[6]) * 0.5;
    const eyeY = (face[5] + face[7]) * 0.5;

    return normalizePortraitFocus({
      eyeX: eyeX / width,
      eyeY: eyeY / height,
      confidence: Math.min(1, Math.max(0, face[14] ?? 0.65)),
      detector: 'opencv',
    });
  } catch {
    return undefined;
  } finally {
    faces?.delete();
    sourceBgr?.delete();
    source?.delete();
  }
}

/**
 * Web detector used by the browser bundle. Native builds resolve the sibling
 * `portrait-focus.ts` file instead, so OpenCV is not included in their bundle.
 */
export async function detectPortraitFocus(
  portraitUri?: string | null,
  gender?: string | null,
): Promise<PortraitFocus | undefined> {
  const displayUri = resolvePortraitDisplayUri(portraitUri, gender);
  if (!displayUri) {
    return undefined;
  }
  try {
    return await detectWebPortraitFocus(displayUri);
  } catch {
    return undefined;
  }
}
