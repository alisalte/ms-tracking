/**
 * Migration from the previous tracking system: the objects CSV and the Wialon
 * Units sheet are recognised, groups map to fleets, and units are sent in
 * batches to POST /vehicles/legacy-import.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LegacyImportDialog } from '@/components/assets/LegacyImportDialog';
import { i18n } from '@/i18n';
import {
  assignFleets,
  legacyProtocolForModel,
  parseCustomFields,
  parseLegacyGrid,
  toLegacyImportRows,
} from '@/lib/legacy-units';

const apiPost = vi.fn();
vi.mock('@/api/client', () => ({
  apiClient: { interceptors: { request: { use: () => {} }, response: { use: () => {} } } },
  apiPost: (...a: unknown[]) => apiPost(...a),
  apiGet: vi.fn(),
  apiGetRaw: vi.fn(),
  apiPatch: vi.fn(),
  apiDeleteNoContent: vi.fn(),
}));

const OBJECTS_HEADER = [
  'نام',
  'IMEI',
  'پلاک',
  'گروه',
  'مدل',
  'VIN',
  'شماره سیم کارت',
  'فعال',
  'عرض جغرافیایی',
  'طول جغرافیایی',
  'سرعت',
  'ارتفاع',
  'زاویه',
  'مسافت سنج',
  'کارکرد ساعت موتور',
  'آخرین زمان ارسال متحرک',
  'آخرین زمان ارسال سرور',
];
const objectsRow = (name: string, imei: string, group: string, model: string, odo: string) => [
  name,
  imei,
  '',
  group,
  model,
  '',
  '+989018237131',
  '1',
  '35.834658',
  '50.94997',
  '0',
  '1319',
  '86',
  odo,
  '0',
  '2026-08-20 08:48:30',
  '2026-08-20 08:48:32',
];

const WIALON_HEADER = [
  'Name',
  'Creator',
  'Device type',
  'Deactivation',
  'UID',
  'Phone',
  'Last message',
  'Created',
  'Groups',
  'Custom fields',
];

describe('parseLegacyGrid', () => {
  it('reads the objects CSV: one group per unit, odometer, SIM, model', () => {
    const p = parseLegacyGrid([
      OBJECTS_HEADER,
      objectsRow('  T  15-612 izst', '350424065844621', 'پخش تهران', 'FMB120', '19121.60011400009'),
      objectsRow('P 12-457 قنبري', '357454071960254', 'پیمانکار', 'FM1120', '0'),
    ]);
    expect(p.format).toBe('objects');
    expect(p.issues).toEqual([]);
    expect(p.units[0]).toMatchObject({
      row: 2,
      name: 'T 15-612 izst',
      imei: '350424065844621',
      model: 'FMB120',
      simNumber: '+989018237131',
      active: true,
      odometerKm: 19121.6,
      groups: ['پخش تهران'],
    });
    expect(p.units[1]?.odometerKm).toBeUndefined();
    expect(p.groups.map((g) => g.name)).toEqual(['پخش تهران', 'پیمانکار']);
  });

  it('reads a Wialon Units sheet with its groups and custom fields', () => {
    const p = parseLegacyGrid([
      WIALON_HEADER,
      [
        '14-168 iz',
        'damdaran',
        'Teltonika FMA120',
        '',
        '352094080380790',
        '+989018704337, +352848029645765',
        '13 Khordad 1403 05:11:45',
        '28 Khordad 1397 14:35:23',
        'All_units, دامداران, پخش شهرستان',
        'رديف: 22-5, شماره دستگاه: 104, شیفت دما: -7, ضریب دما: 26-&gt;16/1.167632635',
      ],
      ['حراست', 'damdaran', 'Wonde Proud M7', '', '3000002043', '', '', '', 'دامداران', ''],
    ]);
    expect(p.format).toBe('wialon');
    expect(p.units[0]).toMatchObject({
      name: '14-168 iz',
      imei: '352094080380790',
      model: 'Teltonika FMA120',
      groups: ['All_units', 'دامداران', 'پخش شهرستان'],
      legacyFields: {
        رديف: '22-5',
        'شماره دستگاه': '104',
        'شیفت دما': '-7',
        'ضریب دما': '26->16/1.167632635',
      },
    });
    expect(p.issues).toEqual([{ row: 3, code: 'invalidImei' }]);
  });

  it('rejects an unknown layout', () => {
    expect(() =>
      parseLegacyGrid([
        ['a', 'b'],
        ['1', '2'],
      ]),
    ).toThrow('unknownFormat');
  });

  it('flags a repeated IMEI', () => {
    const p = parseLegacyGrid([
      OBJECTS_HEADER,
      objectsRow('A', '350424065844621', 'G', 'FMB120', '1'),
      objectsRow('B', '350424065844621', 'G', 'FMB120', '1'),
    ]);
    expect(p.issues).toEqual([{ row: 3, code: 'duplicateImei' }]);
  });
});

describe('fleet assignment', () => {
  it('puts each unit in the first ticked group it has, else the fallback', () => {
    const units = [
      { row: 2, name: 'A', imei: '1', groups: ['همه ماشینها', 'پخش شهرستان'] },
      { row: 3, name: 'B', imei: '2', groups: ['همه ماشینها'] },
    ];
    const fleets = assignFleets(units, new Set(['پخش شهرستان']), 'سامانه قبلی');
    expect(fleets.get(2)).toBe('پخش شهرستان');
    expect(fleets.get(3)).toBe('سامانه قبلی');
    const rows = toLegacyImportRows(units, fleets, 'سامانه قبلی');
    expect(rows[1]).toMatchObject({ fleet: 'سامانه قبلی', groups: ['همه ماشینها'] });
  });

  it('knows legacy models and custom-field cells', () => {
    expect(legacyProtocolForModel('Teltonika FM4200')).toBe('teltonika');
    expect(legacyProtocolForModel('1120')).toBe('teltonika');
    expect(legacyProtocolForModel('Wonde Proud M7')).toBeNull();
    expect(parseCustomFields('نوع ماشين: اتیکو تک, ردیف: 22-1')).toEqual({
      'نوع ماشين': 'اتیکو تک',
      ردیف: '22-1',
    });
  });
});

describe('LegacyImportDialog', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await i18n.changeLanguage('en');
  });

  function wrapper({ children }: { children: ReactNode }) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return (
      <QueryClientProvider client={client}>
        <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
      </QueryClientProvider>
    );
  }

  it('previews the file, maps groups to fleets and imports', async () => {
    apiPost.mockResolvedValue({
      created: 1,
      updated: 1,
      failed: 0,
      fleetsCreated: ['پخش تهران'],
      rows: [
        {
          row: 2,
          imei: '350424065844621',
          name: 'T 15-612 izst',
          outcome: 'CREATED',
          warnings: [],
        },
        {
          row: 3,
          imei: '357454071960254',
          name: 'P 12-457 قنبري',
          outcome: 'UPDATED',
          warnings: ['Vehicle already had a primary tracker; bound as secondary.'],
        },
      ],
    });
    const csv = [
      OBJECTS_HEADER,
      objectsRow('T 15-612 izst', '350424065844621', 'پخش تهران', 'FMB120', '19121.6'),
      objectsRow('P 12-457 قنبري', '357454071960254', 'پیمانکار', 'FM1120', '0'),
    ]
      .map((r) => r.map((c) => `"${c}"`).join(','))
      .join('\n');
    render(<LegacyImportDialog open onClose={() => {}} />, { wrapper });
    const input = screen.getByLabelText(/Choose a CSV or Excel file/) as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File([`﻿${csv}`], 'objects_2026-08-20.csv', { type: 'text/csv' })] },
    });
    await waitFor(() =>
      expect(screen.getByText('Previous system objects list')).toBeInTheDocument(),
    );
    expect(screen.getByText('2 units read')).toBeInTheDocument();
    expect(screen.getByTestId('legacy-fleet-preview').textContent).toContain('پخش تهران: 1');

    fireEvent.click(screen.getByRole('button', { name: 'Import 2 units' }));
    await waitFor(() => expect(screen.getByTestId('legacy-import-result')).toBeInTheDocument());
    expect(apiPost).toHaveBeenCalledWith(
      '/vehicles/legacy-import',
      {
        rows: [
          expect.objectContaining({
            row: 2,
            imei: '350424065844621',
            fleet: 'پخش تهران',
            odometerKm: 19121.6,
            simNumber: '+989018237131',
          }),
          expect.objectContaining({ row: 3, fleet: 'پیمانکار' }),
        ],
      },
      expect.anything(),
    );
    expect(screen.getByText(/Fleets created: پخش تهران/)).toBeInTheDocument();
    expect(screen.getByText(/bound as secondary/)).toBeInTheDocument();
  });
});
