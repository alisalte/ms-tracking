/**
 * Local profile photo + cover until identity exposes PATCH /me for avatars.
 *
 * Images are stored as compressed JPEG data URLs, keyed by user id so a shared
 * browser does not mix portraits. The header UserMenu listens on the same keys.
 */

export const PROFILE_MEDIA_EVENT = 'fv-profile-media';

const AVATAR_PREFIX = 'fv.profile.avatar.';
const COVER_PREFIX = 'fv.profile.cover.';

const AVATAR_MAX_PX = 512;
const COVER_MAX_W = 1600;
const COVER_MAX_H = 640;
const JPEG_QUALITY = 0.84;

function avatarKey(userId: string): string {
  return `${AVATAR_PREFIX}${userId}`;
}

function coverKey(userId: string): string {
  return `${COVER_PREFIX}${userId}`;
}

function notify(): void {
  window.dispatchEvent(new Event(PROFILE_MEDIA_EVENT));
}

export function readProfileAvatar(userId: string): string | null {
  if (!userId) return null;
  try {
    return localStorage.getItem(avatarKey(userId));
  } catch {
    return null;
  }
}

export function readProfileCover(userId: string): string | null {
  if (!userId) return null;
  try {
    return localStorage.getItem(coverKey(userId));
  } catch {
    return null;
  }
}

export function writeProfileAvatar(userId: string, dataUrl: string): void {
  localStorage.setItem(avatarKey(userId), dataUrl);
  notify();
}

export function writeProfileCover(userId: string, dataUrl: string): void {
  localStorage.setItem(coverKey(userId), dataUrl);
  notify();
}

export function clearProfileAvatar(userId: string): void {
  localStorage.removeItem(avatarKey(userId));
  notify();
}

export function clearProfileCover(userId: string): void {
  localStorage.removeItem(coverKey(userId));
  notify();
}

export function subscribeProfileMedia(onChange: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key?.startsWith(AVATAR_PREFIX) || event.key?.startsWith(COVER_PREFIX)) onChange();
  };
  window.addEventListener('storage', onStorage);
  window.addEventListener(PROFILE_MEDIA_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(PROFILE_MEDIA_EVENT, onChange);
  };
}

/** Deterministic illustrated portrait so the avatar is never a bare letter. */
export function generatedPortrait(seed: string): string {
  const hue = hashHue(seed);
  const hue2 = (hue + 42) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="hsl(${hue},72%,52%)"/>
        <stop offset="1" stop-color="hsl(${hue2},64%,28%)"/>
      </linearGradient>
    </defs>
    <rect width="128" height="128" fill="url(#g)"/>
    <circle cx="98" cy="18" r="36" fill="white" fill-opacity="0.12"/>
    <circle cx="64" cy="50" r="22" fill="white" fill-opacity="0.92"/>
    <ellipse cx="64" cy="118" rx="44" ry="40" fill="white" fill-opacity="0.92"/>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function hashHue(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h % 360;
}

export function isCustomProfileImage(src: string | null | undefined): boolean {
  return Boolean(src?.startsWith('data:image/') && !src.startsWith('data:image/svg+xml'));
}

export async function fileToProfileImage(file: File, kind: 'avatar' | 'cover'): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('not-image');
  }
  const dataUrl = await readFileAsDataUrl(file);
  const maxW = kind === 'avatar' ? AVATAR_MAX_PX : COVER_MAX_W;
  const maxH = kind === 'avatar' ? AVATAR_MAX_PX : COVER_MAX_H;
  try {
    return await downscaleDataUrl(dataUrl, maxW, maxH, JPEG_QUALITY);
  } catch {
    return dataUrl;
  }
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('read-failed'));
    reader.readAsDataURL(file);
  });
}

function downscaleDataUrl(
  dataUrl: string,
  maxW: number,
  maxH: number,
  quality: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxW / img.width, maxH / img.height);
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('no-canvas'));
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => reject(new Error('decode-failed'));
    img.src = dataUrl;
  });
}
