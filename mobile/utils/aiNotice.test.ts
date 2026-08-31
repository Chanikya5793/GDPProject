import { describe, expect, it } from 'vitest';

import { AI_NOTICE_KEY, noticeParagraphs } from './aiNotice';

const training = { provider: 'Meta', model: 'muse-spark-1.2-contributor', trains_on_prompts: true };
const notTraining = { ...training, model: 'muse-spark-1.2', trains_on_prompts: false };

describe('noticeParagraphs', () => {
  it('names the provider and model that will receive planner records', () => {
    const text = noticeParagraphs(training).join(' ');
    expect(text).toContain('Meta');
    expect(text).toContain('muse-spark-1.2-contributor');
  });

  it('states plainly when the tier trains on what is sent', () => {
    // This may be the only place a student is told. It must not be softened away.
    expect(noticeParagraphs(training).join(' ')).toContain('used to train its models');
  });

  it('omits the training sentence when the tier does not train', () => {
    expect(noticeParagraphs(notTraining).join(' ')).not.toContain('used to train');
  });

  it('still explains what happens when the provider is unknown', () => {
    // A failed /v1/ai-info must not turn the disclosure into silence.
    const text = noticeParagraphs(null).join(' ');
    expect(text).toContain('configured AI provider');
    expect(text).toContain('reads the planner records');
  });

  it('never claims a training tier it was not told about', () => {
    expect(noticeParagraphs(null).join(' ')).not.toContain('train');
  });

  it('names both ways out', () => {
    const text = noticeParagraphs(training).join(' ');
    expect(text).toContain('turn the assistant off entirely in Settings');
    expect(text).toContain('visibility switch');
  });

  it('stores acknowledgement under a key the encrypted store scopes per user', () => {
    expect(AI_NOTICE_KEY).toBe('nw_ai_notice');
  });
});
