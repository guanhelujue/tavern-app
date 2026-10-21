/** Where a generated image will be used in the novel UI. */
export type ImageGenerationPurpose = 'cover' | 'background' | 'portrait' | 'scene';

export type GeneratedImageSource = {
  /** Remote URL or data URI. */
  uri?: string;
  /** Raw base64 payload without the data URI prefix. */
  base64?: string;
  mimeType?: string;
};
