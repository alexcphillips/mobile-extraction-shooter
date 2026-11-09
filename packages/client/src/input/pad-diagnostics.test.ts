import { describe, expect, it, vi } from 'vitest';

vi.mock('./mode', () => ({ inputMode: { current: 'desktop', changes: [] } }));

const { diagnose } = await import('./pad-diagnostics');
type Env = Parameters<typeof diagnose>[0];
type Pad = Parameters<typeof diagnose>[1][number];

const env = (over: Partial<Env> = {}): Env => ({
  hasApi: true,
  secure: true,
  framed: false,
  policyAllows: true,
  error: null,
  focused: true,
  visible: true,
  userAgent: 'test',
  ...over,
});
const pad = (over: Partial<Pad> = {}): Pad => ({
  index: 0,
  id: 'DualShock 4',
  mapping: 'standard',
  connected: true,
  buttonCount: 18,
  axisCount: 4,
  pressed: [],
  axes: [0, 0, 0, 0],
  timestamp: 1,
  ...over,
});

describe('diagnose', () => {
  it('says when the page has no gamepad API', () => {
    expect(diagnose(env({ hasApi: false, secure: false }), []).status).toBe('no-api');
  });
  it('says when the permissions policy blocks it or getGamepads throws', () => {
    expect(diagnose(env({ policyAllows: false }), []).status).toBe('blocked');
    expect(diagnose(env({ error: 'SecurityError' }), []).status).toBe('blocked');
  });
  it('asks for a press when no pad is listed', () => {
    expect(diagnose(env(), []).status).toBe('none');
    expect(diagnose(env(), [pad({ connected: false })]).status).toBe('none');
  });
  it('names a pad without the standard mapping', () => {
    const d = diagnose(env(), [pad({ mapping: '', id: 'Odd pad' })]);
    expect(d.status).toBe('non-standard');
    expect(d.title).toContain('Odd pad');
  });
  it('is ready when any connected pad is standard', () => {
    expect(diagnose(env(), [pad({ mapping: '' }), pad({ index: 1 })]).status).toBe('ok');
  });
});
