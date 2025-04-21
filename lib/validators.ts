import { ConfigurationError } from './errors';

export function validateChannelMapping(mapping: unknown) {
  if (!mapping || typeof mapping !== 'object') {
    throw new ConfigurationError(
      'Invalid channel mapping given: ' + JSON.stringify(mapping),
    );
  }

  return mapping as Record<string, string>;
}
