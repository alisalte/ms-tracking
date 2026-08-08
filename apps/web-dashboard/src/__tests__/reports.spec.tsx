import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mockKpis, mockReportDefinitions, mockReportJobs } from '@/mock/report-data';
import { ReportsPage } from '@/pages/ReportsPage';

import { i18n } from '@/i18n';

// Recharts ResponsiveContainer needs a sized parent; stub it to render children.
vi.mock('recharts', async () => {
  const actual = (await vi.importActual('recharts')) as Record<string, unknown>;
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div style={{ width: 400, height: 240 }}>{children}</div>
    ),
  };
});

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } });
}

function renderReports(initialEntry = '/reports') {
  const client = makeClient();
  return render(
    createElement(
      QueryClientProvider,
      { client },
      createElement(
        I18nextProvider,
        { i18n },
        createElement(MemoryRouter, { initialEntries: [initialEntry] }, createElement(ReportsPage)),
      ),
    ),
  );
}

describe('ReportsPage', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('renders the title + 4 section tabs', async () => {
    renderReports();
    expect(await screen.findByText('Reports & Analytics')).toBeInTheDocument();
    for (const s of ['Overview', 'Reports', 'Jobs & Exports', 'Dashboards']) {
      expect(screen.getByRole('tab', { name: s })).toBeInTheDocument();
    }
  });

  it('renders the KPI scorecards on the Overview section', async () => {
    renderReports();
    // The KPI names render once the query resolves.
    await waitFor(() => {
      expect(screen.getByText('Fleet Utilization')).toBeInTheDocument();
    });
    expect(screen.getByText('Safety Score')).toBeInTheDocument();
  });

  it('switches to the Reports section and renders the catalog', async () => {
    renderReports();
    await screen.findByText('Reports & Analytics');
    fireEvent.click(screen.getByRole('tab', { name: 'Reports' }));

    await waitFor(() => {
      expect(screen.getByText(mockReportDefinitions[0].name)).toBeInTheDocument();
    });
  });

  it('filters the report catalog by category', async () => {
    renderReports();
    await screen.findByText('Reports & Analytics');
    fireEvent.click(screen.getByRole('tab', { name: 'Reports' }));

    await waitFor(() =>
      expect(screen.getByText(mockReportDefinitions[0].name)).toBeInTheDocument(),
    );

    // Click the Compliance category toggle.
    fireEvent.click(screen.getByRole('button', { name: 'Compliance' }));
    // A non-compliance report disappears.
    const operational = mockReportDefinitions.find((d) => d.category === 'operational');
    await waitFor(() => {
      if (operational) expect(screen.queryByText(operational.name)).not.toBeInTheDocument();
    });
  });

  it('opens the generate dialog when a report Generate button is clicked', async () => {
    renderReports();
    await screen.findByText('Reports & Analytics');
    fireEvent.click(screen.getByRole('tab', { name: 'Reports' }));
    await waitFor(() =>
      expect(screen.getByText(mockReportDefinitions[0].name)).toBeInTheDocument(),
    );

    // Click the first "Generate" button.
    const generateButtons = screen.getAllByRole('button', { name: 'Generate' });
    fireEvent.click(generateButtons[0]);

    await waitFor(() => {
      expect(screen.getByText('Generate report')).toBeInTheDocument();
    });
  });

  it('switches to the Jobs section and renders the job history', async () => {
    renderReports();
    await screen.findByText('Reports & Analytics');
    fireEvent.click(screen.getByRole('tab', { name: 'Jobs & Exports' }));

    await waitFor(() => {
      expect(screen.getByText(mockReportJobs[0].definitionName)).toBeInTheDocument();
    });
  });

  it('switches to the Dashboards section and renders saved dashboards', async () => {
    renderReports();
    await screen.findByText('Reports & Analytics');
    fireEvent.click(screen.getByRole('tab', { name: 'Dashboards' }));

    // "Fleet Overview" appears both as a card and as the rendered header —
    // assert it shows up at least once.
    await waitFor(() => {
      expect(screen.getAllByText('Fleet Overview').length).toBeGreaterThan(0);
    });
  });

  it('uses mock KPIs covering the 5 headline metrics', () => {
    expect(mockKpis.length).toBe(5);
    expect(mockKpis.some((k) => k.unit === '%')).toBe(true);
  });
});
