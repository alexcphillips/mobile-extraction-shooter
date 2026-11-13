/*
 * Content the server tests add to the bundle (2026-11-09, when the test map and its two
 * quests were deleted): quests with objectives in a raid, since no real quest has one yet,
 * and a quest item for one of them, since no real item is one.
 * They're on Northpoint (the server never loads a map, so its markers are only names
 * here). Added by setup.ts in tests only; never in content/ or the deployed bundle.
 */
export const testContent: Record<string, unknown> = {
  'content/items/test-notes-item.json': {
    formatVersion: 11,
    id: 'test-notes-item',
    name: 'Test notes',
    type: 'quest',
    size: [1, 1],
    value: 0,
    weight: 0.1,
    rarity: 'common',
    model: { parts: [{ type: 'box', pos: [0, 0, 0], size: [0.1, 0.1, 0.1], color: '#8b4a8b' }] },
  },
  'content/quests/test-notes.json': {
    formatVersion: 1,
    id: 'test-notes',
    name: 'Test notes',
    vendor: 'medic',
    description: 'Tests only.',
    requires: ['field-dressing'],
    objectives: [
      {
        id: 'notes',
        type: 'extract',
        item: 'test-notes-item',
        map: 'northpoint',
        spots: ['test-notes-spot'],
        text: 'Get out with the test notes',
      },
    ],
    rewards: { money: 1000 },
  },
  'content/quests/test-radio.json': {
    formatVersion: 1,
    id: 'test-radio',
    name: 'Test radio',
    vendor: 'guns-ammo-vendor',
    description: 'Tests only.',
    objectives: [
      {
        id: 'find-radio',
        type: 'investigate',
        map: 'northpoint',
        marker: 'test-radio',
        text: 'Find the radio',
      },
    ],
    rewards: { money: 1000 },
  },
};
