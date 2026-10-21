export type PortraitFocus = {
  eyeX: number;
  eyeY: number;
  confidence?: number;
  detector?: 'mlkit' | 'opencv';
};

export type PortraitImageSize = {
  width: number;
  height: number;
};

export type PortraitContainerSize = {
  width: number;
  height: number;
};

// Full-body portrait generators usually place the eyes around the upper fifth
// of the source. This is only a fallback; a native ML Kit or Web OpenCV
// detection wins when available. Keeping this near the eyes also prevents
// legacy cards (which do not have saved focus metadata) from showing the torso
// while detection runs.
const FALLBACK_EYE_POSITION = 0.2;

function finiteUnit(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : null;
}

export function normalizePortraitFocus(value: unknown): PortraitFocus | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const raw = value as Partial<PortraitFocus>;
  const eyeX = finiteUnit(raw.eyeX);
  const eyeY = finiteUnit(raw.eyeY);
  if (eyeX === null || eyeY === null) {
    return undefined;
  }
  const confidence = finiteUnit(raw.confidence);
  return {
    eyeX,
    eyeY,
    ...(confidence === null ? {} : { confidence }),
    ...(raw.detector === 'mlkit' || raw.detector === 'opencv'
      ? { detector: raw.detector }
      : {}),
  };
}

function clampPercent(value: number) {
  return Math.min(100, Math.max(0, value));
}

/**
 * Convert the normalized eye anchor into expo-image's object-position. The
 * calculation accounts for `contentFit="cover"`, so a full-body portrait and
 * a close-up can use the same card without a per-character offset.
 */
export function getPortraitContentPosition(
  focus: PortraitFocus | undefined,
  image: PortraitImageSize | undefined,
  container: PortraitContainerSize | undefined,
) {
  if (
    !focus ||
    !image ||
    !container ||
    image.width <= 0 ||
    image.height <= 0 ||
    container.width <= 0 ||
    container.height <= 0
  ) {
    return { top: `${FALLBACK_EYE_POSITION * 100}%`, left: '50%' };
  }

  const scale = Math.max(container.width / image.width, container.height / image.height);
  const renderedWidth = image.width * scale;
  const renderedHeight = image.height * scale;
  const overflowX = Math.max(0, renderedWidth - container.width);
  const overflowY = Math.max(0, renderedHeight - container.height);
  const targetX = container.width * 0.5;
  const targetY = container.height * 0.5;
  const renderedEyeX = focus.eyeX * renderedWidth;
  const renderedEyeY = focus.eyeY * renderedHeight;
  const positionX = overflowX > 0 ? (renderedEyeX - targetX) / overflowX : 0.5;
  const positionY = overflowY > 0 ? (renderedEyeY - targetY) / overflowY : 0.5;

  return {
    top: `${clampPercent(positionY * 100)}%`,
    left: `${clampPercent(positionX * 100)}%`,
  };
}

export const DEFAULT_PORTRAIT_FOCUS_FALLBACK = {
  top: `${FALLBACK_EYE_POSITION * 100}%`,
  left: '50%',
};
