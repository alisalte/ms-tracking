import { fireEvent, render, screen, within } from '@testing-library/react';
import { createElement } from 'react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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

const toggle = () => screen.getByRole('button', { name: /Inputs & outputs/ });
const open = () => fireEvent.click(toggle());

describe('FmbIoPanelView', () => {
  beforeEach(async () => {
    localStorage.clear();
    await i18n.changeLanguage('en');
  });
  afterEach(() => localStorage.clear());

  it('starts folded and says what is inside in one line', () => {
    renderPanel(panel);
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    const root = screen.getByTestId('fmb-io-panel');
    expect(within(root).getByText(/1 of 2 digital inputs on/)).toBeTruthy();
    expect(within(root).getByText(/Analog inputs: 1/)).toBeTruthy();
    // No row is drawn while folded.
    expect(within(root).queryByText('Digital input 1')).toBeNull();
  });

  it('opens to named rows with on/off and a readable value', () => {
    renderPanel(panel);
    open();
    const root = screen.getByTestId('fmb-io-panel');
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(within(root).getByText('Digital input 1')).toBeTruthy();
    expect(within(root).getByText('On')).toBeTruthy();
    expect(within(root).getByText('Off')).toBeTruthy();
    expect(within(root).getByText('Analog input 1 (voltage)')).toBeTruthy();
    expect(within(root).getByText('12.34 V')).toBeTruthy();
    // The technical code stays visible under the name.
    expect(within(root).getByText('DIN1')).toBeTruthy();
    expect(within(root).getByText('AIN1')).toBeTruthy();
  });

  it('folds each group on its own', () => {
    renderPanel(panel);
    open();
    const din = screen.getByRole('button', { name: /Digital inputs/ });
    expect(screen.getByText('Digital input 1')).toBeTruthy();
    fireEvent.click(din);
    expect(screen.queryByText('Digital input 1')).toBeNull();
    expect(screen.getByText('Analog input 1 (voltage)')).toBeTruthy(); // others untouched
    fireEvent.click(din);
    expect(screen.getByText('Digital input 1')).toBeTruthy();
  });

  it('keeps unnamed parameters folded and labels them as unknown with their AVL id', () => {
    renderPanel(panel);
    open();
    expect(screen.queryByText('AVL 300')).toBeNull(); // folded by default
    fireEvent.click(screen.getByRole('button', { name: /Other parameters/ }));
    expect(screen.getByText('Unknown parameter')).toBeTruthy();
    expect(screen.getByText('AVL 300')).toBeTruthy();
  });

  it('dims a value the device has not refreshed for more than 10 minutes', () => {
    renderPanel(panel);
    open();
    const stale = screen.getByText('Fuel level – sensor 1').closest('li');
    const fresh = screen.getByText('Digital input 1').closest('li');
    expect(stale?.className).toContain('opacity-50');
    expect(fresh?.className).not.toContain('opacity-50');
  });

  it('remembers whether it was open', () => {
    const first = renderPanel(panel);
    open();
    first.unmount();
    renderPanel(panel);
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
  });

  it('renders nothing for an empty panel', () => {
    renderPanel({ updatedAt: NOW, groups: {} });
    expect(screen.queryByTestId('fmb-io-panel')).toBeNull();
  });
});
