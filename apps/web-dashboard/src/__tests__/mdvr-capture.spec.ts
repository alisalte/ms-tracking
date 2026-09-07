import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DeviceCommandRecord } from '@/types/command.types';

const apiPost = vi.fn();
const fetchDeviceCommand = vi.fn();

vi.mock('@/api/client', () => ({
  apiPost: (...args: unknown[]) => apiPost(...args),
  apiGet: vi.fn(),
}));
vi.mock('@/api/command.api', () => ({
  fetchDeviceCommand: (...args: unknown[]) => fetchDeviceCommand(...args),
}));

const { captureMdvrPhoto, mdvrCaptureFilename } = await import(
  '@/components/video/useMdvrResources'
);

const DEVICE = 'device-1';
const never = () => false;

/** A one-pixel-ish JPEG head, base64'd the way the D00 ack carries it. */
const PHOTO_B64 = btoa(String.fromCharCode(0xff, 0xd8, 0xff, 0xe0));

function record(over: Partial<DeviceCommandRecord>): DeviceCommandRecord {
  return { id: 'cmd', status: 'ACKED', ...over } as DeviceCommandRecord;
}

/** Drive the capture past its internal settle/poll timers. */
async function runCapture(camera = 2) {
  const promise = captureMdvrPhoto(DEVICE, camera, never);
  await vi.advanceTimersByTimeAsync(10_000);
  return promise;
}

describe('captureMdvrPhoto (D03 → D00)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    apiPost.mockReset();
    fetchDeviceCommand.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('triggers D03 on the chosen camera, then downloads that file with D00', async () => {
    apiPost.mockImplementation((_url: string, body: { commandCode: string }) =>
      Promise.resolve(record({ id: `cmd-${body.commandCode}` })),
    );
    fetchDeviceCommand.mockImplementation((id: string) =>
      Promise.resolve(
        record({
          id,
          status: 'ACKED',
          responseText:
            id === 'cmd-D00'
              ? JSON.stringify({ filename: 'snap.jpg', photoBase64: PHOTO_B64, byteLength: 4 })
              : 'D03,OK',
        }),
      ),
    );

    const result = await runCapture(2);

    const codes = apiPost.mock.calls.map((c) => (c[1] as { commandCode: string }).commandCode);
    expect(codes).toEqual(['D03', 'D00']);

    // D03 carries the camera and the name we chose…
    const d03 = apiPost.mock.calls[0]?.[1] as { params: { camera: number; imagename: string } };
    expect(d03.params.camera).toBe(2);
    expect(d03.params.imagename).toMatch(/^snap\d{6}_ch2\.jpg$/);
    // …and D00 asks for exactly that name — no D01 round-trip needed.
    const d00 = apiPost.mock.calls[1]?.[1] as { params: { filename: string } };
    expect(d00.params.filename).toBe(d03.params.imagename);

    expect(result.blob.size).toBe(4);
    expect(result.blob.type).toBe('image/jpeg');
  });

  it('falls back to the D01 listing when D00 cannot find the name', async () => {
    // The unit reports the file back in a different case; the fallback has to
    // match it case-insensitively and still download it.
    let chosen = '';
    let d00Calls = 0;
    apiPost.mockImplementation(
      (_url: string, body: { commandCode: string; params?: { imagename?: string } }) => {
        if (body.commandCode === 'D03') chosen = body.params?.imagename ?? '';
        if (body.commandCode === 'D00') d00Calls += 1;
        const suffix = body.commandCode === 'D00' ? d00Calls : 1;
        return Promise.resolve(record({ id: `cmd-${body.commandCode}-${suffix}` }));
      },
    );
    fetchDeviceCommand.mockImplementation((id: string) => {
      if (id === 'cmd-D00-1') return Promise.resolve(record({ id, status: 'FAILED' }));
      if (id === 'cmd-D01-1') {
        return Promise.resolve(
          record({ id, responseText: JSON.stringify({ photoNames: [chosen.toUpperCase()] }) }),
        );
      }
      if (id === 'cmd-D00-2') {
        return Promise.resolve(
          record({
            id,
            responseText: JSON.stringify({
              filename: chosen.toUpperCase(),
              photoBase64: PHOTO_B64,
              byteLength: 4,
            }),
          }),
        );
      }
      return Promise.resolve(record({ id, responseText: 'D03,OK' }));
    });

    const result = await runCapture(1);

    const calls = apiPost.mock.calls.map(
      (c) => c[1] as { commandCode: string; params?: { filename?: string } },
    );
    expect(calls.map((c) => c.commandCode).slice(0, 3)).toEqual(['D03', 'D00', 'D01']);
    // The retry asks for the name the listing reported, not the one we chose.
    const retry = calls.filter((c) => c.commandCode === 'D00').at(-1);
    expect(retry?.params?.filename).toBe(chosen.toUpperCase());
    expect(result.blob.size).toBe(4);
  });

  it('names the capture per camera so two cameras never collide', () => {
    const at = new Date(2026, 8, 6, 21, 4, 5);
    expect(mdvrCaptureFilename(1, at)).toBe('snap210405_ch1.jpg');
    expect(mdvrCaptureFilename(2, at)).toBe('snap210405_ch2.jpg');
  });
});
