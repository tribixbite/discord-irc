import Bot from './bot';

export async function createBot(configFile: Record<string, unknown>) {
  const bot = new Bot(configFile);
  await bot.connect();
  return bot;
}
