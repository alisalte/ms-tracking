/** Drone orthophoto API (map-engine): one published layer per organisation. */
import { apiClient, apiGetRaw } from './client';

export interface Orthophoto {
  readonly id: string;
  readonly status: 'processing' | 'ready' | 'failed';
  readonly originalName: string;
  readonly error: string | null;
  readonly createdAt: string;
  readonly readyAt: string | null;
  readonly sizeBytes: number | null;
  readonly bounds: [number, number, number, number] | null;
  readonly minZoom: number | null;
  readonly maxZoom: number | null;
  readonly tileUrl: string | null;
}

export const ORTHOPHOTO_CHANGE_EVENT = 'fv:orthophoto-change';

export async function fetchOrthophotos(): Promise<Orthophoto[]> {
  const { items } = await apiGetRaw<{ items: Orthophoto[] }>('/map/orthophoto');
  return items;
}

export async function uploadOrthophoto(file: File, onProgress: (ratio: number) => void) {
  const body = new FormData();
  body.append('file', file);
  await apiClient.post('/map/orthophoto', body, {
    timeout: 0,
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: (e) => {
      if (e.total) onProgress(e.loaded / e.total);
    },
  });
}

export async function deleteOrthophoto(): Promise<void> {
  await apiClient.delete('/map/orthophoto');
  window.dispatchEvent(new Event(ORTHOPHOTO_CHANGE_EVENT));
}
