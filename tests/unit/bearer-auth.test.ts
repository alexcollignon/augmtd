import { describe, it, expect, afterEach } from 'vitest';
import { matchesSecret, hasBearer } from '@/lib/utils/bearer-auth';

function headerReq(auth: string | null) {
  return { headers: { get: (name: string) => (name.toLowerCase() === 'authorization' ? auth : null) } };
}

describe('matchesSecret / hasBearer — secrets fail closed', () => {
  const ENV_NAME = 'TEST_STABILIZATION_SECRET';
  const original = process.env[ENV_NAME];

  afterEach(() => {
    if (original === undefined) delete process.env[ENV_NAME];
    else process.env[ENV_NAME] = original;
  });

  it('an UNSET env secret never authenticates, even against the literal string "undefined"', () => {
    delete process.env[ENV_NAME];
    expect(matchesSecret('undefined', ENV_NAME)).toBe(false);
    expect(matchesSecret('', ENV_NAME)).toBe(false);
    expect(matchesSecret('anything', ENV_NAME)).toBe(false);
  });

  it('an EMPTY string env secret never authenticates', () => {
    process.env[ENV_NAME] = '';
    expect(matchesSecret('', ENV_NAME)).toBe(false);
  });

  it('a set secret matches only the exact value', () => {
    process.env[ENV_NAME] = 'topsecret123';
    expect(matchesSecret('topsecret123', ENV_NAME)).toBe(true);
    expect(matchesSecret('wrong', ENV_NAME)).toBe(false);
    expect(matchesSecret('topsecret124', ENV_NAME)).toBe(false);
  });

  it('a matching PREFIX is not a match (whole-value compare, not startsWith)', () => {
    process.env[ENV_NAME] = 'topsecret123';
    expect(matchesSecret('topsecret', ENV_NAME)).toBe(false);
  });

  it('null/undefined provided value never matches', () => {
    process.env[ENV_NAME] = 'topsecret123';
    expect(matchesSecret(null, ENV_NAME)).toBe(false);
    expect(matchesSecret(undefined, ENV_NAME)).toBe(false);
  });

  it('hasBearer requires the exact "Bearer " prefix', () => {
    process.env[ENV_NAME] = 'topsecret123';
    expect(hasBearer(headerReq('Bearer topsecret123'), ENV_NAME)).toBe(true);
    expect(hasBearer(headerReq('bearer topsecret123'), ENV_NAME)).toBe(false); // case-sensitive prefix
    expect(hasBearer(headerReq('topsecret123'), ENV_NAME)).toBe(false); // missing "Bearer "
  });

  it('hasBearer with no authorization header at all → false', () => {
    process.env[ENV_NAME] = 'topsecret123';
    expect(hasBearer(headerReq(null), ENV_NAME)).toBe(false);
  });

  it('hasBearer with the secret unset → false even if the header carries the right-looking value', () => {
    delete process.env[ENV_NAME];
    expect(hasBearer(headerReq('Bearer undefined'), ENV_NAME)).toBe(false);
  });

  it('hasBearer refuses a wrong bearer token', () => {
    process.env[ENV_NAME] = 'topsecret123';
    expect(hasBearer(headerReq('Bearer nope'), ENV_NAME)).toBe(false);
  });
});
