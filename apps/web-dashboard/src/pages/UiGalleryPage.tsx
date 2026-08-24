/**
 * UiGalleryPage — the design-system gallery (Storybook-equivalent, zero-dep).
 *
 * A PUBLIC dev/QA route rendering every tailwind-ui primitive in its states
 * (default / hover-target / active / disabled / loading / dark / RTL), plus
 * the composed patterns the app is built from (KPI tile, data table with
 * selection + bulk bar + error state, toolbar, segmented controls, meters).
 *
 * Purpose: visual regression baselines + design review. Every interactive
 * demo is real (state-driven) — nothing is a static picture.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ErrorState } from '@/components/common/ErrorState';
import { KpiChip, KpiTile } from '@/components/dashboard/KpiTile';
import { ConfirmDialog } from '@/components/feedback/ConfirmDialog';
import { useToast } from '@/components/feedback/ToastProvider';
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  Checkbox,
  DataTable,
  Drawer,
  EmptyState,
  IconButton,
  Input,
  LoadMoreButton,
  Meter,
  Modal,
  NumberedPagination,
  SegmentedControl,
  Select,
  Skeleton,
  Spinner,
  StatusBadge,
  Switch,
  type TableColumn,
  Tabs,
  Textarea,
  Toolbar,
  Tooltip,
} from '@/components/tailwind-ui';
import {
  Activity,
  Bell,
  Check,
  Download,
  Fence,
  Gauge,
  Plus,
  Route,
  Search,
  Truck,
  Users,
} from 'lucide-react';

/** Section chrome — consistent gallery anatomy. */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="mb-1 text-lg font-bold tracking-tight text-gray-900 dark:text-white">
        {title}
      </h2>
      <p className="mb-4 text-xs text-gray-500 dark:text-graydark-600">
        {/* section anchor for visual-diff navigation */}
        <code>#{title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}</code>
      </p>
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">{children}</div>
    </section>
  );
}

function Demo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-gray-200 p-4 dark:border-white/10">
      <p className="mb-3 text-xs font-semibold tracking-wide text-gray-400 uppercase dark:text-graydark-600">
        {label}
      </p>
      {children}
    </div>
  );
}

interface DemoRow {
  id: string;
  vehicle: string;
  driver: string;
  status: 'moving' | 'idle' | 'offline';
  speed: number;
}

const TABLE_ROWS: DemoRow[] = [
  { id: '1', vehicle: 'TRK-100', driver: 'A. Karimi', status: 'moving', speed: 62 },
  { id: '2', vehicle: 'TRK-101', driver: 'M. Rostami', status: 'idle', speed: 0 },
  { id: '3', vehicle: 'VAN-102', driver: 'S. Nazari', status: 'offline', speed: 0 },
];

