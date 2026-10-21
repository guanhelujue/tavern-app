import type {
  CharacterDossierImageFocus,
  CharacterDossierV2,
  CharacterFemalePrivateDossierV2,
  CharacterMalePrivateDossierV2,
  CharacterPrivateDossierV2,
} from '@/types/character-dossier-v2';

type CharacterDossierFallback = {
  gender?: string | null;
  height?: string | null;
  weight?: string | null;
  birthplace?: string | null;
  appearance?: string | null;
  personality?: string | null;
  speechStyle?: string | null;
  privacy?: {
    genitals?: string;
    chest?: string;
    erogenousZones?: string;
    scent?: string;
    xp?: string;
    masturbationHabits?: string;
  } | null;
};

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function storedText(source: Record<string, unknown>, key: string, fallback: string) {
  return Object.prototype.hasOwnProperty.call(source, key) ? text(source[key]) : fallback;
}

function normalizeFocus(value: unknown): CharacterDossierImageFocus | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  if (!Number.isFinite(source.eyeX) || !Number.isFinite(source.eyeY)) return undefined;
  return {
    eyeX: Math.min(1, Math.max(0, Number(source.eyeX))),
    eyeY: Math.min(1, Math.max(0, Number(source.eyeY))),
    ...(Number.isFinite(source.confidence)
      ? { confidence: Math.min(1, Math.max(0, Number(source.confidence))) }
      : {}),
    ...(source.detector === 'mlkit' || source.detector === 'opencv'
      ? { detector: source.detector }
      : {}),
  };
}

export function resolveCharacterDossierVariant(gender?: string | null): 'male' | 'female' {
  return /女|female|woman|girl/i.test(gender?.trim() ?? '') ? 'female' : 'male';
}

function createPrivateDossier(
  variant: 'male' | 'female',
  fallback?: CharacterDossierFallback,
): CharacterPrivateDossierV2 {
  const privacy = fallback?.privacy;
  const sexualResponse = [privacy?.erogenousZones, privacy?.scent].map(text).filter(Boolean).join('\n');
  const intimacyProfile = [privacy?.xp, privacy?.masturbationHabits].map(text).filter(Boolean).join('\n');
  const common = {
    sexualResponse,
    intimacyProfile,
  };
  if (variant === 'female') {
    return {
      variant,
      breastsAndBody: text(privacy?.chest),
      vulva: text(privacy?.genitals),
      vagina: '',
      anus: '',
      ...common,
    };
  }
  return {
    variant,
    penis: text(privacy?.genitals),
    testiclesAndPubicHair: '',
    anus: '',
    intimateBody: text(privacy?.chest),
    ...common,
  };
}

export function createCharacterDossierV2(
  fallback?: CharacterDossierFallback,
): CharacterDossierV2 {
  const variant = resolveCharacterDossierVariant(fallback?.gender);
  return {
    version: 2,
    public: {
      birthDate: '',
      residence: '',
      bodyFat: '',
      measurements: '',
      shoeSize: '',
      bodyStats: '',
      clothingStyle: '',
      personalityAndLife: [text(fallback?.personality), text(fallback?.speechStyle)]
        .filter(Boolean)
        .join('\n'),
    },
    private: createPrivateDossier(variant, fallback),
  };
}

function normalizePrivate(
  value: unknown,
  variant: 'male' | 'female',
  fallback?: CharacterDossierFallback,
): CharacterPrivateDossierV2 {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const base = createPrivateDossier(variant, fallback);
  const image = {
    ...(text(source.portraitUri) ? { portraitUri: text(source.portraitUri) } : {}),
    ...(normalizeFocus(source.portraitFocus)
      ? { portraitFocus: normalizeFocus(source.portraitFocus) }
      : {}),
  };
  const common = {
    sexualResponse: storedText(source, 'sexualResponse', base.sexualResponse),
    intimacyProfile: storedText(source, 'intimacyProfile', base.intimacyProfile),
    ...image,
  };
  if (variant === 'female') {
    const femaleBase = base as CharacterFemalePrivateDossierV2;
    return {
      variant,
      breastsAndBody: storedText(source, 'breastsAndBody', femaleBase.breastsAndBody),
      vulva: storedText(source, 'vulva', femaleBase.vulva),
      vagina: storedText(source, 'vagina', femaleBase.vagina),
      anus: storedText(source, 'anus', femaleBase.anus),
      ...common,
    };
  }
  const maleBase = base as CharacterMalePrivateDossierV2;
  return {
    variant,
    penis: storedText(source, 'penis', maleBase.penis),
    testiclesAndPubicHair: storedText(
      source,
      'testiclesAndPubicHair',
      maleBase.testiclesAndPubicHair,
    ),
    anus: storedText(source, 'anus', maleBase.anus),
    intimateBody: storedText(source, 'intimateBody', maleBase.intimateBody),
    ...common,
  };
}

