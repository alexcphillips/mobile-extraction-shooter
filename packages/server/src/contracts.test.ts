import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addItem,
  contractBoard,
  countItems,
  createItem,
  INTEL_DESK,
  POWER_GRID,
  type EndRaidRequest,
  type Gear,
  type KillCounts,
  type ProfileResponse,
} from '@mes/shared';
import { loadContracts, loadItems } from './content';
import { testEnv } from './test/d1';
import { TestClient } from './test/client';

const items = loadItems();
const HOUR = 3_600_000;

describe('Intel desk contracts', () => {
  let clock = 0;
  beforeEach(() => {
    // Noon, so a few hours on stays the same board day.
    clock = Math.floor(Date.now() / 86_400_000) * 86_400_000 + 12 * HOUR;
    vi.spyOn(Date, 'now').mockImplementation(() => clock);
  });
  afterEach(() => vi.restoreAllMocks());

  /** A player with the Intel desk at level 1, and some bandages left. */
  async function withDesk() {
    const client = new TestClient(testEnv());
    await client.register();
    await client.editProfile((p) => {
      for (let i = 0; i < 5; i++) addItem(items, p.stash[0]!, createItem(items, 'bandage'));
    });
    let me = await client.ok('GET', '/profile');
    expect(
      (await client.fails('POST', '/contracts/scav-sweep/take', { version: me.version })).message,
    ).toMatch(/Intel desk at level 1/);
    me = await client.ok('POST', `/hangar/${POWER_GRID}/upgrade`, { version: me.version });
    me = await client.ok('POST', `/hangar/${INTEL_DESK}/upgrade`, { version: me.version });
    return { client, me };
  }

  async function raid(
    client: TestClient,
    killed: KillCounts,
    map = 'northpoint',
    after?: () => void,
  ) {
    const { raid, profile } = await client.ok('POST', '/raids', { raid: map });
    after?.();
    const kills = Object.values(killed).reduce((a, b) => a + b, 0);
    const end: EndRaidRequest = {
      how: 'killed',
      gear: profile.gear as Gear,
      seconds: 60,
      kills,
      killed,
    };
    return client.ok('POST', `/raids/${raid!.id}/end`, end);
  }

  it('shows the level-1 contracts on the board at desk level 1', async () => {
    const { me } = await withDesk();
    const board = contractBoard(loadContracts().values(), me.profile, clock).map((c) => c.id);
    expect(board.sort()).toEqual(['creek-patrol', 'scav-sweep', 'tool-run']);
    expect(
      (await new TestClient(testEnv()).request('POST', '/contracts/headhunter/take')).status,
    ).toBe(401);
  });

  it('counts kills by faction from raids that started in its window, then pays out once', async () => {
    const { client } = await withDesk();
    let me: ProfileResponse = await client.ok('GET', '/profile');
    me = await client.ok('POST', '/contracts/scav-sweep/take', { version: me.version });
    expect(me.profile.contracts.active).toEqual({
      id: 'scav-sweep',
      ends: clock + 3 * HOUR,
      progress: {},
    });
    expect(
      (await client.fails('POST', '/contracts/tool-run/take', { version: me.version })).message,
    ).toMatch(/drop the contract you have/);
    // PUT can't touch it.
    const forged = structuredClone(me.profile);
    forged.contracts.active!.progress.scavs = 5;
    expect(
      (await client.fails('PUT', '/profile', { version: me.version, profile: forged })).message,
    ).toMatch(/contract routes/);

    me = await raid(client, { scav: 3, pmc: 1 });
    expect(me.profile.contracts.active!.progress).toEqual({ scavs: 3 });
    expect(
      (await client.fails('POST', '/contracts/claim', { version: me.version })).message,
    ).toMatch(/isn't finished/);

    // Started in time, ended after: it counts, and a finished contract doesn't expire.
    me = await raid(client, { scav: 4 }, 'silver-creek', () => (clock += 4 * HOUR));
    expect(me.profile.contracts.active!.progress).toEqual({ scavs: 5 });
    const kits = countItems(items, me.profile).get('field-first-aid-kit') ?? 0;
    me = await client.ok('POST', '/contracts/claim', { version: me.version });
    expect(me.profile.contracts.active).toBeUndefined();
    expect(countItems(items, me.profile).get('field-first-aid-kit')).toBe(kits + 1);
    expect(me.profile.vendors['guns-ammo-vendor']?.rep).toBeCloseTo(0.05);

    // Taken today: off the board until tomorrow.
    expect(
      (await client.fails('POST', '/contracts/scav-sweep/take', { version: me.version })).message,
    ).toMatch(/today already/);
    clock += 24 * HOUR;
    me = await client.ok('POST', '/contracts/scav-sweep/take', { version: me.version });
    expect(me.profile.contracts.active?.id).toBe('scav-sweep');
  });

  it("doesn't count a raid started after the window, and loses an unfinished contract", async () => {
    const { client, me: built } = await withDesk();
    await client.ok('POST', '/contracts/scav-sweep/take', { version: built.version });
    clock += 3 * HOUR;
    let me = await raid(client, { scav: 5 });
    expect(me.profile.contracts.active!.progress).toEqual({});
    expect(
      (await client.fails('POST', '/contracts/claim', { version: me.version })).message,
    ).toMatch(/haven't got a contract/);
    me = await client.ok('POST', '/contracts/tool-run/take', { version: me.version });
    expect(me.profile.contracts.active?.id).toBe('tool-run');
  });

  it('counts a map-bound kill only on its map, and refuses kills that add up to too many', async () => {
    const { client, me: built } = await withDesk();
    await client.ok('POST', '/contracts/creek-patrol/take', { version: built.version });
    let me = await raid(client, { scav: 3 }, 'northpoint');
    expect(me.profile.contracts.active!.progress).toEqual({});
    me = await raid(client, { scav: 3 }, 'silver-creek');
    expect(me.profile.contracts.active!.progress).toEqual({ scavs: 3 });

    const { raid: r, profile } = await client.ok('POST', '/raids', { raid: 'northpoint' });
    const bad = await client.fails('POST', `/raids/${r!.id}/end`, {
      how: 'killed',
      gear: profile.gear,
      seconds: 60,
      kills: 1,
      killed: { scav: 2 },
    });
    expect(bad.error).toBe('bad-request');
  });

  it('takes only found-in-raid items for a hand-over, and drops a contract', async () => {
    const { client, me: built } = await withDesk();
    await client.ok('POST', '/contracts/tool-run/take', { version: built.version });
    await client.editProfile((p) =>
      addItem(items, p.stash[0]!, createItem(items, 'cordless-drill')),
    );
    let me = await client.ok('GET', '/profile');
    expect(
      (
        await client.fails('POST', '/contracts/hand-over', {
          version: me.version,
          objective: 'drill',
        })
      ).message,
    ).toMatch(/found in raid/);
    await client.editProfile((p) => {
      const drill = createItem(items, 'cordless-drill');
      drill.found = true;
      addItem(items, p.stash[0]!, drill);
    });
    me = await client.ok('GET', '/profile');
    me = await client.ok('POST', '/contracts/hand-over', {
      version: me.version,
      objective: 'drill',
    });
    expect(me.profile.contracts.active!.progress).toEqual({ drill: 1 });
    expect(countItems(items, me.profile).get('cordless-drill')).toBe(1);

    me = await client.ok('POST', '/contracts/drop', { version: me.version });
    expect(me.profile.contracts.active).toBeUndefined();
    expect(
      (await client.fails('POST', '/contracts/drop', { version: me.version })).message,
    ).toMatch(/haven't got a contract/);
  });
});
