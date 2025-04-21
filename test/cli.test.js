import { afterEach, vi, describe, it, expect } from 'vitest';
import cli from '../lib/cli';
import * as helpers from '../lib/helpers';
import testConfig from './fixtures/test-config.json';
import singleTestConfig from './fixtures/single-test-config.json';

vi.mock('../lib/helpers', async () => {
  const actual = await vi.importActual('../lib/helpers');
  return {
    ...actual,
    createBots: vi.fn(),
  };
});

describe('CLI', function () {
  afterEach(function () {
    vi.resetAllMocks();
  });

  it('should be possible to give the config as an env var', function () {
    process.env.CONFIG_FILE = `${process.cwd()}/test/fixtures/test-config.json`;
    process.argv = ['node', 'index.js'];
    cli();
    expect(helpers.createBots).toHaveBeenCalledWith(testConfig);
  });

  it('should strip comments from JSON config', function () {
    process.env.CONFIG_FILE = `${process.cwd()}/test/fixtures/test-config-comments.json`;
    process.argv = ['node', 'index.js'];
    cli();
    expect(helpers.createBots).toHaveBeenCalledWith(testConfig);
  });

  it('should support JS configs', function () {
    process.env.CONFIG_FILE = `${process.cwd()}/test/fixtures/test-javascript-config.js`;
    process.argv = ['node', 'index.js'];
    cli();
    expect(helpers.createBots).toHaveBeenCalledWith(testConfig);
  });

  it('should throw a ConfigurationError for invalid JSON', function () {
    process.env.CONFIG_FILE = `${process.cwd()}/test/fixtures/invalid-json-config.json`;
    process.argv = ['node', 'index.js'];
    const wrap = () => cli();
    expect(wrap).toThrow('The configuration file contains invalid JSON');
  });

  it('should be possible to give the config as an option', function () {
    delete process.env.CONFIG_FILE;
    process.argv = [
      'node',
      'index.js',
      '--config',
      `${process.cwd()}/test/fixtures/single-test-config.json`,
    ];

    cli();
    expect(helpers.createBots).toHaveBeenCalledWith(singleTestConfig);
  });
});
