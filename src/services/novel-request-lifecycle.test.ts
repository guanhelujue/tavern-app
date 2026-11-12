import { describe, expect, it } from 'vitest';

import {
  beginNovelMutation,
  beginNovelRequest,
} from './novel-request-lifecycle';

describe('novel request lifecycle leases', () => {
  it('mutations block requests and double mutation release restores availability', () => {
    const release = beginNovelMutation('lease-test');
    expect(release).toBeTypeOf('function');
    expect(beginNovelRequest('lease-test')).toBeNull();
    expect(beginNovelMutation('lease-test')).toBeNull();
    release?.();
    expect(beginNovelMutation('lease-test')).toBeTypeOf('function');
  });

  it('request leases block mutations until release and release is idempotent', () => {
    const lease = beginNovelRequest('request-test');
    expect(lease).not.toBeNull();
    expect(beginNovelMutation('request-test')).toBeNull();
    lease?.release();
    lease?.release();
    const mutation = beginNovelMutation('request-test');
    expect(mutation).toBeTypeOf('function');
    mutation?.();
  });

  it('does not let an old mutation release a newer lease for the same novel', () => {
    const releaseFirst = beginNovelMutation('lease-generation-test');
    releaseFirst?.();
    const releaseSecond = beginNovelMutation('lease-generation-test');
    releaseFirst?.();
    expect(beginNovelMutation('lease-generation-test')).toBeNull();
    releaseSecond?.();
  });
});
