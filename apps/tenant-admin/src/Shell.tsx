import { BarChart3, Building2, FileText, LayoutDashboard, LogOut, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';

import { i18n } from '@/i18n';
import { clearSession, loadSession } from '@/lib/session';

const NAV = [
  { to: '/', key: 'nav.dashboard', icon: LayoutDashboard, end: true },
  { to: '/tenants', key: 'nav.tenants', icon: Building2, end: false },
  { to: '/invoices', key: 'nav.invoices', icon: FileText, end: false },
  { to: '/reports', key: 'nav.reports', icon: BarChart3, end: false },
] as const;

function headingFor(pathname: string, t: (k: string) => string) {
  if (pathname === '/') return { title: t('dash.title'), crumb: t('nav.dashboard'), create: true };
  if (pathname === '/tenants')
    return { title: t('tenants.title'), crumb: t('nav.tenants'), create: true };
  if (pathname === '/tenants/new')
    return { title: t('create.title'), crumb: t('nav.tenants'), create: false };
  if (pathname.startsWith('/tenants/'))
    return { title: t('detail.title'), crumb: t('nav.tenants'), create: false };
  if (pathname === '/invoices')
    return { title: t('invoices.title'), crumb: t('nav.invoices'), create: false };
  if (pathname.startsWith('/invoices/')) {
    return { title: t('invoices.document'), crumb: t('nav.invoices'), create: false };
  }
  if (pathname === '/reports')
    return { title: t('reports.title'), crumb: t('nav.reports'), create: false };
  return { title: t('app.title'), crumb: t('app.title'), create: true };
}

export function Shell() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const session = loadSession();
  const heading = headingFor(pathname, t);

  const toggleLang = () => {
    const next = i18n.language.startsWith('fa') ? 'en' : 'fa';
    void i18n.changeLanguage(next);
    localStorage.setItem('ta_lang', next);
    document.documentElement.lang = next;
    document.documentElement.dir = next === 'fa' ? 'rtl' : 'ltr';
  };

  return (
    <div className="flex h-svh flex-col overflow-hidden bg-paper print:h-auto print:overflow-visible md:flex-row">
      <aside className="no-print flex shrink-0 flex-col bg-ink-950 text-slate-200 md:h-full md:w-52">
        <Link to="/" className="flex items-center gap-2.5 px-4 py-4 no-underline">
          <span className="grid size-8 place-items-center rounded-lg bg-brand-500 text-white">
            <Building2 className="size-4" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-white">
              {t('app.title')}
            </span>
          </span>
        </Link>
        <nav className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-1 md:flex-col md:overflow-visible">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm no-underline ${
                  isActive
                    ? 'bg-white/10 font-medium text-white'
                    : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
                }`
              }
            >
              <item.icon className="size-4 shrink-0" />
              {t(item.key)}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="no-print shrink-0 border-b border-stone-200 bg-white">
          <div className="flex items-center justify-between gap-3 px-4 py-3 lg:px-5">
            <div className="min-w-0">
              <p className="text-[11px] font-medium text-slate-400">{heading.crumb}</p>
              <h1 className="truncate text-lg font-bold leading-tight text-ink-900">
                {heading.title}
              </h1>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {heading.create && (
                <Link
                  to="/tenants/new"
                  className="inline-flex items-center gap-1 rounded-lg bg-brand-500 px-3 py-1.5 text-sm font-semibold text-white no-underline"
                >
                  <Plus className="size-4" />
                  <span className="hidden sm:inline">{t('nav.create')}</span>
                </Link>
              )}
              {session?.tenantName && (
                <span className="hidden max-w-40 truncate rounded-full bg-stone-100 px-2.5 py-1 text-xs text-slate-600 sm:inline">
                  {session.tenantName}
                </span>
              )}
              <button
                type="button"
                onClick={toggleLang}
                className="rounded-lg border border-stone-200 px-2 py-1 text-xs"
              >
                {i18n.language.startsWith('fa') ? 'EN' : 'فا'}
              </button>
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-sm text-slate-600"
                onClick={() => {
                  clearSession();
                  navigate('/login');
                }}
              >
                <LogOut className="size-4" />
                <span className="hidden sm:inline">{t('nav.logout')}</span>
              </button>
            </div>
          </div>
        </header>
        <main className="flex min-h-0 flex-1 flex-col overflow-auto p-4 lg:p-5">
          <div className="flex min-h-full min-w-0 flex-1 flex-col">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
