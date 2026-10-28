/**
 * Mine operations (`/operations`).
 *
 * Device activity answers when a machine started sending positions, how much
 * data arrived, how long it was offline, and how far it travelled. A haul
 * route names an origin, a destination, the shifts of the work day (two by
 * default), and the trucks and shovels on that service. Each origin →
 * destination pass is one service for the truck, the driver of that shift,
 * and the shovel that was loading.
 *
 * The reports are split in tabs: device activity, haul services, the period
 * roll-up, the wasted-time analysis, and the setup of the services. Every
 * report takes a ready-made or custom date range, shows charts beside its
 * tables and can be exported to Excel.
 */
import { Activity, BarChart3, CalendarRange, Settings2, Truck } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { getApiErrorMessage } from '@/api/errors';
import {
  type OperationsRange,
  useDeviceActivity,
  useHaulCycles,
  useHaulRoutes,
} from '@/api/operations.api';
import { ActivityTab } from '@/components/operations/ActivityTab';
import { HaulAnalysisSection } from '@/components/operations/HaulAnalysisSection';
import { PeriodsTab } from '@/components/operations/PeriodsTab';
import { RoutesTab } from '@/components/operations/RoutesTab';
import { ServicesTab } from '@/components/operations/ServicesTab';
import { RangeSummary } from '@/components/reports/RangeSummary';
import { ReportRangePicker } from '@/components/reports/ReportRangePicker';
import {
  Alert,
  Button,
  Card,
  EmptyState,
  PageHeader,
  Select,
  Tabs,
} from '@/components/tailwind-ui';
import {
  activitySheets,
  analysisSheets,
  downloadWorkbook,
  haulSheets,
  periodSheets,
} from '@/lib/operations-export';

type Tab = 'activity' | 'services' | 'periods' | 'analysis' | 'routes';

export function OperationsPage() {
  const { t, i18n } = useTranslation();
  const [tab, setTab] = useState<Tab>('activity');
  const [range, setRange] = useState<OperationsRange>({ preset: 'today' });
  const [routeId, setRouteId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const routes = useHaulRoutes();
  const activity = useDeviceActivity(range);
  const cycles = useHaulCycles(tab === 'services' ? routeId : null, range);

  const exportExcel = (build: () => Parameters<typeof downloadWorkbook>[0], name: string) => {
    setExporting(true);
    setMessage(null);
    try {
      const sheets = build();
      if (sheets.every((sheet) => sheet.rows.length <= 1)) {
        setMessage({ ok: false, text: t('operations.exportEmpty') });
        return;
      }
      downloadWorkbook(sheets, name);
    } catch (err) {
      setMessage({ ok: false, text: getApiErrorMessage(err) ?? t('operations.exportFailed') });
    } finally {
      setExporting(false);
    }
  };

  const showToolbar = tab !== 'routes';
  const needsRoute = tab === 'services' || tab === 'periods' || tab === 'analysis';

  return (
    <div className="flex flex-col gap-4" data-testid="operations-page">
      <PageHeader title={t('operations.title')} description={t('operations.subtitle')} />

      {showToolbar && (
        <Card className="flex flex-col gap-3" data-testid="operations-range">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <ReportRangePicker range={range} onChange={setRange} />
            {needsRoute && (
              <Select
                aria-label={t('operations.pickRoute')}
                data-testid="haul-route-select"
                wrapperClassName="w-full sm:w-72"
                value={routeId ?? ''}
                onChange={(event) => {
                  setRouteId(event.target.value || null);
                  setMessage(null);
                }}
              >
                <option value="">{t('operations.pickRoute')}</option>
                {(routes.data ?? []).map((route) => (
                  <option key={route.id} value={route.id}>
                    {route.name}
                  </option>
                ))}
              </Select>
            )}
          </div>
          <RangeSummary
            range={range}
            from={
              tab === 'activity'
                ? activity.data?.from
                : tab === 'services'
                  ? cycles.data?.from
                  : null
            }
            to={
              tab === 'activity' ? activity.data?.to : tab === 'services' ? cycles.data?.to : null
            }
          />
          <p className="text-xs text-gray-500 dark:text-graydark-600">
            {t('operations.presetHint')}
          </p>
        </Card>
      )}

      <Tabs<Tab>
        aria-label={t('operations.ui.tabsLabel')}
        value={tab}
        onChange={(next) => {
          setTab(next);
          setMessage(null);
        }}
        tabs={[
          {
            value: 'activity',
            label: t('operations.ui.tabs.activity'),
            icon: <Activity />,
            testid: 'ops-tab-activity',
          },
          {
            value: 'services',
            label: t('operations.ui.tabs.services'),
            icon: <Truck />,
            testid: 'ops-tab-services',
          },
          {
            value: 'periods',
            label: t('operations.ui.tabs.periods'),
            icon: <CalendarRange />,
            testid: 'ops-tab-periods',
          },
          {
            value: 'analysis',
            label: t('operations.ui.tabs.analysis'),
            icon: <BarChart3 />,
            testid: 'ops-tab-analysis',
          },
          {
            value: 'routes',
            label: t('operations.ui.tabs.routes'),
            icon: <Settings2 />,
            testid: 'ops-tab-routes',
          },
        ]}
      />

      {message && (
        <Alert variant={message.ok ? 'success' : 'warning'} onClose={() => setMessage(null)}>
          {message.text}
        </Alert>
      )}

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'activity' && (
          <ActivityTab
            data={activity.data}
            loading={Boolean(activity.isLoading)}
            failed={Boolean(activity.isError)}
            exporting={exporting}
            onExport={() =>
              activity.data &&
              exportExcel(
                () => activitySheets(activity.data, t, i18n.language),
                t('operations.sheetActivity'),
              )
            }
          />
        )}

        {needsRoute && !routeId && (
          <Card>
            <EmptyState
              icon={<Truck />}
              title={t('operations.ui.pickRouteTitle')}
              description={t('operations.ui.pickRouteDesc')}
              action={
                <Button size="sm" variant="outline" onClick={() => setTab('routes')}>
                  {t('operations.ui.goToRoutes')}
                </Button>
              }
            />
          </Card>
        )}

        {tab === 'services' && routeId && (
          <ServicesTab
            data={cycles.data}
            loading={Boolean(cycles.isFetching)}
            exporting={exporting}
            onExport={() =>
              cycles.data &&
              exportExcel(() => haulSheets(cycles.data, t, i18n.language), cycles.data.route.name)
            }
          />
        )}

        {tab === 'periods' && routeId && (
          <PeriodsTab
            routeId={routeId}
            range={range}
            exporting={exporting}
            onExport={(report) =>
              exportExcel(
                () => periodSheets(report, t, i18n.language),
                `${report.route.name}-${report.granularity}`,
              )
            }
          />
        )}

        {tab === 'analysis' && routeId && (
          <HaulAnalysisSection
            routeId={routeId}
            range={range}
            exporting={exporting}
            onExport={(report) =>
              exportExcel(
                () => analysisSheets(report, t, i18n.language),
                `${report.route.name}-${t('operations.analysis.title')}`,
              )
            }
          />
        )}

        {tab === 'routes' && <RoutesTab routeId={routeId} onSelect={setRouteId} />}
      </div>
    </div>
  );
}
