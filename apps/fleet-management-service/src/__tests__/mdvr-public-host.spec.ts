import { describe, expect, it } from '@jest/globals';
import { isPrivateOrLoopbackHost } from '../infrastructure/mdvr-public-host.js';

describe('isPrivateOrLoopbackHost', () => {
  it('treats empty, localhost, and RFC1918 as private', () => {
    expect(isPrivateOrLoopbackHost('')).toBe(true);
    expect(isPrivateOrLoopbackHost('localhost')).toBe(true);
    expect(isPrivateOrLoopbackHost('127.0.0.1')).toBe(true);
    expect(isPrivateOrLoopbackHost('192.168.2.100')).toBe(true);
    expect(isPrivateOrLoopbackHost('10.0.0.1')).toBe(true);
    expect(isPrivateOrLoopbackHost('172.18.0.1')).toBe(true);
  });

  it('keeps a public IPv4', () => {
    expect(isPrivateOrLoopbackHost('91.107.173.122')).toBe(false);
    expect(isPrivateOrLoopbackHost('178.131.31.231')).toBe(false);
  });
});
