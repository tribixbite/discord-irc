/* eslint-disable @typescript-eslint/unbound-method */

import { afterEach, beforeEach, describe, it, vi, expect } from 'vitest';
import Bot from '../lib/bot';
import index from '../lib/index';
import testConfig from './fixtures/test-config.json';
import singleTestConfig from './fixtures/single-test-config.json';
import badConfig from './fixtures/bad-config.json';
import stringConfig from './fixtures/string-config.json';
import { createBots } from '../lib/helpers';

describe('Create Bots', function () {
  beforeEach(function () {
    Bot.prototype.connect = vi.fn();
  });

  afterEach(function () {
    vi.resetAllMocks();
  });

  it('should work when given an array of configs', function () {
    const bots = createBots(testConfig);
    expect(bots.length).toEqual(2);
    expect(Bot.prototype.connect).toHaveBeenCalled();
  });

  it('should work when given an object as a config file', function () {
    const bots = createBots(singleTestConfig);
    expect(bots.length).toEqual(1);
    expect(Bot.prototype.connect).toHaveBeenCalled();
  });

  it('should throw a configuration error if any fields are missing', function () {
    function wrap() {
      createBots(badConfig);
    }

    expect(wrap).toThrow('Missing configuration field nickname');
  });

  it('should throw if a configuration file is neither an object or an array', function () {
    function wrap() {
      createBots(stringConfig);
    }

    expect(wrap).toThrow('Invalid configuration file given');
  });

  it("should be possible to run it through require('discord-irc')", function () {
    const bots = index(singleTestConfig);
    expect(bots.length).toEqual(1);
    expect(Bot.prototype.connect).toHaveBeenCalled();
  });
});
