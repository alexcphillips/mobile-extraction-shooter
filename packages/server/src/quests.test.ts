import { describe, expect, it } from 'vitest';
import { addItem, countOf, createItem } from '@mes/shared';
import { loadItems, questDef } from './content';
import { testEnv } from './test/d1';
import { TestClient } from './test/client';

const items = loadItems();

async function signedIn() {
  const client = new TestClient(testEnv());
  await client.register();
  return client;
}

describe('quests', () => {
  it('accept, hand over from the stash and complete, once per version', async () => {
    const client = await signedIn();
    expect(questDef('field-dressing')).toBeDefined();
    let me = await client.ok('GET', '/profile');
    const locked = await client.fails('POST', '/quests/test-notes/accept', { version: me.version });
    expect(locked.message).toMatch(/first/);
    me = await client.ok('POST', '/quests/field-dressing/accept', { version: me.version });
    expect(me.profile.quests['field-dressing']).toEqual({ status: 'active', progress: {} });
    const retry = await client.fails('POST', '/quests/field-dressing/accept', {
      version: me.version - 1,
    });
    expect(retry.error).toBe('stale');

    const kitBandages = countOf(me.profile.stash[0]!, 'bandage');
    const kitMedkits = countOf(me.profile.stash[0]!, 'medkit');
    await client.editProfile((p) => {
      for (let i = 0; i < 4; i++) addItem(items, p.stash[0]!, createItem(items, 'bandage'));
    });
    me = await client.ok('GET', '/profile');
    const notYet = await client.fails('POST', '/quests/field-dressing/complete', {
      version: me.version,
    });
    expect(notYet.message).toMatch(/isn't finished/);
    const give = { version: me.version, objective: 'bandages' };
    me = await client.ok('POST', '/quests/field-dressing/hand-over', give);
    expect(countOf(me.profile.stash[0]!, 'bandage')).toBe(kitBandages + 1);
    expect((await client.fails('POST', '/quests/field-dressing/hand-over', give)).error).toBe(
      'stale',
    );
    const money = me.profile.money;
    me = await client.ok('POST', '/quests/field-dressing/complete', { version: me.version });
    expect(me.profile.quests['field-dressing']).toEqual({ status: 'done' });
    expect(me.profile.money).toBe(money + questDef('field-dressing')!.rewards.money);
    expect(countOf(me.profile.stash[0]!, 'medkit')).toBe(kitMedkits + 1);
    // The next in the chain opens.
    me = await client.ok('POST', '/quests/test-notes/accept', { version: me.version });
    expect(me.profile.quests['test-notes']?.status).toBe('active');
  });

  it('refuse unknown quests and actions, and edits in a raid', async () => {
    const client = await signedIn();
    const me = await client.ok('GET', '/profile');
    const v = { version: me.version };
    expect((await client.fails('POST', '/quests/nobody/accept', v)).error).toBe('not-found');
    expect((await client.fails('POST', '/quests/field-dressing/steal', v)).error).toBe('not-found');
    expect((await client.fails('POST', '/quests/field-dressing/toString', v)).error).toBe(
      'not-found',
    );
    expect((await client.fails('POST', '/quests/field-dressing/accept', {})).error).toBe(
      'bad-request',
    );
    const bad = { version: me.version, objective: 'nope' };
    await client.ok('POST', '/quests/field-dressing/accept', v);
    const after = await client.ok('GET', '/profile');
    expect(
      (
        await client.fails('POST', '/quests/field-dressing/hand-over', {
          ...bad,
          version: after.version,
        })
      ).message,
    ).toMatch(/no such/);
    await client.ok('POST', '/raids', { raid: 'northpoint' });
    const inRaid = { version: (await client.ok('GET', '/profile')).version };
    expect((await client.fails('POST', '/quests/test-radio/accept', inRaid)).error).toBe('in-raid');
  });

  it('are kept through a raid, and PUT refuses changing them', async () => {
    const client = await signedIn();
    let me = await client.ok('GET', '/profile');
    me = await client.ok('POST', '/quests/test-radio/accept', { version: me.version });
    const forged = structuredClone(me.profile);
    forged.quests['test-radio'] = { status: 'active', progress: { 'find-radio': 1 } };
    const put = await client.fails('PUT', '/profile', { version: me.version, profile: forged });
    expect(put.message).toMatch(/quests only change/);
    const done = structuredClone(me.profile);
    done.quests['test-radio'] = { status: 'done' };
    expect(
      (await client.fails('PUT', '/profile', { version: me.version, profile: done })).error,
    ).toBe('invalid');
    // A stash edit that leaves quests alone still saves.
    await client.ok('PUT', '/profile', { version: me.version, profile: me.profile });
    const raid = await client.ok('POST', '/raids', { raid: 'northpoint' });
    me = await client.ok('POST', `/raids/${raid.raid!.id}/end`, {
      how: 'killed',
      gear: raid.profile.gear,
      seconds: 60,
      kills: 0,
    });
    expect(me.profile.quests['test-radio']?.status).toBe('active');
  });

  it('progress with a raid: markers investigated even after dying, quest items kept', async () => {
    const client = await signedIn();
    await client.editProfile((p) => {
      p.quests['test-radio'] = { status: 'active', progress: {} };
      p.quests['test-notes'] = { status: 'active', progress: {} };
    });
    let raid = await client.ok('POST', '/raids', { raid: 'northpoint' });
    // Died with the notes in the backpack: the radio counts, the notes are lost.
    let gear = structuredClone(raid.profile.gear);
    addItem(items, gear.backpack!.grid!, createItem(items, 'test-notes-item'));
    let me = await client.ok('POST', `/raids/${raid.raid!.id}/end`, {
      how: 'killed',
      gear,
      seconds: 60,
      kills: 0,
      investigated: ['test-radio', 'not-a-marker'],
    });
    expect(me.profile.quests['test-radio']).toEqual({
      status: 'active',
      progress: { 'find-radio': 1 },
    });
    expect(me.profile.quests['test-notes']).toEqual({ status: 'active', progress: {} });
    // Kept in the vault after dying, they count, and are taken.
    raid = await client.ok('POST', '/raids', { raid: 'northpoint' });
    gear = structuredClone(raid.profile.gear);
    addItem(items, gear.vault!, createItem(items, 'test-notes-item'));
    me = await client.ok('POST', `/raids/${raid.raid!.id}/end`, {
      how: 'mia',
      gear,
      seconds: 60,
      kills: 0,
    });
    expect(me.profile.quests['test-notes']).toEqual({
      status: 'active',
      progress: { notes: 1 },
    });
    expect(countOf(me.profile.gear.vault!, 'test-notes-item')).toBe(0);
    // Quest items with no quest wanting them are taken too, and nothing else changes.
    raid = await client.ok('POST', '/raids', { raid: 'northpoint' });
    gear = structuredClone(raid.profile.gear);
    addItem(items, gear.pockets, createItem(items, 'test-notes-item'));
    me = await client.ok('POST', `/raids/${raid.raid!.id}/end`, {
      how: 'extracted',
      gear,
      seconds: 60,
      kills: 0,
    });
    expect(countOf(me.profile.gear.pockets, 'test-notes-item')).toBe(0);
    expect(me.profile.quests['test-notes']).toEqual({
      status: 'active',
      progress: { notes: 1 },
    });
  });

  it('refuse malformed investigated lists', async () => {
    const client = await signedIn();
    const raid = await client.ok('POST', '/raids', { raid: 'northpoint' });
    const end = { how: 'extracted', gear: raid.profile.gear, seconds: 60, kills: 0 };
    for (const investigated of ['test-radio', [1], Array(51).fill('x')]) {
      const res = await client.fails('POST', `/raids/${raid.raid!.id}/end`, {
        ...end,
        investigated,
      });
      expect(res.error).toBe('bad-request');
    }
  });
});
