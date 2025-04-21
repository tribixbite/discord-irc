import { afterEach, vi, describe, it, expect } from 'vitest';
import { run as cli } from '../lib/cli';
import * as helpers from '../lib/helpers';
import testConfig from './fixtures/test-config.json';
import singleTestConfig from './fixtures/single-test-config.json';

vi.mock('../lib/helpers', async () => {
  const actual = await vi.importActual('../lib/helpers');
  return {
    ...actual,
    createBot: vi.fn(),
  };
});

describe('CLI', function () {
  afterEach(function () {
    vi.resetAllMocks();
  });

  it('should strip comments from JSON config', async () => {
    process.argv = [
      'node',
      'index.js',
      '-c',
      `${process.cwd()}/test/fixtures/test-config-comments.json`,
    ];
    await cli();
    expect(helpers.createBot).toHaveBeenCalledWith(testConfig);
  });

  it('should support JS configs', async () => {
    process.argv = [
      'node',
      'index.js',
      '-c',
      `${process.cwd()}/test/fixtures/test-javascript-config.js`,
    ];
    await cli();
    expect(helpers.createBot).toHaveBeenCalledWith(testConfig);
  });

  it('should throw a ConfigurationError for invalid JSON', async () => {
    process.argv = [
      'node',
      'index.js',
      '-c',
      `${process.cwd()}/test/fixtures/invalid-json-config.json`,
    ];
    const wrap = async () => cli();
    await expect(wrap).rejects.toThrow(/in JSON at/);
  });

  it('should be possible to give the config as an option', async () => {
    delete process.env.CONFIG_FILE;
    process.argv = [
      'node',
      'index.js',
      '-c',
      `${process.cwd()}/test/fixtures/single-test-config.json`,
    ];

    await cli();
    expect(helpers.createBot).toHaveBeenCalledWith(singleTestConfig);
  });
});
