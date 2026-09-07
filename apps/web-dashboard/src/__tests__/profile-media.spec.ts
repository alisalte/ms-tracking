import { beforeEach, describe, expect, it } from 'vitest';

import {
  clearProfileAvatar,
  generatedPortrait,
  isCustomProfileImage,
  readProfileAvatar,
  readProfileCover,
  writeProfileAvatar,
  writeProfileCover,
} from '@/lib/profile-media';

describe('profile-media', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('round-trips a custom avatar per user', () => {
    writeProfileAvatar('u1', 'data:image/jpeg;base64,abc');
    writeProfileAvatar('u2', 'data:image/jpeg;base64,xyz');
    expect(readProfileAvatar('u1')).toBe('data:image/jpeg;base64,abc');
    expect(readProfileAvatar('u2')).toBe('data:image/jpeg;base64,xyz');
    clearProfileAvatar('u1');
    expect(readProfileAvatar('u1')).toBeNull();
    expect(readProfileAvatar('u2')).toBe('data:image/jpeg;base64,xyz');
  });

  it('stores a cover independently of the avatar', () => {
    writeProfileCover('u1', 'data:image/jpeg;base64,cover');
    expect(readProfileCover('u1')).toBe('data:image/jpeg;base64,cover');
    expect(readProfileAvatar('u1')).toBeNull();
  });

  it('builds a deterministic illustrated portrait', () => {
    const a = generatedPortrait('user-a');
    const b = generatedPortrait('user-a');
    const c = generatedPortrait('user-b');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a.startsWith('data:image/svg+xml')).toBe(true);
    expect(isCustomProfileImage(a)).toBe(false);
    expect(isCustomProfileImage('data:image/jpeg;base64,xx')).toBe(true);
  });
});
