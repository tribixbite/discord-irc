#!/usr/bin/env node

import { createBots } from './helpers';

if (!module.parent) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('./cli').default();
}

export default createBots;
