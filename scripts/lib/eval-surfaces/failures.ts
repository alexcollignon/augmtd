// ════════════════════════════════════════════════════════════════════════════════════════════════
// W29 · A FAILED MODEL CALL IS AN ERROR, NEVER AN ANSWER — and THE EU QUOTA STOP. Every model call runs
// through the meter's call gate; this wrapper records each failure on the unit's meter bucket (so the
// adapter can turn a swallowed failure into a visible run error — never a silent "unstated" output that
// gets scored), and on the FIRST Bedrock daily-token throttle it stops every later EU (Bedrock) call in
// the process — EU units then fail as UNRUN (never scored). The EU account is production's shared AWS
// account: one quota hit must not become a burn.
// ════════════════════════════════════════════════════════════════════════════════════════════════
import { currentBucket } from '../eval/meter';

export const quota = { euStopped: false, reason: '' };

/** A Bedrock model id (the EU tier's endpoints). Pure. */
export const isBedrockModel = (model: string) => /^(eu|us|apac|global)\.|^(anthropic|amazon|cohere|meta|mistral)\./i.test(String(model ?? ''));

/** The daily-token throttle (the one that means "stop", unlike a per-minute burst). Pure. */
export const isDailyQuota = (msg: string) => /ThrottlingException|Too many tokens per day|tokens per day|daily (token )?quota/i.test(msg) && /day|daily/i.test(msg);

type Gate = <T>(model: string, fn: () => Promise<T>) => Promise<T>;

export function failureGate(inner: Gate): Gate {
  return async <T>(model: string, fn: () => Promise<T>): Promise<T> => {
    if (quota.euStopped && isBedrockModel(model)) throw new Error(`EU QUOTA STOP — unrun (${quota.reason})`);
    try { return await inner(model, fn); }
    catch (e) {
      const msg = `${(e as { name?: string })?.name ?? 'Error'}: ${(e as Error)?.message ?? String(e)}`;
      const b = currentBucket() as { failures?: string[] };
      (b.failures ??= []).push(`${model}: ${msg.slice(0, 200)}`);
      if (isBedrockModel(model) && isDailyQuota(msg) && !quota.euStopped) { quota.euStopped = true; quota.reason = msg.slice(0, 160); console.error(`\n⛔ EU QUOTA STOP: ${quota.reason} — every later EU unit is left UNRUN.`); }
      throw e;
    }
  };
}

/** The failures recorded on the running unit's bucket. */
export const unitFailures = (): string[] => ((currentBucket() as { failures?: string[] }).failures ?? []);
