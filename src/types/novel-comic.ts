export type ComicSourceKind = 'chapter' | 'message';
export type ComicVisualStyle = 'photorealistic';
export type ComicPageKind = 'daily' | 'battle';
export type ComicPageLayout = 'daily-grid' | 'daily-focus' | 'battle-action' | 'battle-impact';
export type ComicAspect = 'portrait' | 'square' | 'landscape' | 'wide' | 'tall';
export type ComicGenerationStatus = 'pending' | 'queued' | 'completed' | 'error';

export type ComicCharacter = {
  id: string;
  name: string;
  appearance: string;
  outfit: string;
  referenceImageUri?: string;
  /** Checkpoint for an automatically generated identity plate. */
  referenceComfyPromptId?: string;
  /** A visual-only character inferred from source text; never written to the novel cast. */
  derived?: boolean;
  sourceText?: string;
};

export type ComicOutput = {
  filename: string;
  subfolder: string;
  type: string;
};

export type ComicPanel = {
  id: string;
  index: number;
  beat: string;
  sourceText: string;
  characterIds: string[];
  location: string;
  time: string;
  camera: string;
  action: string;
  continuity: string;
  prompt: string;
  negativePrompt: string;
  caption: string;
  dialogue: { speaker: string; text: string }[];
  aspect: ComicAspect;
  width: number;
  height: number;
  seed: number;
  imageUri?: string;
  comfyPromptId?: string;
  comfyOutput?: ComicOutput;
  status: ComicGenerationStatus;
  error?: string;
};

export type ComicPage = {
  id: string;
  index: number;
  kind: ComicPageKind;
  layout: ComicPageLayout;
  panels: ComicPanel[];
  imageUri?: string;
  comfyPromptId?: string;
  comfyOutput?: ComicOutput;
  status: ComicGenerationStatus;
  error?: string;
};

export type NovelComicDocument = {
  schemaVersion: 1;
  id: string;
  novelId: string;
  sourceId: string;
  sourceKind: ComicSourceKind;
  sourceTitle: string;
  sourceHash: string;
  visualStyle: ComicVisualStyle;
  modelId: string;
  createdAt: string;
  updatedAt: string;
  llmModelId?: string;
  characters: ComicCharacter[];
  pages: ComicPage[];
  status: 'planned' | 'generating' | 'completed' | 'error';
  error?: string;
};
