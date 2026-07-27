// THE ROOM GATES (P7c-c2/c3) — one work surface, two doors.
//   STRUCTURAL — entity-detail + EntityAsk + the entity ask route are GONE; the room exists; BOTH
//     doors read THE ONE room-view builder; the steer/ingest routes accept the entity door; the
//     rail keys its chat by entity id (one conversation through both doors).
//   LIVE (cross-user) — buildRoomView returns the judged entity + curated siblings for a real deal;
//     the entity door's converse answers grounded (the room chat works).
import { config } from 'dotenv'; config({ path: '.env.local' });
import { existsSync, readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';
import { buildRoomView } from '../lib/entities/room-view';
import { converse } from '../lib/converse';

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const USERS = [
  { uid: '08fe4449-e5eb-431d-9156-02e9324e5903', label: 'user A' },
  { uid: 'c723c2f2-e069-4ab8-980e-ac3585028fec', label: 'user B' },
];
const out: Array<[string, boolean, string]> = [];
const check = (n: string, ok: boolean, d = '') => out.push([n, ok, d]);
const src = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : '');

(async () => {
  // ── STRUCTURAL ──
  check('c3: entity-detail.tsx is deleted', !existsSync('components/entities/entity-detail.tsx'));
  check('c3: the entity ask route is deleted (EntityAsk died into the one chat)', !existsSync('app/api/entities/[id]/ask/route.ts'));
  check('c2: the room component exists', existsSync('components/entities/entity-room.tsx'));
  check('c2: BOTH doors read THE ONE room-view builder',
    src('app/api/items/view/route.ts').includes("entities/room-view") &&
    src('app/api/entities/[id]/room/route.ts').includes("entities/room-view"));
  check('c2: the room renders THE ONE rail in entity scope', /ItemRail\s+kind="entity"/.test(src('components/entities/entity-room.tsx')));
  check('c2: steer accepts the entity door', src('app/api/items/steer/route.ts').includes("'entity'"));
  check('c2: ingest accepts the entity door', src('app/api/items/ingest/route.ts').includes("'entity'"));
  check('c2: the rail chat keys by ENTITY (one conversation, both doors; loose falls back to <kind>:<id>)',
    src('components/home/item-rail.tsx').includes('const roomKey = ent?.id ??'));
  check('c2: Projects + Timeline route into the room',
    src('components/entities/portfolio-view.tsx').includes('EntityRoom') &&
    src('components/timeline/timeline-gantt.tsx').includes('EntityRoom'));

  // ── LIVE (cross-user) ──
  for (const { uid, label } of USERS) {
    const { data: link } = await sb.from('entity_links').select('entity_id, item_id')
      .eq('user_id', uid).eq('item_kind', 'inbox_item').not('entity_id', 'is', null)
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (!link) { check(`${label} · room view (vacuous — no linked items)`, true); continue; }
    const eid = link.entity_id as string;

    // The PROJECT door — no current item; entity + siblings populate.
    const room = await buildRoomView(sb, uid, eid, null);
    check(`${label} · project door: judged entity + siblings`, !!room.entity?.name,
      room.entity ? `${room.entity.name.slice(0, 24)} · thr=${room.siblings.threads.length} mtg=${room.siblings.meetings.length} com=${room.siblings.commitments.length}` : 'no entity');

    // The ITEM door — same entity, current thread marked.
    const item = await buildRoomView(sb, uid, eid, link.item_id as string);
    check(`${label} · item door: same entity, current thread marked`,
      item.entity?.id === room.entity?.id &&
      (item.siblings.threads.length === 0 || item.siblings.threads.some((t) => t.current) || !item.siblings.threads.some((t) => t.id === link.item_id)),
      `threads=${item.siblings.threads.length}`);

    // The room CHAT — the entity door's converse answers grounded (what the room composer posts).
    const turn = await converse(sb, uid, { kind: 'entity', entityId: eid }, 'Where does this stand right now?');
    check(`${label} · room chat answers grounded`, turn.say.length > 20 && !/couldn't|can't do/i.test(turn.say),
      `"${turn.say.slice(0, 80)}"`);
  }

  console.log('\n════ THE ROOM GATES (P7c-c2/c3) ════');
  let pass = 0;
  for (const [n, ok, d] of out) { if (ok) pass++; console.log(` ${ok ? '✓' : '✗'} ${n}${d ? `  → ${d}` : ''}`); }
  console.log(`\n${pass}/${out.length} pass`);
  process.exit(pass === out.length ? 0 : 1);
})();
