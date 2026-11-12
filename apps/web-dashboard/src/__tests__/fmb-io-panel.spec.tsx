import { render, screen, within } from '@testing-library/react';
import { createElement } from 'react';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it } from 'vitest';

import { FmbIoPanelView } from '@/components/map/FmbIoPanelView';
import { i18n } from '@/i18n';
import type { FmbIoPanel } from '@/types/fleet.types';

const NOW = new Date().toISOString();
const OLD = new Date(Date.now() - 60 * 60 * 1000).toISOString();

const panel: FmbIoPanel = {
  updatedAt: NOW,
  groups: {
    din: [
      { id: 1, key: 'din1', group: 'din', value: true, at: NOW },
      { id: 2, key: 'din2', group: 'din', value: false, at: NOW },
    ],
    ain: [{ id: 9, key: 'ain1', group: 'ain', value: 12.34, unit: 'V', at: NOW }],
    serial: [{ id: 201, key: 'lls1Level', group: 'serial', value: 480, at: OLD }],
    other: [{ id: 300, key: null, group: 'other', value: 77, at: NOW }],
  },
};

function renderPanel(p: FmbIoPanel) {
  return render(
    createElement(I18nextProvider, { i18n }, createElement(FmbIoPanelView, { panel: p })),
  );
}

describe('FmbIoPanelView', () => {
  it('shows only the groups that have points, with on/off and scaled values', async () => {
    await i18n.changeLanguage('en');
    renderPanel(panel);
    const root = screen.getByTestId('fmb-io-panel');
    expect(within(root).getByText('Digital inputs')).toBeTruthy();
    expect(within(root).getByText('Analog inputs')).toBeTruthy();
    expect(within(root).queryByText('Digital outputs')).toBeNull();
    expect(within(root).getByText('DIN 1')).toBeTruthy();
    expect(within(root).getByText('On')).toBeTruthy();
    expect(within(root).getByText('Off')).toBeTruthy();
    expect(within(root).getByText('12.34 V')).toBeTruthy();
  });

  it('labels an unmapped element by its AVL id', async () => {
    await i18n.changeLanguage('en');
    renderPanel(panel);
    expect(screen.getByText('AVL 300')).toBeTruthy();
  });

  it('dims a value the device has not refreshed for more than 10 minutes', async () => {
    await i18n.changeLanguage('en');
    renderPanel(panel);
    const stale = screen.getByText('Fuel sensor 1 level').closest('li');
    const fresh = screen.getByText('DIN 1').closest('li');
    expect(stale?.className).toContain('opacity-50');
    expect(fresh?.className).not.toContain('opacity-50');
  });

  it('renders nothing for an empty panel', async () => {
    renderPanel({ updatedAt: NOW, groups: {} });
    expect(screen.queryByTestId('fmb-io-panel')).toBeNull();
  });
});
