import { act, render } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AnalyticsMap } from '@/components/analytics/AnalyticsMap';
import { i18n } from '@/i18n';

const fitBounds = vi.fn();

vi.mock('maplibre-gl', () => {
  class Popup {
    setLngLat() {
      return this;
    }
    setDOMContent() {
      return this;
    }
    addTo() {
      return this;
    }
    remove() {}
  }

  class FakeMap {
    container: HTMLElement;
    canvas: HTMLElement;
    sources = new globalThis.Map<string, { setData: (data: unknown) => void }>();
    layers = new globalThis.Set<string>();
    center = { lng: 51.338, lat: 35.719 };

    constructor(opts: { container: HTMLElement }) {
      this.container = opts.container;
      this.canvas = document.createElement('div');
      opts.container.appendChild(this.canvas);
      Object.defineProperty(opts.container, 'clientWidth', { configurable: true, value: 800 });
      Object.defineProperty(opts.container, 'clientHeight', { configurable: true, value: 600 });
    }

    loaded() {
      return true;
    }
    isStyleLoaded() {
      return true;
    }
    on() {}
    off() {}
    once(_event: string, cb: () => void) {
      cb();
    }
    getContainer() {
      return this.container;
    }
    getCanvasContainer() {
      return this.canvas;
    }
    getCanvas() {
      return { style: {} };
    }
    getSource(id: string) {
      return this.sources.get(id);
    }
    addSource(id: string) {
      this.sources.set(id, {
        setData() {},
      });
    }
    removeSource(id: string) {
      this.sources.delete(id);
    }
    getLayer(id: string) {
      return this.layers.has(id) ? { id } : undefined;
    }
    addLayer(layer: { id: string }) {
      this.layers.add(layer.id);
    }
    removeLayer(id: string) {
      this.layers.delete(id);
    }
    moveLayer() {}
    resize() {}
    stop() {}
    jumpTo() {}
    triggerRepaint() {}
    getZoom() {
      return 10;
    }
    getBearing() {
      return 0;
    }
    getPitch() {
      return 0;
    }
    getCenter() {
      return this.center;
    }
    project([lng, lat]: [number, number]) {
      return { x: (lng - 52.5) * 800 + 400, y: (29.6 - lat) * 800 + 300 };
    }
    fitBounds(bounds: [[number, number], [number, number]]) {
      fitBounds(bounds);
      this.center = {
        lng: (bounds[0][0] + bounds[1][0]) / 2,
        lat: (bounds[0][1] + bounds[1][1]) / 2,
      };
    }
    queryRenderedFeatures() {
      return [];
    }
    remove() {}
  }

  return { Map: FakeMap, Popup };
});

afterEach(() => {
  fitBounds.mockClear();
});

describe('AnalyticsMap', () => {
  it('frames the colored cells and paints them above the basemap', async () => {
    const { unmount } = render(
      <I18nextProvider i18n={i18n}>
        <AnalyticsMap
          fitKey="shiraz"
          cells={[
            {
              south: 29.6,
              west: 52.5,
              north: 29.62,
              east: 52.52,
              color: '#12B76A',
              opacity: 0.55,
              tip: 'good',
            },
            {
              south: 29.63,
              west: 52.53,
              north: 29.65,
              east: 52.55,
              color: '#F04438',
              opacity: 0.78,
              tip: 'poor',
            },
          ]}
          hull={[
            { lat: 35.7, lng: 51.3 },
            { lat: 35.8, lng: 51.4 },
            { lat: 35.75, lng: 51.5 },
          ]}
          points={[{ lat: 29.61, lng: 52.51, color: '#B42318', tip: 'alarm' }]}
        />
      </I18nextProvider>,
    );

    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });

    const overlay = document.querySelector('[data-testid="analytics-map-overlay"]');
    expect(overlay?.innerHTML).toContain('#12B76A');
    expect(overlay?.innerHTML).toContain('#F04438');
    expect(overlay?.innerHTML).toContain('#B42318');

    expect(fitBounds).toHaveBeenCalled();
    const bounds = fitBounds.mock.calls.at(-1)?.[0] as [[number, number], [number, number]];
    expect(bounds[0][1]).toBeGreaterThan(29);
    expect(bounds[1][1]).toBeLessThan(30);
    expect(bounds[0][0]).toBeGreaterThan(52);
    expect(bounds[1][0]).toBeLessThan(53);

    unmount();
  });
});
