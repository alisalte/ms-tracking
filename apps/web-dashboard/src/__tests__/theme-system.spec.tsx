/**
 * Phase 2 — theme system tests (light / dark / system + persistence).
 *
 * ThemeRegistry resolves the stored preference, mirrors the resolved mode onto
 * `<html class="dark">` (Tailwind's dark: variant), persists every change to
 * `fleetvision_theme_mode`, and — in `system` mode — follows the OS color
 * scheme live via matchMedia. The legacy `mode`/`toggleColorMode` API stays
 * backward compatible for MUI-era consumers (EChart, KpiCard, …).
 */
import { act, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/i18n';
import { ThemeRegistry, useThemeContext } from '@/theme/ThemeRegistry';

// ── matchMedia mock (jsdom has none) ────────────────────────────────────────

let prefersDark = false;
const mediaListeners = new Set<(event: { matches: boolean }) => void>();

function installMatchMedia() {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: query.includes('dark') ? prefersDark : false,
      media: query,
      onchange: null,
      addEventListener: (_: string, cb: (event: { matches: boolean }) => void) => {
        mediaListeners.add(cb);
      },
      removeEventListener: (_: string, cb: (event: { matches: boolean }) => void) => {
        mediaListeners.delete(cb);
      },
      addListener: (cb: (event: { matches: boolean }) => void) => {
        mediaListeners.add(cb);
      },
      removeListener: (cb: (event: { matches: boolean }) => void) => {
        mediaListeners.delete(cb);
      },
      dispatchEvent: () => false,
    }),
  });
}

function setOSPreference(dark: boolean) {
  prefersDark = dark;
  for (const listener of mediaListeners) listener({ matches: dark });
}

// Probe: reads the context and exposes actions as buttons.
function Probe() {
  const { mode, preference, toggleColorMode, setPreference } = useThemeContext();
  return (
    <div>
      <span data-testid="mode">{mode}</span>
      <span data-testid="preference">{preference}</span>
      <button type="button" onClick={toggleColorMode}>
        toggle
      </button>
      <button type="button" onClick={() => setPreference('dark')}>
        set-dark
      </button>
      <button type="button" onClick={() => setPreference('system')}>
        set-system
      </button>
    </div>
  );
}

function renderProbe() {
  return render(
    <I18nextProvider i18n={i18n}>
      <ThemeRegistry>
        <Probe />
      </ThemeRegistry>
    </I18nextProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove('dark');
  mediaListeners.clear();
  prefersDark = false;
  installMatchMedia();
});

describe('ThemeRegistry — light/dark/system with persistence', () => {
  it('defaults to light when nothing is stored', () => {
    renderProbe();
    expect(screen.getByTestId('mode').textContent).toBe('light');
    expect(screen.getByTestId('preference').textContent).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('setPreference(dark) resolves dark, mirrors .dark on <html>, and persists', () => {
    renderProbe();
    act(() => {
      screen.getByText('set-dark').click();
    });
    expect(screen.getByTestId('mode').textContent).toBe('dark');
    expect(screen.getByTestId('preference').textContent).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(localStorage.getItem('fleetvision_theme_mode')).toBe('dark');
  });

  it("system mode follows the OS scheme (dark → light) and persists as 'system'", () => {
    prefersDark = true;
    renderProbe();
    act(() => {
      screen.getByText('set-system').click();
    });
    expect(screen.getByTestId('preference').textContent).toBe('system');
    expect(screen.getByTestId('mode').textContent).toBe('dark');
    expect(localStorage.getItem('fleetvision_theme_mode')).toBe('system');

    // OS flips to light while the app is open → resolved mode follows live.
    act(() => {
      setOSPreference(false);
    });
    expect(screen.getByTestId('mode').textContent).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    // The stored preference stays 'system'.
    expect(localStorage.getItem('fleetvision_theme_mode')).toBe('system');
  });

  it('toggleColorMode pins an explicit mode (system:dark → explicit light)', () => {
    prefersDark = true;
    renderProbe();
    act(() => {
      screen.getByText('set-system').click();
    });
    expect(screen.getByTestId('mode').textContent).toBe('dark');

    act(() => {
      screen.getByText('toggle').click();
    });
    expect(screen.getByTestId('mode').textContent).toBe('light');
    expect(screen.getByTestId('preference').textContent).toBe('light');
    expect(localStorage.getItem('fleetvision_theme_mode')).toBe('light');
  });

  it('restores a persisted system preference on mount', () => {
    localStorage.setItem('fleetvision_theme_mode', 'system');
    prefersDark = true;
    renderProbe();
    expect(screen.getByTestId('preference').textContent).toBe('system');
    expect(screen.getByTestId('mode').textContent).toBe('dark');
  });
});

// Silence React act warnings from the matchMedia listener firing in effects.
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
