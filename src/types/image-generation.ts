/** Where a generated image will be used in the novel UI. */
export type ImageGenerationPurpose = 'cover' | 'background' | 'portrait' | 'scene';

export type ImageGenerationMode = 'text-to-image' | 'image-to-image';

export type ComfyImageOutput = {
  filename: string;
  subfolder: string;
  type: string;
};

export type ImageGenerationProgress = {
  phase: 'starting' | 'uploading' | 'queued' | 'generating' | 'saving';
  promptId?: string;
  message?: string;
};

export type ImageGenerationOptions = {
  referenceImageUri?: string | null;
  referenceImageUris?: string[];
  width?: number;
  height?: number;
  negativePrompt?: string;
  seed?: number;
  denoise?: number;
  steps?: number;
  /** Resume a submitted ComfyUI job instead of submitting a duplicate. */
  resumePromptId?: string;
  onProgress?: (progress: ImageGenerationProgress) => void;
  onSubmitted?: (promptId: string) => void | Promise<void>;
};

export type GeneratedImageSource = {
  /** Remote URL or data URI. */
  uri?: string;
  /** Raw base64 payload without the data URI prefix. */
  base64?: string;
  mimeType?: string;
};
