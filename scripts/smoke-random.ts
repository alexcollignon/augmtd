// READ-ONLY random smoke: pull random pending email items ACROSS ALL USERS, recompute the understanding
// LIVE in-memory (no DB writes), and show how each would route. Proves the classifier is agnostic — it
// has never seen these items' verdicts pre-tuned. Nothing is written back.
import { config } from 'dotenv'; config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';
import { computeUnderstanding } from '../lib/ai/email-processor';
import { coerceUnderstanding } from '../lib/inbox/item-understanding';
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

function isAuto(fe:string|null,fn:string|null,su:string|null){const e=(fe||'').toLowerCase();const lp=e.split('@')[0]||'';const ap=['no-reply','noreply','no_reply','donotreply','do-not-reply','do_not_reply','notifications','notification','notify','mailer','mailer-daemon','bounce','bounces','postmaster','automated','auto-confirm','alerts','alert','billing','invoices','receipts','support+','updates','newsletter','news','digest'];if(ap.some(p=>lp.includes(p)))return true;if(/(^|[.@])(no-?reply|donotreply|notifications?|mailer|bounce|postmaster)([.@])/.test(e))return true;const t=`${(fn||'').toLowerCase()} ${(su||'').toLowerCase()}`;const pp=['payment failed','account suspended','verify your','security alert'];if(pp.some(p=>t.includes(p)))return true;return false;}
const feOf=(sd:any)=>{const r=String(sd.from_address||sd.from||'').toLowerCase();return r.match(/[^\s<>"]+@[^\s<>"]+/)?.[0]||(r.includes('@')?r:null);};
const isBulk=(u:any,sd:any)=>{if(u?.bulk===true)return true;return !!sd.has_unsubscribe||isAuto(feOf(sd),sd.from_name||null,sd.subject||null);};
function route(u:any,sd:any):string{
  if(!u) return 'no-understanding→fallback';
  if(u.relevance==='reply') return 'WHAT NEEDS YOU';
  if(u.relevance==='action') return 'WORTH ACTING ON';
  return isBulk(u,sd) ? 'newsletters' : 'FOR YOUR AWARENESS';
}
const addrCache=new Map<string,string[]>();
async function addrs(uid:string):Promise<string[]>{
  if(addrCache.has(uid))return addrCache.get(uid)!;
  const set=new Set<string>();
  const {data:p}=await sb.from('profiles').select('email').eq('id',uid).maybeSingle();
  if(p?.email)set.add(String(p.email).toLowerCase());
  const {data:c}=await sb.from('connections').select('metadata,provider_account_id').eq('user_id',uid);
  for(const x of (c??[]) as any[]){const e=(x.metadata?.email||x.provider_account_id||'').toLowerCase();if(e)set.add(e);}
  const a=[...set];addrCache.set(uid,a);return a;
}
(async()=>{
  // Fetch a broad pool across all users, then shuffle in JS for a random spread.
  const {data}=await sb.from('inbox_items').select('id,user_id,work_title,work_state,source_data').eq('source','email').eq('status','pending').limit(4000);
  const pool=(data??[]) as any[];
  for(let i=pool.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[pool[i],pool[j]]=[pool[j],pool[i]];}
  const users=new Set(pool.map(p=>p.user_id));
  console.log(`pool=${pool.length} items across ${users.size} users; recomputing 24 random items LIVE (no writes)\n`);
  const sample=pool.filter(it=>it.source_data?.from||it.source_data?.from_address).slice(0,24);
  let agree=0;
  await Promise.all(sample.map(async(it)=>{
    const sd=it.source_data??{};
    const stored=coerceUnderstanding(sd.understanding);
    const my=await addrs(it.user_id).catch(()=>[]);
    let fresh:any=null;
    try{fresh=await computeUnderstanding({id:it.id,user_id:it.user_id,message_id:sd.message_id||'',from_address:sd.from||sd.from_address||'',from_name:sd.from_name||'',subject:sd.subject||'',body:sd.body||'',received_at:sd.received_at||new Date().toISOString(),recipient_position:sd.is_cc_only?'cc':'to',recipient_email:my[0],to_addresses:sd.to||[],cc_addresses:sd.cc||[],user_addresses:my,user_name:undefined} as any, sb);}catch(e){/*non-fatal*/}
    const r=route(fresh,sd);
    const v=fresh?`${fresh.role}/${fresh.relevance}/bulk=${fresh.bulk}/${fresh.language}`:'(recompute failed)';
    console.log(`u=${String(it.user_id).slice(0,8)} | ${String(sd.from_name||sd.from||'?').slice(0,22).padEnd(22)} | ${String(it.work_title||'').slice(0,40).padEnd(40)}`);
    console.log(`     fresh: ${v}\n     → ${r}`);
  }));
})().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
