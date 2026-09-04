import { describe, expect, it } from '@jest/globals';
import { PhotoAssembler } from '../infrastructure/adapters/meitrack/meitrack.photo-assembler.js';

function chunk(filename: string, totalPackets: number, packetIndex: number, bytes: number[]) {
  return {
    filename,
    totalPackets,
    packetIndex,
    chunkBase64: Buffer.from(bytes).toString('base64'),
  };
}

describe('PhotoAssembler', () => {
  it('stays pending until every packet index has arrived', () => {
    const assembler = new PhotoAssembler();
    const r1 = assembler.feed(chunk('a.jpg', 2, 0, [1, 2]));
    expect(r1.status).toBe('pending');
    const r2 = assembler.feed(chunk('a.jpg', 2, 1, [3, 4]));
    expect(r2.status).toBe('complete');
    if (r2.status !== 'complete') throw new Error('expected complete');
    expect(r2.filename).toBe('a.jpg');
    expect([...r2.data]).toEqual([1, 2, 3, 4]);
  });

  it('reassembles out-of-order chunks by packetIndex', () => {
    const assembler = new PhotoAssembler();
    assembler.feed(chunk('b.jpg', 3, 2, [7, 8]));
    assembler.feed(chunk('b.jpg', 3, 0, [1, 2]));
    const result = assembler.feed(chunk('b.jpg', 3, 1, [4, 5]));
    expect(result.status).toBe('complete');
    if (result.status !== 'complete') throw new Error('expected complete');
    expect([...result.data]).toEqual([1, 2, 4, 5, 7, 8]);
  });

  it('tracks independent downloads by filename concurrently', () => {
    const assembler = new PhotoAssembler();
    assembler.feed(chunk('a.jpg', 1, 0, [9]));
    const b = assembler.feed(chunk('b.jpg', 2, 0, [1]));
    expect(b.status).toBe('pending');
    const bDone = assembler.feed(chunk('b.jpg', 2, 1, [2]));
    expect(bDone.status).toBe('complete');
  });

  it('restarts a filename whose totalPackets changed (device re-triggered the capture)', () => {
    const assembler = new PhotoAssembler();
    assembler.feed(chunk('a.jpg', 2, 0, [1]));
    // Device restarted the capture with a different packet count — old partial
    // state for this filename must not corrupt the new download.
    const restarted = assembler.feed(chunk('a.jpg', 1, 0, [9]));
    expect(restarted.status).toBe('complete');
    if (restarted.status !== 'complete') throw new Error('expected complete');
    expect([...restarted.data]).toEqual([9]);
  });

  it('reset() drops all in-flight downloads', () => {
    const assembler = new PhotoAssembler();
    assembler.feed(chunk('a.jpg', 2, 0, [1]));
    assembler.reset();
    const result = assembler.feed(chunk('a.jpg', 2, 1, [2]));
    expect(result.status).toBe('pending');
  });
});
