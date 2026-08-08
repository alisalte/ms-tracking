import { Alert, type AlertColor } from '@mui/material';

interface FormAlertProps {
  /** Severity controls color + icon. */
  severity: AlertColor;
  /** Message to display. When empty, nothing renders. */
  message: string | null | undefined;
}

/**
 * Inline form-level alert with an ARIA live region (polite) so screen readers
 * announce validation/server errors (UI_UX_Design.md §0.8 + Appendix B:
 * "Forms: inline error + aria-describedby").
 */
export function FormAlert({ severity, message }: FormAlertProps) {
  if (!message) return null;
  return (
    <Alert severity={severity} sx={{ mb: 2 }} role="alert" aria-live="polite">
      {message}
    </Alert>
  );
}
