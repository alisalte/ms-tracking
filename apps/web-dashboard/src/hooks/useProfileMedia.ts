import { useCallback, useEffect, useState } from 'react';

import {
  clearProfileAvatar,
  clearProfileCover,
  fileToProfileImage,
  generatedPortrait,
  isCustomProfileImage,
  readProfileAvatar,
  readProfileCover,
  subscribeProfileMedia,
  writeProfileAvatar,
  writeProfileCover,
} from '@/lib/profile-media';

export function useProfileMedia(userId: string | undefined) {
  const [rev, setRev] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => subscribeProfileMedia(() => setRev((n) => n + 1)), []);

  const storedAvatar = userId ? readProfileAvatar(userId) : null;
  const storedCover = userId ? readProfileCover(userId) : null;
  void rev;

  const avatarUrl = storedAvatar || (userId ? generatedPortrait(userId) : null);
  const coverUrl = storedCover;
  const hasCustomAvatar = isCustomProfileImage(storedAvatar);
  const hasCustomCover = Boolean(storedCover);

  const save = useCallback(
    async (kind: 'avatar' | 'cover', file: File) => {
      if (!userId) return;
      setBusy(true);
      setError(null);
      try {
        const dataUrl = await fileToProfileImage(file, kind);
        if (kind === 'avatar') writeProfileAvatar(userId, dataUrl);
        else writeProfileCover(userId, dataUrl);
      } catch {
        setError('profile.photoError');
      } finally {
        setBusy(false);
      }
    },
    [userId],
  );

  const setAvatarFile = useCallback((file: File) => save('avatar', file), [save]);
  const setCoverFile = useCallback((file: File) => save('cover', file), [save]);

  const removeAvatar = useCallback(() => {
    if (!userId) return;
    clearProfileAvatar(userId);
  }, [userId]);

  const removeCover = useCallback(() => {
    if (!userId) return;
    clearProfileCover(userId);
  }, [userId]);

  return {
    avatarUrl,
    coverUrl,
    hasCustomAvatar,
    hasCustomCover,
    busy,
    error,
    setAvatarFile,
    setCoverFile,
    removeAvatar,
    removeCover,
  };
}
