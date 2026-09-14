import fs from 'fs';
import path from 'path';
import * as ts from 'typescript';

// Phase 5, Step 5 Part 3c CORS fix (docs/phase-5-plan.md section 6.8). Exercises the REAL
// ai-insights/index.ts source -- both the pure `buildCorsHeaders` helper and the full
// `Deno.serve` handler -- rather than a reimplementation of the matching/wiring logic, matching
// the same discipline scripts/edge-function-wiring.test.ts already applies to generateInsight/
// processRecipient. send-coaching-push/index.ts is untouched by this fix (no CORS handling at
// all -- see the dedicated test below) and is deliberately not exercised here.

const ROOT = path.resolve(__dirname, '..');
const AI_INSIGHTS_PATH = path.join(ROOT, 'supabase', 'functions', 'ai-insights', 'index.ts');
const SEND_COACHING_PUSH_PATH = path.join(ROOT, 'supabase', 'functions', 'send-coaching-push', 'index.ts');

type EnvMap = Record<string, string | undefined>;

/** Extracts everything above `Deno.serve(` and returns the real `buildCorsHeaders`, executed
 * against a `Deno` stub whose `env.get` reads from `env`. Mirrors
 * scripts/edge-function-wiring.test.ts's `loadRealExports`, parameterised on env since
 * `ALLOWED_ORIGIN_DEV`/`ALLOWED_ORIGIN_PROD` are read once at module load, matching real Deno
 * cold-start behaviour -- so each scenario re-executes the module fresh with its own env. */