export function normalizeCharacterDossierV2(
  value: unknown,
  fallback?: CharacterDossierFallback,
): CharacterDossierV2 {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const publicSource = source.public && typeof source.public === 'object' && !Array.isArray(source.public)
    ? source.public as Record<string, unknown>
    : {};
  const base = createCharacterDossierV2(fallback);
  const storedPrivate = source.private && typeof source.private === 'object' && !Array.isArray(source.private)
    ? source.private as Record<string, unknown>
    : {};
  const variant = storedPrivate.variant === 'female' || storedPrivate.variant === 'male'
    ? storedPrivate.variant
    : resolveCharacterDossierVariant(fallback?.gender);
  return {
    version: 2,
    public: {
      birthDate: storedText(publicSource, 'birthDate', base.public.birthDate),
      residence: storedText(publicSource, 'residence', base.public.residence),
      bodyFat: storedText(publicSource, 'bodyFat', base.public.bodyFat),
      measurements: storedText(publicSource, 'measurements', base.public.measurements),
      shoeSize: storedText(publicSource, 'shoeSize', base.public.shoeSize),
      bodyStats: storedText(publicSource, 'bodyStats', base.public.bodyStats),
      clothingStyle: storedText(publicSource, 'clothingStyle', base.public.clothingStyle),
      personalityAndLife: storedText(
        publicSource,
        'personalityAndLife',
        base.public.personalityAndLife,
      ),
    },
    private: normalizePrivate(storedPrivate, variant, fallback),
  };
}

/** Fill empty dossier fields from AI output without overwriting authored values. */
export function mergeCharacterDossierV2(
  currentValue: unknown,
  generatedValue: unknown,
  fallback?: CharacterDossierFallback,
  options?: { includePrivate?: boolean },
): CharacterDossierV2 {
  const hasCurrent = Boolean(
    currentValue && typeof currentValue === 'object' && !Array.isArray(currentValue),
  );
  const current = normalizeCharacterDossierV2(
    currentValue,
    hasCurrent ? fallback : { gender: fallback?.gender },
  );
  const generated = normalizeCharacterDossierV2(generatedValue, fallback);
  const fill = (currentText: string, generatedText: string) =>
    currentText.trim() || generatedText.trim();
  const variant = resolveCharacterDossierVariant(fallback?.gender);
  const currentPrivate = normalizePrivate(current.private, variant, fallback);
  const generatedPrivate = normalizePrivate(generated.private, variant, fallback);
  const privateBase = options?.includePrivate === false ? currentPrivate : generatedPrivate;
  const common = {
    portraitUri: currentPrivate.portraitUri,
    portraitFocus: currentPrivate.portraitFocus,
    sexualResponse: fill(currentPrivate.sexualResponse, privateBase.sexualResponse),
    intimacyProfile: fill(currentPrivate.intimacyProfile, privateBase.intimacyProfile),
  };

  return {
    version: 2,
    public: {
      birthDate: fill(current.public.birthDate, generated.public.birthDate),
      residence: fill(current.public.residence, generated.public.residence),
      bodyFat: fill(current.public.bodyFat, generated.public.bodyFat),
      measurements: fill(current.public.measurements, generated.public.measurements),
      shoeSize: fill(current.public.shoeSize, generated.public.shoeSize),
      bodyStats: fill(current.public.bodyStats, generated.public.bodyStats),
      clothingStyle: fill(current.public.clothingStyle, generated.public.clothingStyle),
      personalityAndLife: fill(
        current.public.personalityAndLife,
        generated.public.personalityAndLife,
      ),
    },
    private: variant === 'female'
      ? {
          variant,
          breastsAndBody: fill(
            (currentPrivate as CharacterFemalePrivateDossierV2).breastsAndBody,
            (privateBase as CharacterFemalePrivateDossierV2).breastsAndBody,
          ),
          vulva: fill(
            (currentPrivate as CharacterFemalePrivateDossierV2).vulva,
            (privateBase as CharacterFemalePrivateDossierV2).vulva,
          ),
          vagina: fill(
            (currentPrivate as CharacterFemalePrivateDossierV2).vagina,
            (privateBase as CharacterFemalePrivateDossierV2).vagina,
          ),
          anus: fill(currentPrivate.anus, privateBase.anus),
          ...common,
        }
      : {
          variant,
          penis: fill(
            (currentPrivate as CharacterMalePrivateDossierV2).penis,
            (privateBase as CharacterMalePrivateDossierV2).penis,
          ),
          testiclesAndPubicHair: fill(
            (currentPrivate as CharacterMalePrivateDossierV2).testiclesAndPubicHair,
            (privateBase as CharacterMalePrivateDossierV2).testiclesAndPubicHair,
          ),
          anus: fill(currentPrivate.anus, privateBase.anus),
          intimateBody: fill(
            (currentPrivate as CharacterMalePrivateDossierV2).intimateBody,
            (privateBase as CharacterMalePrivateDossierV2).intimateBody,
          ),
          ...common,
        },
  };
}

export function switchCharacterDossierVariant(
  dossier: CharacterDossierV2,
  variant: 'male' | 'female',
): CharacterDossierV2 {
  if (dossier.private.variant === variant) return dossier;
  const common = {
    portraitUri: dossier.private.portraitUri,
    portraitFocus: dossier.private.portraitFocus,
    sexualResponse: dossier.private.sexualResponse,
    intimacyProfile: dossier.private.intimacyProfile,
  };
  return {
    ...dossier,
    private:
      variant === 'female'
        ? {
            variant,
            breastsAndBody: '',
            vulva: '',
            vagina: '',
            anus: dossier.private.anus,
            ...common,
          }
        : {
            variant,
            penis: '',
            testiclesAndPubicHair: '',
            anus: dossier.private.anus,
            intimateBody: '',
            ...common,
          },
  };
}
