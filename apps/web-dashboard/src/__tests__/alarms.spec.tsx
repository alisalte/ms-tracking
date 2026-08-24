import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createElement } from 'react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuthStore } from '@/auth/auth.store';
import { mockAlarms } from '@/mock/alarm-data';
import { AlarmCenterPage } from '@/pages/AlarmCenterPage';

import { i18n } from '@/i18n';

// ── Mock maplibre-gl: jsdom has no WebGL. Stub the methods AlarmMap uses.
vi.mock('maplibre-gl', () => {
  const StubMap = class {
    on() {}
    off() {}
    addControl() {}
    getLayer() {
      return undefined;
    }
    removeLayer() {}
    removeSource() {}
    once(_ev: string, cb: (...a: never[]) => void) {
      cb();
    }
    loaded() {
      return true;
    }
    getBounds() {
      return { getWest: () => 50, getSouth: () => 34, getEast: () => 52, getNorth: () => 37 };
    }
    remove() {}
    getCanvas() {
      return document.createElement('canvas');
    }
  };
  const Marker = class {
    setLngLat() {
      return this;
    }
    addTo() {
      return this;
    }
    remove() {}
  };
  return { Map: StubMap, Marker, NavigationControl: class {} };
});

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } });
}

function renderAlarms(initialEntry = '/alarms') {
  const client = makeClient();
  return render(
    createElement(
      QueryClientProvider,
      { client },
      createElement(
        I18nextProvider,
        { i18n },
        createElement(
          MemoryRouter,
          { initialEntries: [initialEntry] },
          createElement(AlarmCenterPage),
        ),
      ),
    ),
  );
}

describe('AlarmCenterPage', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    // Sprint G: the drawer's Acknowledge/Resolve actions are permission-gated
    // (notification.alert.ack/resolve) — seed an admin user so the operator
    // action tests can click them.
    useAuthStore.setState({
      user: {
        id: 'u1',
        email: 'admin@test.local',
        fullName: 'Admin',
        roles: ['tenant-admin'],
        permissions: ['*'],
      } as never,
      tenantId: 't1',
      isAuthenticated: true,
    });
  });

  it('renders the title + live stats', async () => {
    renderAlarms();
    expect(await screen.findByText('Alarm Center')).toBeInTheDocument();
    // The active count stat renders (active alarms = non-resolved).
    const activeCount = mockAlarms.filter((a) => a.status !== 'resolved').length;
    await waitFor(() => {
      expect(screen.getByText(`${activeCount} active`)).toBeInTheDocument();
    });
  });

  it('renders alarm rows from mock data in the list view', async () => {
    renderAlarms();
    // Wait for the list to populate. The first alarm's vehicle label appears.
    const first = mockAlarms[0];
    await waitFor(() => {
      expect(screen.getByText(first.vehicleLabel)).toBeInTheDocument();
    });
  });

  it('opens the detail drawer when an alarm row is clicked', async () => {
    renderAlarms();
    const first = mockAlarms[0];
    await waitFor(() => expect(screen.getByText(first.vehicleLabel)).toBeInTheDocument());

    fireEvent.click(screen.getByText(first.vehicleLabel));

    // The drawer renders the alarm's headline message.
    await waitFor(() => {
      expect(screen.getByText(first.message)).toBeInTheDocument();
    });
    // And the vehicle detail row.
    expect(screen.getByText('Vehicle')).toBeInTheDocument();
  });

  it('filters the list by alarm type', async () => {
    renderAlarms();
    await waitFor(() => expect(screen.getByText(mockAlarms[0].vehicleLabel)).toBeInTheDocument());

    // The Type filter is the first combobox (a native select since the
    // Phase 6 TailAdmin port) — change by value.
    const typeSelect = screen.getAllByRole('combobox')[0];
    fireEvent.change(typeSelect, { target: { value: 'sos' } });

    // After filtering, only SOS alarms remain. A non-SOS alarm's vehicle
    // label disappears (the SOS dedup guarantees distinct labels for the test).
    const overspeedAlarm = mockAlarms.find((a) => a.type === 'overspeed');
    await waitFor(() => {
      if (overspeedAlarm) {
        expect(screen.queryByText(overspeedAlarm.vehicleLabel)).not.toBeInTheDocument();
      }
    });
  });

  it('renders the timeline view when switched', async () => {
    renderAlarms();
    await screen.findByText('Alarm Center');

    // The view switcher is the SegmentedControl primitive — WAI-ARIA
    // radiogroup semantics (role=radio), so query radios, not buttons.
    fireEvent.click(screen.getByRole('radio', { name: 'Timeline' }));

    // The timeline renders hour labels (HH:00). At least one is present.
    await waitFor(() => {
      const hourLabels = screen.queryAllByText(/^\d{2}:00$/);
      expect(hourLabels.length).toBeGreaterThan(0);
    });
  });

  it('renders the map view when switched', async () => {
    renderAlarms();
    await screen.findByText('Alarm Center');

    fireEvent.click(screen.getByRole('radio', { name: 'Map' }));

    // The map view is active: the list table header (column "Severity") is
    // gone, confirming we switched away from the list without crashing.
    await waitFor(() => {
      expect(screen.queryByText('Severity')).not.toBeInTheDocument();
    });
  });

  it('uses mock alarms covering all 8 catalog types', () => {
    const types = new Set(mockAlarms.map((a) => a.type));
    for (const ty of [
      'sos',
      'overspeed',
      'geofence',
      'offline',
      'fuel-theft',
      'temperature',
      'collision',
      'camera',
    ]) {
      expect(types.has(ty as never)).toBe(true);
    }
  });

  it('uses mock alarms covering the lifecycle states', () => {
    const statuses = new Set(mockAlarms.map((a) => a.status));
    expect(statuses.has('raised')).toBe(true);
    expect(statuses.has('acked')).toBe(true);
    expect(statuses.has('escalated')).toBe(true);
    expect(statuses.has('resolved')).toBe(true);
  });

  it('transitions an alarm to acknowledged when the Acknowledge button is clicked', async () => {
    renderAlarms();
    // Pick a raised (unacked) alarm so the Acknowledge action is available.
    const raised = mockAlarms.find((a) => a.status === 'raised');
    if (!raised) throw new Error('no raised alarm in mock data');
    await waitFor(() => expect(screen.getByText(raised.vehicleLabel)).toBeInTheDocument());

    fireEvent.click(screen.getByText(raised.vehicleLabel));

    // The drawer's Acknowledge button transitions the alarm to acked.
    const ackBtn = await screen.findByRole('button', { name: 'Acknowledge' });
    fireEvent.click(ackBtn);

    // After the optimistic transition, the Acknowledge button disappears
    // (the alarm is now acked → only Resolve/Contest remain). Scope the
    // "Acknowledged" status check to the drawer to avoid list-table matches.
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Acknowledge' })).not.toBeInTheDocument();
    });
    // The shared Drawer primitive renders role="dialog" (aria-modal).
    const drawer = screen.getByRole('dialog', { hidden: false });
    expect(within(drawer).getByText('Acknowledged')).toBeInTheDocument();
  });
});
