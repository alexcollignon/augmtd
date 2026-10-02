// W28 — THE SURFACES WHERE AI WRITES FOR THE USER, beside the Home chat. Adding one = a file under
// ./surfaces (cases + rubric + the call into its real producer, via makeSurface) + one line here.
import type { AnyAdapter } from '../eval/engine/types';
import { dmSurface } from './surfaces/dm';
import { roomSurface, roomCatchupSurface } from './surfaces/room';
import { stepSurface } from './surfaces/step';
import { handoffSurface } from './surfaces/handoff';
import { draftSurface, draftLanguageSurface } from './surfaces/draft';
import { MORE_SURFACES } from './surfaces/more';
import { SENT_SURFACES } from './surfaces/sent';
import { ASSIST_SURFACES } from './surfaces/assist';
import { DECOR_SURFACES } from './surfaces/decor';
import { NARRATE_SURFACES } from './surfaces/narrate';
import { BUILD_SURFACES } from './surfaces/build';
import { prepCommitmentSurface } from './surfaces/prep';

export const SURFACES: AnyAdapter[] = [dmSurface, roomSurface, stepSurface, handoffSurface, draftSurface, ...MORE_SURFACES, ...SENT_SURFACES, ...ASSIST_SURFACES, ...DECOR_SURFACES, ...NARRATE_SURFACES, ...BUILD_SURFACES, roomCatchupSurface, draftLanguageSurface, prepCommitmentSurface];

export function selectSurfaces(ids: string[] | null): AnyAdapter[] {
  if (!ids?.length) return SURFACES;
  return SURFACES.filter((a) => ids.some((s) => a.id === s || a.id.startsWith(`${s}.`) || a.id.endsWith(`.${s}`)));
}
