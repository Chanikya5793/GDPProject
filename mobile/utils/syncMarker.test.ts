import { describe, expect, it } from 'vitest';
import { changedKinds } from './syncMarker';

const me = 'app-me';

describe('change marker', () => {
  it('does nothing on the first sighting', () => {
    expect(changedKinds(null, { version: 9, task: 9 }, me)).toEqual([]);
  });
  it('refetches only the kinds another device changed', () => {
    expect(changedKinds({ version: 4, task: 3, reminder: 1 }, { version: 5, task: 3, reminder: 2, by: 'web' }, me))
      .toEqual(['reminder']);
  });
  it('skips the echo of this device’s own single write', () => {
    expect(changedKinds({ version: 4, task: 4 }, { version: 5, task: 5, by: me }, me)).toEqual([]);
  });
  it('still refetches when another write landed alongside ours', () => {
    expect(changedKinds({ version: 4, task: 4 }, { version: 6, task: 5, note: 1, by: me }, me))
      .toEqual(['task', 'note']);
  });
  it('ignores a marker that did not advance', () => {
    expect(changedKinds({ version: 4, task: 4 }, { version: 4, task: 4, by: 'web' }, me)).toEqual([]);
  });
  it('treats a version-only marker as a change to everything', () => {
    expect(changedKinds({ version: 1 }, { version: 2 }, me)).toEqual(['task', 'reminder', 'note']);
  });
  it('never treats an anonymous write as our own', () => {
    expect(changedKinds({ version: 1, task: 1 }, { version: 2, task: 2, by: '' }, '')).toEqual(['task']);
  });
});