function loadRealBuildCorsHeaders(env: EnvMap = {}): (origin: string | null) => Record<string, string> {
  const source = fs.readFileSync(AI_INSIGHTS_PATH, 'utf8');
  const withoutImports = source.replace(/^import .*$/gm, '');
  const denoServeIndex = withoutImports.indexOf('Deno.serve(');
  if (denoServeIndex === -1) throw new Error('Could not find Deno.serve(...) in ai-insights/index.ts -- has the file been restructured?');
  const executable = withoutImports.slice(0, denoServeIndex);

  const { outputText } = ts.transpileModule(executable, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  const moduleObj = { exports: {} as Record<string, unknown> };
  const denoStub = { env: { get: (key: string) => env[key] } };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const runner = new Function('module', 'exports', 'Deno', `${outputText}\nmodule.exports.buildCorsHeaders = buildCorsHeaders;`);
  runner(moduleObj, moduleObj.exports, denoStub);
  return (moduleObj.exports as { buildCorsHeaders: (origin: string | null) => Record<string, string> }).buildCorsHeaders;
}

/** Extracts and executes the WHOLE real ai-insights/index.ts source, including its `Deno.serve`
 * registration, capturing the real handler function via a `Deno.serve` stub instead of a
 * reimplemented request/response cycle. `createClient` and `Anthropic` (both bare identifiers
 * after import-stripping, since neither generateInsight-level test needs them but the full
 * handler constructs both directly) are injected the same way the existing harness injects
 * `Deno`. */
function loadRealHandler(
  env: EnvMap,
  createClientStub: (...args: unknown[]) => unknown,
  anthropicStub: new (...args: unknown[]) => unknown,
): (req: Request) => Promise<Response> {
  const source = fs.readFileSync(AI_INSIGHTS_PATH, 'utf8');
  const withoutImports = source.replace(/^import .*$/gm, '');
  const { outputText } = ts.transpileModule(withoutImports, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  let capturedHandler: ((req: Request) => Promise<Response>) | undefined;
  const denoStub = {
    env: { get: (key: string) => env[key] },
    serve: (fn: (req: Request) => Promise<Response>) => {
      capturedHandler = fn;
    },
  };
  const moduleObj = { exports: {} as Record<string, unknown> };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const runner = new Function('module', 'exports', 'Deno', 'createClient', 'Anthropic', outputText);
  runner(moduleObj, moduleObj.exports, denoStub, createClientStub, anthropicStub);
  if (!capturedHandler) throw new Error('Deno.serve was never called -- has the handler registration changed?');
  return capturedHandler;
}

/** Zero habits -- the documented B6 mechanism (CLAUDE.md's "Deployment stamp" section): an
 * authenticated user with no habits rows reaches the canned-response branch before any Anthropic
 * call or ai_insights write, so this is the cheapest real path through generateInsight for
 * exercising the handler end-to-end without a fuller fixture. */
function makeSupabaseStub(userId: string | null = 'user-1') {
  return () => ({
    auth: {
      getUser: async () =>
        userId ? { data: { user: { id: userId } }, error: null } : { data: { user: null }, error: new Error('no session') },
    },
    from: (table: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const builder: any = {
        select: () => builder,
        eq: () => builder,
        is: () => builder,
        order: () => builder,
        gt: () => builder,
        limit: () => builder,
        maybeSingle: () => Promise.resolve({ data: null }),
        insert: () => Promise.resolve({ error: null }),
        then: (resolve: (v: { data: unknown }) => void) => resolve({ data: table === 'habits' ? [] : [] }),
      };
      return builder;
    },
  });
}

function makeAnthropicStub(): new (...args: unknown[]) => unknown {
  return function AnthropicStub() {
    return { messages: { create: async () => ({ content: [{ type: 'text', text: 'unused on the zero-habits canned path' }] }) } };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function postRequest(headers: Record<string, string> = {}): Request {
  return new Request('https://example.supabase.co/functions/v1/ai-insights', {
    method: 'POST',
    headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ kind: 'nudge' }),
  });
}

function optionsRequest(origin: string | undefined): Request {
  const headers: Record<string, string> = {
    'Access-Control-Request-Method': 'POST',
    'Access-Control-Request-Headers': 'authorization, apikey, content-type, x-client-info',
  };
  if (origin !== undefined) headers['Origin'] = origin;
  return new Request('https://example.supabase.co/functions/v1/ai-insights', { method: 'OPTIONS', headers });
}

const DEV = 'http://localhost:8081';
const PROD = 'https://real-app.example.com';
const UNKNOWN = 'https://evil.example.com';

describe('buildCorsHeaders (real ai-insights/index.ts source) -- exact-match allow-list', () => {
  it('configured dev origin receives itself back', () => {
    const buildCorsHeaders = loadRealBuildCorsHeaders({ ALLOWED_ORIGIN_DEV: DEV });
    expect(buildCorsHeaders(DEV)['Access-Control-Allow-Origin']).toBe(DEV);
  });

  it('configured prod origin receives itself back', () => {
    const buildCorsHeaders = loadRealBuildCorsHeaders({ ALLOWED_ORIGIN_PROD: PROD });
    expect(buildCorsHeaders(PROD)['Access-Control-Allow-Origin']).toBe(PROD);
  });

  it('dev and prod configured together: each origin gets only its own exact match, never the other\'s', () => {
    const buildCorsHeaders = loadRealBuildCorsHeaders({ ALLOWED_ORIGIN_DEV: DEV, ALLOWED_ORIGIN_PROD: PROD });
    expect(buildCorsHeaders(DEV)['Access-Control-Allow-Origin']).toBe(DEV);
    expect(buildCorsHeaders(PROD)['Access-Control-Allow-Origin']).toBe(PROD);
  });

  it('unset ALLOWED_ORIGIN_DEV does not permit localhost', () => {
    const buildCorsHeaders = loadRealBuildCorsHeaders({ ALLOWED_ORIGIN_PROD: PROD }); // dev deliberately absent
    expect(buildCorsHeaders(DEV)).not.toHaveProperty('Access-Control-Allow-Origin');
  });

  it('unset ALLOWED_ORIGIN_PROD does not permit an arbitrary production origin', () => {
    const buildCorsHeaders = loadRealBuildCorsHeaders({ ALLOWED_ORIGIN_DEV: DEV }); // prod deliberately absent
    expect(buildCorsHeaders(PROD)).not.toHaveProperty('Access-Control-Allow-Origin');
  });

  it('both unset: no origin is permitted at all, including the exact dev literal', () => {
    const buildCorsHeaders = loadRealBuildCorsHeaders({});
    expect(buildCorsHeaders(DEV)).not.toHaveProperty('Access-Control-Allow-Origin');
    expect(buildCorsHeaders(PROD)).not.toHaveProperty('Access-Control-Allow-Origin');
  });

  it('unknown/malicious origin receives no Access-Control-Allow-Origin, even with both configured', () => {
    const buildCorsHeaders = loadRealBuildCorsHeaders({ ALLOWED_ORIGIN_DEV: DEV, ALLOWED_ORIGIN_PROD: PROD });
    expect(buildCorsHeaders(UNKNOWN)).not.toHaveProperty('Access-Control-Allow-Origin');
  });

  it('no substring/prefix/suffix/subdomain matching: a superstring or subdomain of an allowed origin is rejected', () => {
    const buildCorsHeaders = loadRealBuildCorsHeaders({ ALLOWED_ORIGIN_PROD: PROD });
    expect(buildCorsHeaders(`${PROD}.evil.com`)).not.toHaveProperty('Access-Control-Allow-Origin');
    expect(buildCorsHeaders('https://evil.real-app.example.com')).not.toHaveProperty('Access-Control-Allow-Origin');
    expect(buildCorsHeaders(PROD.replace('https://', 'https://sub.'))).not.toHaveProperty('Access-Control-Allow-Origin');
  });

  it('no wildcard is ever returned, across every configuration', () => {
    const scenarios: EnvMap[] = [{}, { ALLOWED_ORIGIN_DEV: DEV }, { ALLOWED_ORIGIN_PROD: PROD }, { ALLOWED_ORIGIN_DEV: DEV, ALLOWED_ORIGIN_PROD: PROD }];
    const origins = [DEV, PROD, UNKNOWN, null];
    for (const env of scenarios) {
      const buildCorsHeaders = loadRealBuildCorsHeaders(env);
      for (const origin of origins) {
        const headers = buildCorsHeaders(origin);
        expect(Object.values(headers)).not.toContain('*');
      }
    }
  });

  it('no Origin header (null): no Access-Control-Allow-Origin, but Allow-Headers/Vary are still present', () => {
    const buildCorsHeaders = loadRealBuildCorsHeaders({ ALLOWED_ORIGIN_DEV: DEV, ALLOWED_ORIGIN_PROD: PROD });
    const headers = buildCorsHeaders(null);
    expect(headers).not.toHaveProperty('Access-Control-Allow-Origin');
    expect(headers['Access-Control-Allow-Headers']).toBe('authorization, x-client-info, apikey, content-type');
    expect(headers['Vary']).toBe('Origin');
  });

  it('the existing allowed-request-header set is unchanged', () => {
    const buildCorsHeaders = loadRealBuildCorsHeaders({ ALLOWED_ORIGIN_DEV: DEV });
    expect(buildCorsHeaders(DEV)['Access-Control-Allow-Headers']).toBe('authorization, x-client-info, apikey, content-type');
  });
});

describe('ai-insights real Deno.serve handler -- CORS wiring end to end', () => {
  it('OPTIONS with the configured dev origin returns 200 "ok" with the matched Allow-Origin', async () => {
    const handler = loadRealHandler({ ALLOWED_ORIGIN_DEV: DEV }, makeSupabaseStub(), makeAnthropicStub());
    const response = await handler(optionsRequest(DEV));

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('ok');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(DEV);
    expect(response.headers.get('Access-Control-Allow-Headers')).toBe('authorization, x-client-info, apikey, content-type');
    expect(response.headers.get('Vary')).toBe('Origin');
  });

  it('OPTIONS with an unmatched origin still returns 200 "ok" (no server-side rejection) but omits Allow-Origin', async () => {
    const handler = loadRealHandler({ ALLOWED_ORIGIN_DEV: DEV }, makeSupabaseStub(), makeAnthropicStub());
    const response = await handler(optionsRequest(UNKNOWN));

    expect(response.status).toBe(200); // the server never refuses OPTIONS; the browser enforces CORS from the headers
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('authenticated POST with a matching allowed origin: body/status match the pre-fix canned-response shape exactly', async () => {
    const handler = loadRealHandler({ ALLOWED_ORIGIN_DEV: DEV }, makeSupabaseStub(), makeAnthropicStub());
    const response = await handler(postRequest({ Origin: DEV }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.content).toBe("Add a habit and log it a few times to get your first personalized tip! \u{1F331}");
    expect(body.kind).toBe('nudge');
    expect(body.stamp).toBeDefined();
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(DEV);
  });

  it('authenticated POST with an unknown origin: request still succeeds normally (server never gates on Origin), only the header differs', async () => {
    const handler = loadRealHandler({ ALLOWED_ORIGIN_DEV: DEV }, makeSupabaseStub(), makeAnthropicStub());
    const response = await handler(postRequest({ Origin: UNKNOWN }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.content).toBe("Add a habit and log it a few times to get your first personalized tip! \u{1F331}");
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('no-Origin callers (curl, cron, server-to-server) behave exactly as before: identical status/body, only the CORS header differs', async () => {
    const handlerWithOrigin = loadRealHandler({ ALLOWED_ORIGIN_DEV: DEV }, makeSupabaseStub(), makeAnthropicStub());
    const withOrigin = await handlerWithOrigin(postRequest({ Origin: DEV }));
    const withOriginBody = await withOrigin.json();

    const handlerNoOrigin = loadRealHandler({ ALLOWED_ORIGIN_DEV: DEV }, makeSupabaseStub(), makeAnthropicStub());
    const noOrigin = await handlerNoOrigin(postRequest());
    const noOriginBody = await noOrigin.json();

    // createdAt is a fresh `new Date().toISOString()` per call on this canned-response path, so it
    // legitimately differs by a few ms between two separate invocations -- excluded from the
    // equality check on that basis, not because the fields being compared were narrowed.
    expect(noOrigin.status).toBe(withOrigin.status);
    expect({ ...noOriginBody, createdAt: undefined }).toEqual({ ...withOriginBody, createdAt: undefined });
    expect(noOrigin.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(withOrigin.headers.get('Access-Control-Allow-Origin')).toBe(DEV);
  });

  it('B6-shaped verification: an authenticated request with no Origin header still returns the stamp via the canned-response path', async () => {
    const handler = loadRealHandler({ ALLOWED_ORIGIN_DEV: DEV, ALLOWED_ORIGIN_PROD: PROD }, makeSupabaseStub(), makeAnthropicStub());
    const response = await handler(postRequest()); // no Origin header at all, mirroring curl
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.stamp).toBeDefined();
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull(); // never set for a non-browser caller
  });
});

describe('send-coaching-push/index.ts is untouched by the CORS fix', () => {
  it('still has zero CORS-related references, confirming the both-together exception boundary was respected', () => {
    const source = fs.readFileSync(SEND_COACHING_PUSH_PATH, 'utf8');
    expect(source).not.toMatch(/ALLOWED_ORIGIN/);
    expect(source).not.toMatch(/Access-Control/);
    expect(source).not.toMatch(/corsHeaders/);
    expect(source).not.toMatch(/buildCorsHeaders/);
  });
});
