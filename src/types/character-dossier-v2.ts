export type CharacterDossierImageFocus = {
  eyeX: number;
  eyeY: number;
  confidence?: number;
  detector?: 'mlkit' | 'opencv';
};

export type CharacterPublicDossierV2 = {
  /** ISO-like date or an in-world date string. Age remains a separate display field. */
  birthDate: string;
  /** Current residence differs from birthplace / hometown. */
  residence: string;
  /** Body-fat percentage or a setting-appropriate estimate. */
  bodyFat: string;
  /** Chest / waist / hip measurements, kept together as one readable set. */
  measurements: string;
  /** Shoe size including the sizing system when relevant. */
  shoeSize: string;
  /** Remaining body notes: proportions, frame, injuries and health. */
  bodyStats: string;
  /** One field for everyday, work, formal, home, underwear and socks. */
  clothingStyle: string;
  /** Public temperament, habits, routine, interests and speaking impression. */
  personalityAndLife: string;
};

type CharacterPrivateDossierBaseV2 = {
  portraitUri?: string;
  portraitFocus?: CharacterDossierImageFocus;
  /** Arousal signs, sensitive areas and physical response. */
  sexualResponse: string;
  /** Experience, preference, masturbation habits and typical intimate behaviour. */
  intimacyProfile: string;
};

export type CharacterMalePrivateDossierV2 = CharacterPrivateDossierBaseV2 & {
  variant: 'male';
  /** Penis: foreskin, flaccid/erect measurements, shape, colour and distinguishing traits. */
  penis: string;
  /** Testicles, scrotum, pubic hair and grooming. */
  testiclesAndPubicHair: string;
  /** Anus, perineum, appearance, sensitivity and health. */
  anus: string;
  /** Chest, nipples, body hair, scent and other private body traits. */
  intimateBody: string;
};

export type CharacterFemalePrivateDossierV2 = CharacterPrivateDossierBaseV2 & {
  variant: 'female';
  /** Breasts, nipples, body shape, body hair and other private body traits. */
  breastsAndBody: string;
  /** Vulva, labia, clitoris, colour, shape and grooming. */
  vulva: string;
  /** Vagina and related physical characteristics that matter to the character. */
  vagina: string;
  /** Anus, perineum, appearance, sensitivity and health. */
  anus: string;
};

export type CharacterPrivateDossierV2 =
  | CharacterMalePrivateDossierV2
  | CharacterFemalePrivateDossierV2;

export type CharacterDossierV2 = {
  version: 2;
  public: CharacterPublicDossierV2;
  private: CharacterPrivateDossierV2;
};

export type CharacterAiSummaryFixedFacts = {
  name: string;
  gender: string;
  age: string;
  profession: string;
  affiliation: string;
  height: string;
  weight: string;
  bodyFat: string;
  measurements: string;
  shoeSize: string;
};

/** Compact, stable character anchors injected into novel generation. */
export type CharacterAiSummary = {
  version: 1;
  /** Local fingerprint of the canonical fields used to author the semantic anchors. */
  sourceHash: string;
  fixedFacts: CharacterAiSummaryFixedFacts;
  appearanceAnchors: string[];
  clothingAnchors: string[];
  personalityCore: string[];
  behaviorRules: string[];
  speechRules: string[];
  motivation: string;
  relationshipStances: string[];
  hardLimits: string[];
  privateFacts: string[];
};
