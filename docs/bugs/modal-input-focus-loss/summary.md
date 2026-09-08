# Modal/Drawer input loses focus after one character

Typing in any field inside a Modal or Drawer (create user, assets, geofences, rules, …) accepted one character then moved focus to the dialog panel.

## Status

Fixed.

## Root cause

`Modal` and `Drawer` ran `panelRef.current.focus()` in a `useEffect` that listed `onClose` as a dependency. Almost every caller passes an inline `onClose={() => setOpen(false)}`, so each keystroke recreated `onClose`, re-ran the effect, and stole focus from the input.

## Fix

Read `onClose` from a ref and run the open-chrome effect only when `open` changes (`useDialogChrome`).
