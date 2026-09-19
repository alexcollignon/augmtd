// ════════════════════════════════════════════════════════════════════════════════════════════════
// THE UNIVERSAL PREVIEW DOOR (docs/attention-plan.md, law D4: "Universal preview rides the compute
// sandbox's LibreOffice → PDF lane; the PDF player is the universal reviewer").
//
// GET /api/work/threads/[id]/artifacts/[artifactId]/preview → { url } | { available:false, reason }
//
// The ladder, honest at every rung:
//   1. NO FILE            → available:false, and the reason says so. Never a spinner.
//   2. THE BYTES ARE A PDF → sign them. The PDF player is already the universal reviewer.
//   3. docx · pptx · xlsx  → convert ONCE, in the locked room (soffice --headless --convert-to pdf,
//                            with the HOME=/tmp + -env:UserInstallation profile the sandbox needs —
//                            rc=77 otherwise, the lesson render_verify already carries), then store
//                            the PDF BESIDE ITS SOURCE and serve that from then on.
//   4. ANYTHING ELSE       → available:false with the type named. Never a broken embed.
//
// THE CACHE IS PER VERSION BY CONSTRUCTION: the preview path derives from the version's OWN storage
// path (`…/<artifactId>.docx` → `…/<artifactId>.preview.pdf`), and a revision is a new artifact id
// with a new path — so a new version can never be served its parent's picture. Uploads pin
// `cacheControl: '0'` (the Aug 11 CDN lesson: a revision reusing a path served the old bytes).
//
// CONVERSION IS ON OPEN, NEVER AT DELIVERY: a document nobody reviews costs nothing.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdmin } from '@supabase/supabase-js';
import { runComputeForOutputs } from '@/lib/tools/compute';
import type { DocumentArtifact } from '@/lib/types/inbox';

// LibreOffice on a cold profile is slow; the room's own cap is 120s and this waits on it.
export const maxDuration = 180;

const BUCKET = 'work-artifacts';
const OFFICE = new Set(['docx', 'doc', 'pptx', 'ppt', 'xlsx', 'xls']);

/** The conversion, as a script for the locked room. One input, one output, one printed fact. */
const CONVERT_SCRIPT = (name: string) => `
import glob, os, shutil, subprocess
src = "/job/inputs/${name}"
out_dir = "/tmp/pdf"
os.makedirs(out_dir, exist_ok=True)
# The sandbox filesystem is read-only outside /tmp and /job/out — LibreOffice needs a writable HOME
# and its own user profile, or it exits rc=77 without converting anything.
env = dict(os.environ, HOME="/tmp")
res = subprocess.run(
    ["soffice", "-env:UserInstallation=file:///tmp/lo_profile", "--headless",
     "--convert-to", "pdf", "--outdir", out_dir, src],
    capture_output=True, timeout=100, env=env,
)
made = glob.glob(os.path.join(out_dir, "*.pdf"))
if res.returncode != 0 or not made:
    raise SystemExit("convert failed rc=%s %s" % (res.returncode, res.stderr.decode(errors="replace")[:300]))
shutil.copy(made[0], "/job/out/preview.pdf")
try:
    from pypdf import PdfReader
    print("PAGES:", len(PdfReader("/job/out/preview.pdf").pages))
except Exception:
    pass
`;

