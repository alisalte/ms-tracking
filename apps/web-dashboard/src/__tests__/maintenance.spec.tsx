import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it } from 'vitest';

import { i18n } from '@/i18n';
import { MaintenancePage } from '@/pages/MaintenancePage';

describe('MaintenancePage partners', () => {
  it('links Pargar and Alka logos to their CMMS sites', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <MaintenancePage />
      </I18nextProvider>,
    );
    const pargar = screen.getByTestId('maintenance-partner-pargar');
    const alka = screen.getByTestId('maintenance-partner-alka');
    expect(pargar).toHaveAttribute('href', 'https://pargarnet.com/');
    expect(pargar).toHaveAttribute('target', '_blank');
    expect(alka).toHaveAttribute('href', 'https://pmem.ir/');
    expect(alka).toHaveAttribute('target', '_blank');
  });
});
