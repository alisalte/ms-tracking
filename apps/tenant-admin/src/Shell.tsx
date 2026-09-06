import { Building2, LogOut, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link, NavLink, Outlet, useNavigate } from 'react-router';

import { i18n } from '@/i18n';
import { clearSession, loadSession } from '@/lib/session';

export function Shell() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const session = loadSession();

  const toggleLang = () => {
    const next = i18n.language.startsWith('fa') ? 'en' : 'fa';
    void i18n.changeLanguage(next);
    localStorage.setItem('ta_lang', next);
    document.documentElement.lang = next;
    document.documentElement.dir = next === 'fa' ? 'rtl' : 'ltr';
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <Link
            to="/"
            className="flex items-center gap-2 font-semibold text-slate-900 no-underline"
          >
            <Building2 className="size-5 text-brand-500" />
            {t('app.title')}
          </Link>
          <nav className="flex items-center gap-2 text-sm">
            <NavLink
              to="/"
              end
              className={({ isActive }) =>
                `rounded-lg px-3 py-1.5 no-underline ${isActive ? 'bg-brand-50 text-brand-600' : 'text-slate-600'}`
              }
            >
              {t('nav.tenants')}
            </NavLink>
            <NavLink
              to="/new"
              className={({ isActive }) =>
                `inline-flex items-center gap-1 rounded-lg px-3 py-1.5 no-underline ${isActive ? 'bg-brand-50 text-brand-600' : 'text-slate-600'}`
              }
            >
              <Plus className="size-4" />
              {t('nav.create')}
            </NavLink>
            <button
              type="button"
              onClick={toggleLang}
              className="rounded-lg border border-slate-200 px-2 py-1 text-xs"
            >
              {i18n.language.startsWith('fa') ? 'EN' : 'فا'}
            </button>
            <span className="hidden text-xs text-slate-400 sm:inline">{session?.tenantName}</span>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-slate-600"
              onClick={() => {
                clearSession();
                navigate('/login');
              }}
            >
              <LogOut className="size-4" />
              {t('nav.logout')}
            </button>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