function unavailable(reason: string) {
  // An honest dead end is a 200 with a reason — the player renders "preview unavailable · Download",
  // never a spinner that never ends and never an error the surface cannot explain.
  return NextResponse.json({ available: false, reason });
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; artifactId: string }> },
) {
  try {
    const { id: threadId, artifactId } = await params;
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const admin = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // OWNER-SCOPED, the content door's own ladder: the named thread first, then this USER'S other
    // threads (a worker task's artifact lives in its own thread). Never an unscoped lookup.
    const find = (rows: Array<{ id: string; artifacts: unknown }> | null) => {
      for (const t of rows ?? []) {
        const arts: DocumentArtifact[] = Array.isArray(t.artifacts) ? t.artifacts as DocumentArtifact[] : [];
        const a = arts.find((x) => x.id === artifactId);
        if (a) return a;
      }
      return null;
    };
    const { data: named } = await admin.from('work_threads')
      .select('id, artifacts').eq('id', threadId).eq('user_id', user.id).limit(1);
    let artifact = find(named);
    if (!artifact) {
      const { data: all } = await admin.from('work_threads')
        .select('id, artifacts').eq('user_id', user.id).not('artifacts', 'is', null)
        .order('created_at', { ascending: false }).limit(200);
      artifact = find(all);
    }
    if (!artifact) return NextResponse.json({ error: 'Artifact not found' }, { status: 404 });

    const path = String(artifact.storage_path ?? '');
    if (!path) return unavailable('there is no file behind this one');
    const ext = path.split('.').pop()?.toLowerCase() ?? '';

    // 2 · THE BYTES ARE ALREADY THE REVIEWER'S FORMAT.
    if (ext === 'pdf') {
      const { data } = await admin.storage.from(BUCKET).createSignedUrl(path, 600);
      if (!data?.signedUrl) return unavailable('the file could not be read from storage');
      return NextResponse.json({ url: data.signedUrl, converted: false });
    }
    if (!OFFICE.has(ext)) return unavailable(`.${ext || 'this'} files open outside the preview`);

    // 3 · THE CACHE — one conversion per version, keyed by the version's own path.
    const previewPath = `${path.replace(/\.[^.]+$/, '')}.preview.pdf`;
    const cached = await admin.storage.from(BUCKET).createSignedUrl(previewPath, 600);
    if (cached.data?.signedUrl) return NextResponse.json({ url: cached.data.signedUrl, converted: true, cached: true });

    if (!process.env.COMPUTE_SERVICE_URL || !process.env.COMPUTE_SECRET) {
      return unavailable('the document converter is not available on this deployment');
    }
    const { data: file } = await admin.storage.from(BUCKET).download(path);
    if (!file) return unavailable('the file could not be read from storage');
    const bytes = Buffer.from(await file.arrayBuffer());
    const inputName = `source.${ext}`;
    const run = await runComputeForOutputs({
      script: CONVERT_SCRIPT(inputName),
      extraFiles: [{ name: inputName, content_b64: bytes.toString('base64') }],
      timeout_s: 120,
    });
    const pdf = run?.ok ? run.outputs.find((o) => o.name.endsWith('.pdf')) : null;
    if (!pdf) {
      console.warn('[artifact/preview] conversion failed', { artifactId, ext, stderr: run?.stderr?.slice(-300) });
      return unavailable('this document could not be rendered for preview');
    }

    const { error: upErr } = await admin.storage.from(BUCKET)
      .upload(previewPath, pdf.bytes, { contentType: 'application/pdf', upsert: true, cacheControl: '0' });
    if (upErr) {
      // The conversion is real even when the cache write fails — serve it as a data URL rather
      // than making the reader pay for a storage problem twice.
      return NextResponse.json({
        url: `data:application/pdf;base64,${pdf.bytes.toString('base64')}`,
        converted: true, cached: false,
        ...(pagesOf(run?.stdout) ? { pages: pagesOf(run?.stdout) } : {}),
      });
    }
    const signed = await admin.storage.from(BUCKET).createSignedUrl(previewPath, 600);
    if (!signed.data?.signedUrl) return unavailable('the preview could not be served');
    return NextResponse.json({
      url: signed.data.signedUrl, converted: true, cached: false,
      ...(pagesOf(run?.stdout) ? { pages: pagesOf(run?.stdout) } : {}),
    });
  } catch (e) {
    console.error('[artifact/preview]', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** The page count is a FACT THE CONVERTER PRINTED, or nothing — never an estimate. */
function pagesOf(stdout?: string | null): number | null {
  const m = /PAGES:\s*(\d+)/.exec(String(stdout ?? ''));
  const n = m ? Number(m[1]) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}
