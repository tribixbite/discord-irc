#!/usr/bin/env node

import fs from 'node:fs';
import { resolve } from 'node:path';
import stripJsonComments from 'strip-json-comments';
import * as helpers from './helpers';

function readJSONConfig(filePath: string): unknown {
  const configFile = fs.readFileSync(filePath, { encoding: 'utf8' });
  return JSON.parse(stripJsonComments(configFile));
}

async function readJSConfig(filePath: string): Promise<unknown> {
  const { default: config } = await import(filePath);
  return config;
}

export async function run() {
  const [, , _c, configPath, ...rest] = process.argv;
  if (rest.length || _c !== '-c' || !configPath) {
    console.error('Usage: -c <config-file>');
    process.exit(2);
  }

  const completePath = resolve(process.cwd(), configPath);
  const config = completePath.endsWith('.json')
    ? readJSONConfig(completePath)
    : await readJSConfig(completePath);
  if (!config || typeof config !== 'object') {
    console.error(
      'expecting an object exported from the config file, got',
      config,
    );
    process.exit(2);
  }
  await helpers.createBot(config as Record<string, unknown>);
}
