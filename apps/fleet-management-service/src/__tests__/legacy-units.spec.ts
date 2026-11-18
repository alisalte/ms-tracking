import { describe, expect, it } from '@jest/globals';
import {
  bareModel,
  primarySim,
  protocolForModel,
  temperatureShift,
} from '../domain/legacy-units.js';

describe('legacy unit helpers', () => {
  it('derives the protocol from legacy device models', () => {
    for (const m of [
      'FMB120',
      'FM1120',
      'FMb120',
      'FMA120',
      'FM1110',
      'Teltonika FM1120',
      '1120',
      '1110',
    ]) {
      expect(protocolForModel(m)).toBe('teltonika');
    }
    expect(protocolForModel('MT90')).toBe('meitrack');
    expect(protocolForModel('T366G')).toBe('meitrack');
    expect(protocolForModel('GT06N')).toBe('gt06');
    expect(protocolForModel('Wialon Retranslator')).toBeNull();
    expect(protocolForModel('')).toBeNull();
  });

  it('drops the manufacturer word from the model', () => {
    expect(bareModel('Teltonika FM1120')).toBe('FM1120');
    expect(bareModel('FMB120')).toBe('FMB120');
  });

  it('takes the first phone number of a legacy Phone cell', () => {
    expect(primarySim('+989018704337, +352848029645765')).toBe('+989018704337');
    expect(primarySim('')).toBeNull();
  });

  it('reads the legacy temperature shift custom field', () => {
    expect(temperatureShift({ 'شیفت دما': '+3' })).toBe(3);
    expect(temperatureShift({ 'شیفت دما': '-7' })).toBe(-7);
    expect(temperatureShift({ 'نوع ماشين': 'ایسوزو' })).toBeNull();
  });
});
