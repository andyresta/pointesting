export type ImageMediaType =
  | 'image/jpeg'
  | 'image/png'
  | 'image/gif'
  | 'image/webp';

export interface ImageInput {
  type: 'image';
  data: Buffer;
  mediaType: ImageMediaType;
}

export type LLMUserContent = string | ImageInput;

export interface LLMClient {
  complete(
    systemPrompt: string,
    userContent: LLMUserContent[],
  ): Promise<string>;
}
