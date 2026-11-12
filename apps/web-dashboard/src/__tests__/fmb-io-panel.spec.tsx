import { fireEvent, render, screen, within } from '@testing-library/react';
import { createElement } from 'react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FmbIoPanelView } from '@/components/map/FmbIoPanelView';
import { i18n } from '@/i18n';
import type { FmbIoPanel, IoSensorConfig } from '@/types/fleet.types';

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
    // These cases cover the plain list; the gauges have their own block below.
    localStorage.setItem('fv.fmbIo.view', 'list');
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

const gaugePanel: FmbIoPanel = {
  updatedAt: NOW,
  groups: {
    din: [{ id: 1, key: 'din1', group: 'din', value: true, at: NOW }],
    ain: [
      { id: 9, key: 'ain1', group: 'ain', value: 2.5, unit: 'V', at: NOW },
      { id: 10, key: 'ain2', group: 'ain', value: 1.0, unit: 'V', at: NOW },
      { id: 11, key: 'ain3', group: 'ain', value: 12.4, unit: 'V', at: NOW },
    ],
    can: [{ id: 115, key: 'canEngineTemp', group: 'can', value: 104, unit: '°C', at: NOW }],
    other: [{ id: 300, key: null, group: 'other', value: 77, at: NOW }],
  },
};

const sensors: IoSensorConfig[] = [
  {
    input: 'ain1',
    kind: 'fuel',
    tankLiters: 200,
    points: [
      { v: 0.5, value: 0 },
      { v: 4.5, value: 100 },
    ],
  },
  {
    input: 'ain2',
    kind: 'temperature',
    label: 'Coolant',
    points: [
      { v: 0.5, value: 120 },
      { v: 3.5, value: 30 },
    ],
  },
];

describe('FmbIoPanelView gauges', () => {
  beforeEach(async () => {
    localStorage.clear();
    localStorage.setItem('fv.fmbIo.open', '1');
    await i18n.changeLanguage('en');
  });
  afterEach(() => localStorage.clear());

  it('opens on the graphic view: calibrated fuel tank and thermometer, lamps and voltmeter', () => {
    render(
      createElement(
        I18nextProvider,
        { i18n },
        createElement(FmbIoPanelView, { panel: gaugePanel, sensors }),
      ),
    );
    expect(screen.getByTestId('fmb-io-gauges')).toBeTruthy();
    const fuel = screen.getByTestId('gauge-ain-9');
    expect(within(fuel).getByText('50%')).toBeTruthy();
    expect(within(fuel).getByText('≈ 100 L')).toBeTruthy();
    const coolant = screen.getByTestId('gauge-ain-10');
    expect(within(coolant).getByText('Coolant')).toBeTruthy();
    expect(within(coolant).getByText('105 °C')).toBeTruthy();
    expect(within(coolant).getByText(/Hot/)).toBeTruthy();
    // CAN engine temperature is drawn as a thermometer without any setup.
    expect(within(screen.getByTestId('gauge-can-115')).getByText('104 °C')).toBeTruthy();
    // Uncalibrated input stays a voltmeter.
    expect(
      within(screen.getByTestId('gauge-ain-11')).getByRole('img', { name: '12.4 V' }),
    ).toBeTruthy();
    expect(within(screen.getByTestId('gauge-din-1')).getByText('On')).toBeTruthy();
    expect(screen.getByText(/1 more parameter is only in the list view/)).toBeTruthy();
  });

  it('switches to the list and remembers it', () => {
    renderPanel(gaugePanel);
    fireEvent.click(screen.getByRole('button', { name: 'List' }));
    expect(screen.queryByTestId('fmb-io-gauges')).toBeNull();
    expect(screen.getByText('Analog input 1 (voltage)')).toBeTruthy();
    expect(localStorage.getItem('fv.fmbIo.view')).toBe('list');
  });

  it('offers the sensor setup only with permission and a vehicle', () => {
    renderPanel(gaugePanel);
    expect(screen.queryByRole('button', { name: 'Sensors' })).toBeNull();
  });
});
