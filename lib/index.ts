#!/usr/bin/env node

// eslint-disable-next-line import/no-import-module-exports
import { createBots } from './helpers';

/* istanbul ignore next */
if (!module.parent) {
  require('./cli').default();
}

export default createBots;
