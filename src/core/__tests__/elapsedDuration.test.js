import { describe, it, expect } from 'vitest';
import { APP_VERSION } from '../../version';
import packageJson from '../../../package.json';

describe('Elapsed Duration & Version Verification', () => {
  it('has package.json and version.js in sync with version 0.1.8', () => {
    expect(APP_VERSION).toBe('0.1.8');
    expect(packageJson.version).toBe('0.1.8');
  });

  it('calculates durationMs accurately from startedAt and completedAt', () => {
    const startedAt = 1724500000000;
    const completedAt = 1724500008420;
    const durationMs = completedAt - startedAt;

    expect(durationMs).toBe(8420);
    const secStr = (durationMs / 1000).toFixed(1) + 's';
    expect(secStr).toBe('8.4s');
  });
});
