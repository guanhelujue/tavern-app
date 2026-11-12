import { describe, expectTypeOf, it } from 'vitest';

import type { SceneInspirationChatMessage } from './domain';

describe('SceneInspirationChatMessage', () => {
  it('keeps only the fields needed to render local chat bubbles', () => {
    expectTypeOf<SceneInspirationChatMessage>().toMatchTypeOf<{
      id: string;
      role: 'user' | 'assistant';
      content: string;
    }>();
  });
});