export function UiGalleryPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const [segment, setSegment] = useState<'day' | 'week' | 'month'>('week');
  const [tab, setTab] = useState('one');
  const [checks, setChecks] = useState({ on: true, off: false });
  const [switches, setSwitches] = useState({ on: true, off: false });
  const [selectedKeys, setSelectedKeys] = useState<Array<string | number>>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [page, setPage] = useState(2);
  const [input, setInput] = useState('');

  const columns: Array<TableColumn<DemoRow>> = [
    {
      id: 'vehicle',
      header: 'Vehicle',
      sortBy: (r) => r.vehicle,
      render: (r) => <span className="font-medium">{r.vehicle}</span>,
    },
    { id: 'driver', header: 'Driver', sortBy: (r) => r.driver, render: (r) => r.driver },
    {
      id: 'status',
      header: 'Status',
      sortBy: (r) => r.status,
      render: (r) => (
        <StatusBadge
          kind={r.status === 'moving' ? 'moving' : r.status === 'idle' ? 'idle' : 'offline'}
        >
          {r.status}
        </StatusBadge>
      ),
    },
    { id: 'speed', header: 'km/h', align: 'end', sortBy: (r) => r.speed, render: (r) => r.speed },
  ];

  return (
    <div className="min-h-screen bg-gray-50 p-6 dark:bg-graydark-200">
      <header className="mb-8">
        <p className="text-xs font-bold tracking-[0.08em] text-brand-600 uppercase dark:text-brand-300">
          FleetVision Design System
        </p>
        <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
          Component Gallery
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-gray-500 dark:text-graydark-600">
          Every primitive in every state — the visual-regression target and the single source of
          truth for the UI kit. Switch language/theme from the URL or localStorage to capture the
          en/fa × light/dark matrix.
        </p>
      </header>

      <Section title="Buttons">
        <Demo label="variants × sizes">
          <div className="flex flex-wrap items-center gap-3">
            <Button leftIcon={<Plus size={15} />}>Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger">Danger</Button>
            <Button variant="success">Success</Button>
            <Button size="sm">Small</Button>
            <Button size="lg">Large</Button>
          </div>
        </Demo>
        <Demo label="states">
          <div className="flex flex-wrap items-center gap-3">
            <Button disabled>Disabled</Button>
            <Button loading>Loading</Button>
            <IconButton aria-label="notification">
              <Bell size={16} />
            </IconButton>
            <IconButton aria-label="download" variant="solid">
              <Download size={16} />
            </IconButton>
            <Tooltip label="Tooltip on hover">
              <Button variant="secondary">Hover me</Button>
            </Tooltip>
          </div>
        </Demo>
      </Section>

      <Section title="Inputs">
        <Demo label="text / select / textarea">
          <div className="flex flex-col gap-4">
            <Input
              label="Label"
              placeholder="Placeholder…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              hint="Helper hint"
            />
            <Input label="Error" placeholder="Invalid…" error="Validation message" />
            <Input label="With icon" leftIcon={<Search size={15} />} placeholder="Search…" />
            <Select
              label="Select"
              options={[
                { value: 'a', label: 'Option A' },
                { value: 'b', label: 'Option B' },
              ]}
            />
            <Textarea label="Textarea" placeholder="Multi-line…" />
          </div>
        </Demo>
        <Demo label="checkbox / switch / segmented">
          <div className="flex flex-col gap-4">
            <Checkbox
              label="Checked (labelled)"
              checked={checks.on}
              onChange={(e) => setChecks((c) => ({ ...c, on: e.target.checked }))}
            />
            <Checkbox
              label="Unchecked + hint"
              hint="Helper hint"
              checked={checks.off}
              onChange={(e) => setChecks((c) => ({ ...c, off: e.target.checked }))}
            />
            <div className="flex items-center gap-6">
              <Switch
                checked={switches.on}
                onChange={(e) => setSwitches((s) => ({ ...s, on: e.target.checked }))}
                label="On"
              />
              <Switch
                checked={switches.off}
                onChange={(e) => setSwitches((s) => ({ ...s, off: e.target.checked }))}
                label="Off"
              />
            </div>
            <SegmentedControl
              aria-label="period"
              options={[
                { value: 'day', label: 'Day' },
                { value: 'week', label: 'Week' },
                { value: 'month', label: 'Month' },
              ]}
              value={segment}
              onChange={setSegment}
            />
          </div>
        </Demo>
      </Section>

      <Section title="Data Display">
        <Demo label="badges / status / avatar">
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-2">
              <Badge color="brand">Brand</Badge>
              <Badge color="success" dot>
                Success
              </Badge>
              <Badge color="warning">Warning</Badge>
              <Badge color="danger" dot>
                Danger
              </Badge>
              <Badge color="gray">Gray</Badge>
            </div>
            <div className="flex flex-wrap gap-2">
              <StatusBadge kind="online">online</StatusBadge>
              <StatusBadge kind="idle">idle</StatusBadge>
              <StatusBadge kind="offline">offline</StatusBadge>
              <StatusBadge kind="critical">critical</StatusBadge>
            </div>
            <div className="flex items-center gap-3">
              <Avatar name="Ali Karimi" />
              <Avatar name="Sara Nazari" />
              <Avatar name="MV" />
            </div>
          </div>
        </Demo>
        <Demo label="meters / skeletons / spinner / empty">
          <div className="flex flex-col gap-5">
            <Meter label="Connectivity (with max)" value={18} max={24} tone="success" showMax />
            <Meter label="Utilization" value={72} tone="brand" unit="%" />
            <Meter label="Critical alarms" value={3} max={10} tone="danger" />
            <div className="flex flex-col gap-2">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-24 w-full" />
            </div>
            <div className="flex items-center gap-4">
              <Spinner />
              <Spinner size="lg" />
            </div>
            <EmptyState
              icon={<Users />}
              title="Nothing here yet"
              description="Items will appear."
            />
          </div>
        </Demo>
      </Section>

      <Section title="KPI Tile">
        <Demo label="rich tile (icon + tone + footer chip)">
          <div className="grid grid-cols-2 gap-4">
            <KpiTile
              labelKey="dashboard.stats.totalVehicles"
              value={128}
              icon={Truck}
              tone="brand"
              footer={<KpiChip tone="gray">12 fleets</KpiChip>}
            />
            <KpiTile
              labelKey="dashboard.stats.avgSpeed"
              value={54}
              suffix="km/h"
              icon={Gauge}
              tone="teal"
              loading={false}
            />
            <KpiTile
              labelKey="dashboard.stats.criticalAlarms"
              value={3}
              icon={Activity}
              tone="danger"
              footer={<KpiChip tone="danger">7 open</KpiChip>}
            />
            <KpiTile
              labelKey="dashboard.stats.geofenceEvents"
              value={null}
              icon={Fence}
              tone="gray"
            />
          </div>
        </Demo>
        <Demo label="alerts">
          <div className="flex flex-col gap-3">
            <Alert variant="info">Informational alert.</Alert>
            <Alert variant="success">Operation completed.</Alert>
            <Alert variant="warning">Approaching retention limit.</Alert>
            <Alert variant="danger">The action failed — try again.</Alert>
          </div>
        </Demo>
      </Section>

      <Section title="Data Table">
        <Demo label="selection + bulk bar + sortable">
          <DataTable
            rows={TABLE_ROWS}
            columns={columns}
            rowKey={(r) => r.id}
            selectable
            selectedKeys={selectedKeys}
            onSelectionChange={(keys) => setSelectedKeys(keys)}
            bulkActions={(rows) => (
              <Button size="sm" variant="outline" leftIcon={<Download size={14} />}>
                Export {rows.length}
              </Button>
            )}
          />
        </Demo>
        <Demo label="loading / empty / error states">
          <div className="flex flex-col gap-6">
            <DataTable rows={[]} columns={columns} rowKey={(r) => r.id} loading />
            <DataTable rows={[]} columns={columns} rowKey={(r) => r.id} />
            <Card flush className="p-0">
              <ErrorState error={new Error('Network unreachable')} onRetry={() => {}} />
            </Card>
          </div>
        </Demo>
      </Section>

      <Section title="Overlays">
        <Demo label="drawer / modal / confirm / toast">
          <div className="flex flex-wrap gap-3">
            <Button variant="secondary" onClick={() => setDrawerOpen(true)}>
              Open Drawer
            </Button>
            <Button variant="secondary" onClick={() => setModalOpen(true)}>
              Open Modal
            </Button>
            <Button variant="secondary" onClick={() => setConfirmOpen(true)}>
              Open Confirm
            </Button>
            <Button variant="secondary" onClick={() => toast.success('admin.settings.toastSaved')}>
              Success toast
            </Button>
            <Button variant="secondary" onClick={() => toast.error('errors.generic')}>
              Error toast
            </Button>
          </div>
        </Demo>
        <Demo label="tabs + toolbar + pagination">
          <Tabs
            tabs={[
              { value: 'one', label: 'First' },
              { value: 'two', label: 'Second' },
              { value: 'three', label: 'Third' },
            ]}
            value={tab}
            onChange={setTab}
          />
          <div className="mt-4">
            <Toolbar
              search
              searchPlaceholder="Search…"
              left={
                <Select
                  options={[
                    { value: 'all', label: 'All' },
                    { value: 'a', label: 'Type A' },
                  ]}
                  aria-label="filter"
                />
              }
              right={
                <Button size="sm" leftIcon={<Check size={14} />}>
                  Action
                </Button>
              }
            />
          </div>
          <div className="mt-4 flex items-center gap-4">
            <NumberedPagination page={page} pageCount={5} onChange={setPage} />
            <LoadMoreButton hasNextPage onClick={() => {}} isFetchingNextPage={false} />
          </div>
        </Demo>
      </Section>

      <Section title="Cards">
        <Demo label="card anatomy">
          <Card>
            <CardHeader
              title="Card with header"
              icon={<Route size={16} />}
              action={<Badge color="brand">live</Badge>}
            />
            <p className="text-sm text-gray-500 dark:text-graydark-600">
              Standard surface with tinted icon chip, title, and an end-aligned action slot. Flush
              variant lets charts and tables control padding.
            </p>
          </Card>
        </Demo>
        <Demo label="interactive card">
          <Card interactive>
            <p className="text-sm font-semibold">Interactive hover lift</p>
            <p className="mt-1 text-sm text-gray-500 dark:text-graydark-600">
              Lifts on hover — the KPI click-through pattern.
            </p>
          </Card>
        </Demo>
      </Section>

      {/* Live overlays (render at the end for stacking). */}
      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title="Gallery drawer"
        subtitle="Shared slide-over primitive"
        size="sm"
      >
        <p className="text-sm text-gray-500 dark:text-graydark-600">
          Body scroll is locked; Esc and backdrop close.
        </p>
      </Drawer>
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Gallery modal">
        <p className="text-sm text-gray-500 dark:text-graydark-600">
          Centered dialog with the shared header/close pattern.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setModalOpen(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => setModalOpen(false)}>OK</Button>
        </div>
      </Modal>
      <ConfirmDialog
        open={confirmOpen}
        title="Delete this item?"
        message="This action cannot be undone."
        tone="danger"
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => setConfirmOpen(false)}
      />
    </div>
  );
}
