import { describe, it, expect } from 'vitest';
import { APP_VERSION, APP_NAME } from '../../version';
import packageJson from '../../../package.json';

describe('Centralized App Version Single Source of Truth', () => {
  it('should match package.json version exactly', () => {
    expect(APP_VERSION).toBe(packageJson.version);
    expect(APP_NAME).toBe(packageJson.name);
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
