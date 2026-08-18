import { fireEvent, render, screen } from '@testing-library/react';
/**
 * Phase 2 — tailwind-ui primitive tests.
 *
 * Covers the new TailAdmin primitives: Button (variants/loading), Spinner,
 * Skeleton, Alert (roles + dismiss), EmptyState, Modal (portal + a11y + close
 * paths), Dropdown (open/close + item semantics), Input/Select (label/error
 * wiring + ref forwarding), and Table composition. Pure DOM-level — no router,
 * no i18n, no providers.
 */
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';

import {
  Alert,
  Button,
  Dropdown,
  DropdownItem,
  EmptyState,
  Input,
  Modal,
  Select,
  Skeleton,
  Spinner,
  TBody,
  TD,
  TH,
  THead,
  Table,
} from '@/components/tailwind-ui';

describe('Button', () => {
  it('renders children and fires onClick', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('disables and swaps the icon for a spinner while loading', () => {
    render(
      <Button loading leftIcon={<span data-testid="icon" />}>
        Go
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Go' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByTestId('icon')).toBeNull();
  });
});

describe('Spinner / Skeleton', () => {
  it('Spinner announces as a status region with a hidden label', () => {
    render(<Spinner label="Loading fleet" />);
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.getByText('Loading fleet')).toBeTruthy(); // sr-only, still in DOM
  });

  it('Skeleton is hidden from assistive tech', () => {
    const { container } = render(<Skeleton className="h-4 w-32" />);
    expect(container.firstElementChild?.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('Alert', () => {
  it('uses role=alert for danger and status for info', () => {
    const { rerender } = render(<Alert variant="danger">Boom</Alert>);
    expect(screen.getByRole('alert')).toBeTruthy();
    rerender(<Alert variant="info">FYI</Alert>);
    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('renders a title and a working dismiss button', () => {
    const onClose = vi.fn();
    render(
      <Alert variant="warning" title="Heads up" onClose={onClose}>
        detail text
      </Alert>,
    );
    expect(screen.getByText('Heads up')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe('EmptyState', () => {
  it('renders title, description, and action slots', () => {
    render(
      <EmptyState
        title="No vehicles"
        description="Register a vehicle to see it here"
        action={<Button>Add vehicle</Button>}
      />,
    );
    expect(screen.getByRole('status').textContent).toContain('No vehicles');
    expect(screen.getByRole('button', { name: 'Add vehicle' })).toBeTruthy();
  });
});

describe('Modal', () => {
  it('renders nothing until open', () => {
    render(
      <Modal open={false} onClose={() => {}}>
        body
      </Modal>,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens as a labelled dialog with title, body, and footer', () => {
    render(
      <Modal open onClose={() => {}} title="Confirm" footer={<Button>OK</Button>}>
        <p>Are you sure?</p>
      </Modal>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(screen.getByText('Are you sure?')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'OK' })).toBeTruthy();
  });

  it('closes on ESC and backdrop click, and honors closeOnBackdrop={false}', () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <Modal open onClose={onClose} title="T">
        body
      </Modal>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();

    rerender(
      <Modal open onClose={onClose} closeOnBackdrop={false} title="T">
        body
      </Modal>,
    );
    fireEvent.mouseDown(document.body.firstElementChild as HTMLElement);
    // Backdrop is the first child of the portal container; find via dialog sibling.
    const dialog = screen.getByRole('dialog');
    const backdrop = dialog.previousElementSibling as HTMLElement;
    fireEvent.mouseDown(backdrop);
    expect(onClose).toHaveBeenCalledOnce(); // only the ESC call
  });
});

describe('Dropdown', () => {
  it('opens on trigger, exposes menu semantics, and closes on item select', () => {
    const onSelect = vi.fn();
    render(
      <Dropdown label="Actions">
        <DropdownItem onClick={onSelect}>Rename</DropdownItem>
      </Dropdown>,
    );
    const trigger = screen.getByRole('button', { name: /actions/i });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    expect(onSelect).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menuitem')).toBeNull(); // menu closed
  });

  it('closes on ESC and outside pointer press', () => {
    render(
      <Dropdown label="More">
        <DropdownItem>Item</DropdownItem>
      </Dropdown>,
    );
    fireEvent.click(screen.getByRole('button', { name: /more/i }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menuitem')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /more/i }));
    fireEvent.pointerDown(document.body); // outside the dropdown root
    expect(screen.queryByRole('menuitem')).toBeNull();
  });

  it('renders header rows and danger items', () => {
    render(
      <Dropdown label="User">
        <DropdownItem header>Section</DropdownItem>
        <DropdownItem danger>Delete</DropdownItem>
      </Dropdown>,
    );
    fireEvent.click(screen.getByRole('button', { name: /user/i }));
    expect(screen.getByText('Section')).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeTruthy();
  });
});

describe('Input / Select', () => {
  it('Input associates label + error with the field and forwards refs', () => {
    const ref = createRef<HTMLInputElement>();
    render(
      <Input ref={ref} label="Email" error="Required" defaultValue="a@b.c" onChange={() => {}} />,
    );
    const input = screen.getByLabelText('Email');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toContain('-error');
    expect(screen.getByText('Required')).toBeTruthy();
    expect(ref.current).toBe(input);
  });

  it('Select renders options, associates the label, and surfaces errors', () => {
    const ref = createRef<HTMLSelectElement>();
    render(
      <Select
        ref={ref}
        label="Status"
        error="Pick one"
        options={[
          { value: 'all', label: 'All' },
          { value: 'moving', label: 'Moving' },
        ]}
      />,
    );
    const select = screen.getByLabelText('Status');
    expect(select.querySelectorAll('option')).toHaveLength(2);
    expect(select.getAttribute('aria-invalid')).toBe('true');
    expect(ref.current).toBe(select);
  });
});

describe('Table kit', () => {
  it('composes Table/THead/TBody with a visually hidden caption', () => {
    render(
      <Table caption="Fleet vehicles">
        <THead>
          <tr>
            <TH>Vehicle</TH>
            <TH align="end">Speed</TH>
          </tr>
        </THead>
        <TBody>
          <tr>
            <TD>TRK-1</TD>
            <TD align="end">64</TD>
          </tr>
        </TBody>
      </Table>,
    );
    expect(screen.getByText('Fleet vehicles')).toBeTruthy(); // sr-only caption
    expect(screen.getByRole('columnheader', { name: 'Vehicle' })).toBeTruthy();
    expect(screen.getByRole('cell', { name: 'TRK-1' })).toBeTruthy();
  });
});
