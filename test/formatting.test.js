import { describe, it, expect } from 'vitest';
import {
  formatFromDiscordToIRC,
  formatFromIRCToDiscord,
} from '../lib/formatting';

describe('Formatting', () => {
  describe('Discord to IRC', () => {
    it('should convert bold markdown', () => {
      expect(formatFromDiscordToIRC('**text**')).toEqual('\x02text\x02');
    });

    it('should convert italic markdown', () => {
      expect(formatFromDiscordToIRC('*text*')).toEqual('\x1dtext\x1d');
      expect(formatFromDiscordToIRC('_text_')).toEqual('\x1dtext\x1d');
    });

    it('should convert underline markdown', () => {
      expect(formatFromDiscordToIRC('__text__')).toEqual('\x1ftext\x1f');
    });

    it('should ignore strikethrough markdown', () => {
      expect(formatFromDiscordToIRC('~~text~~')).toEqual('text');
    });

    it('should convert nested markdown', () => {
      expect(formatFromDiscordToIRC('**bold *italics***')).toEqual(
        '\x02bold \x1ditalics\x1d\x02',
      );
    });
  });

  describe('IRC to Discord', () => {
    it('should convert bold IRC format', () => {
      expect(formatFromIRCToDiscord('\x02text\x02')).toEqual('**text**');
    });

    it('should convert reverse IRC format', () => {
      expect(formatFromIRCToDiscord('\x16text\x16')).toEqual('*text*');
    });

    it('should convert italic IRC format', () => {
      expect(formatFromIRCToDiscord('\x1dtext\x1d')).toEqual('*text*');
    });

    it('should convert underline IRC format', () => {
      expect(formatFromIRCToDiscord('\x1ftext\x1f')).toEqual('__text__');
    });

    it('should ignore color IRC format', () => {
      expect(formatFromIRCToDiscord('\x0306,08text\x03')).toEqual('text');
    });

    it('should convert nested IRC format', () => {
      expect(formatFromIRCToDiscord('\x02bold \x16italics\x16\x02')).toEqual(
        '**bold *italics***',
      );
    });

    it('should convert nested IRC format', () => {
      expect(formatFromIRCToDiscord('\x02bold \x1funderline\x1f\x02')).toEqual(
        '**bold __underline__**',
      );
    });
  });
});
