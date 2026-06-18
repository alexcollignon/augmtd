# UI kit — design tokens & primitives

Shared primitives in `components/ui/` enforce one consistent look across every page.
Import from `@/components/ui`. Prefer these over inline Tailwind for buttons, inputs,
badges, cards, tabs, and empty states.

```tsx
import { Button, IconButton, Badge, Input, Textarea, Select, Panel, Card, SegmentedControl, TabBar, EmptyState } from '@/components/ui';
```

## Tokens

**Accent** — indigo. Primary `indigo-600` (hover `indigo-700`). Active/selected surfaces
`bg-indigo-50` + `text-indigo-700` (icon `indigo-600`). Focus = `border-indigo-300` (no ring).
Semantic: `emerald` success, `red`/`rose` danger, `amber` warning. Neutral grays elsewhere.
Do **not** use `bg-primary-*` — use `indigo-*`.

**Radius (soft)** — controls/inputs/chips `rounded-lg` · cards `rounded-xl` · panels & modals
`rounded-2xl` · pills/avatars-in-pill `rounded-full`. Avoid `rounded-md` / bare `rounded`.

**Font scale** — collapse to these:
| token | use |
|---|---|
| `text-[11px]` | labels, badges, meta, uppercase section labels (`font-semibold uppercase tracking-wider text-neutral-400`) |
| `text-[12px]` | secondary controls, small buttons |
| `text-[13px]` | body, primary controls (buttons, inputs) |
| `text-[15px]` | card / sub-section titles (`font-semibold`) |
| `text-[18px]` | panel / section header (`font-semibold`) |
| `text-[24px]` | page title (`font-semibold tracking-tight`) |

**Weights** — `font-medium` for controls/labels, `font-semibold` for titles.

## Components

- **Button** — `variant`: primary | secondary | soft | ghost | danger · `size`: sm | md.
- **IconButton** — `tone`: default | danger · `size`: sm (p-1) | md (p-1.5).
- **Badge** — `tone`: neutral | indigo | emerald | amber | red | blue.
- **Input / Textarea / Select** — soft border, indigo focus border.
- **Panel** — column/surface wrapper (`rounded-2xl bg-white shadow-sm`).
- **Card** — content card (`rounded-xl border`); `interactive` adds hover.
- **SegmentedControl** — view switcher (neutral track, white active). For toggling whole views.
- **TabBar** — in-panel section tabs (underline style). For switching content within a panel.
- **EmptyState** — centered icon + title + optional description/action; `bordered` for in-section.
