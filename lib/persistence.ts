import sqlite3 from 'sqlite3';
import { logger } from './logger';

export interface PMThreadData {
  ircNick: string;
  threadId: string;
  channelId: string;
  lastActivity: number;
}

export interface ChannelUserData {
  channel: string;
  users: string[];
  lastUpdated: number;
}

export class PersistenceService {
  private db!: sqlite3.Database;
  private dbPath: string;

  constructor(dbPath: string = './discord-irc.db') {
    this.dbPath = dbPath;
  }

  async initialize(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(this.dbPath, (err) => {
        if (err) {
          logger.error('Failed to open database:', err);
          reject(err);
          return;
        }
        
        logger.info(`Connected to SQLite database at ${this.dbPath}`);
        this.createTables().then(resolve).catch(reject);
      });
    });
  }

  private async createTables(): Promise<void> {
    const queries = [
      `CREATE TABLE IF NOT EXISTS pm_threads (
        irc_nick TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        last_activity INTEGER NOT NULL,
        created_at INTEGER DEFAULT (strftime('%s', 'now'))
      )`,
      `CREATE TABLE IF NOT EXISTS channel_users (
        channel TEXT PRIMARY KEY,
        users TEXT NOT NULL,
        last_updated INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS bot_metrics (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER DEFAULT (strftime('%s', 'now'))
      )`
    ];

    for (const query of queries) {
      await new Promise<void>((resolve, reject) => {
        this.db.run(query, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }

    logger.debug('Database tables created/verified');
  }

  async savePMThread(ircNick: string, threadId: string, channelId: string): Promise<void> {
    const now = Date.now();
    
    return new Promise((resolve, reject) => {
      this.db.run(`
        INSERT OR REPLACE INTO pm_threads 
        (irc_nick, thread_id, channel_id, last_activity) 
        VALUES (?, ?, ?, ?)
      `, [ircNick.toLowerCase(), threadId, channelId, now], (err) => {
        if (err) {
          logger.error('Failed to save PM thread:', err);
          reject(err);
        } else {
          logger.debug(`Saved PM thread mapping: ${ircNick} -> ${threadId}`);
          resolve();
        }
      });
    });
  }

  async getPMThread(ircNick: string): Promise<PMThreadData | null> {
    return new Promise((resolve, reject) => {
      this.db.get(`
        SELECT irc_nick, thread_id, channel_id, last_activity 
        FROM pm_threads 
        WHERE irc_nick = ?
      `, [ircNick.toLowerCase()], (err, row: any) => {
        if (err) {
          logger.error('Failed to get PM thread:', err);
          resolve(null);
        } else if (!row) {
          resolve(null);
        } else {
          resolve({
            ircNick: row.irc_nick,
            threadId: row.thread_id,
            channelId: row.channel_id,
            lastActivity: row.last_activity
          });
        }
      });
    });
  }

  async getAllPMThreads(): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    
    return new Promise((resolve) => {
      this.db.all(`
        SELECT irc_nick, thread_id 
        FROM pm_threads
      `, (err, rows: any[]) => {
        if (err) {
          logger.error('Failed to load PM threads:', err);
          resolve(result);
        } else {
          for (const row of rows) {
            result.set(row.irc_nick, row.thread_id);
          }
          logger.debug(`Loaded ${result.size} PM thread mappings from database`);
          resolve(result);
        }
      });
    });
  }

  async updatePMThreadNick(oldNick: string, newNick: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.run(`
        UPDATE pm_threads 
        SET irc_nick = ?, last_activity = ? 
        WHERE irc_nick = ?
      `, [newNick.toLowerCase(), Date.now(), oldNick.toLowerCase()], (err) => {
        if (err) {
          logger.error('Failed to update PM thread nick:', err);
          reject(err);
        } else {
          logger.debug(`Updated PM thread nick: ${oldNick} -> ${newNick}`);
          resolve();
        }
      });
    });
  }

  async deletePMThread(ircNick: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.run(`
        DELETE FROM pm_threads 
        WHERE irc_nick = ?
      `, [ircNick.toLowerCase()], (err) => {
        if (err) {
          logger.error('Failed to delete PM thread:', err);
          reject(err);
        } else {
          logger.debug(`Deleted PM thread for: ${ircNick}`);
          resolve();
        }
      });
    });
  }

  async saveChannelUsers(channel: string, users: Set<string>): Promise<void> {
    const usersArray = Array.from(users);
    const usersJson = JSON.stringify(usersArray);
    const now = Date.now();
    
    return new Promise((resolve, reject) => {
      this.db.run(`
        INSERT OR REPLACE INTO channel_users 
        (channel, users, last_updated) 
        VALUES (?, ?, ?)
      `, [channel, usersJson, now], (err) => {
        if (err) {
          logger.error('Failed to save channel users:', err);
          reject(err);
        } else {
          logger.debug(`Saved ${usersArray.length} users for channel ${channel}`);
          resolve();
        }
      });
    });
  }

  async getChannelUsers(channel: string): Promise<Set<string>> {
    return new Promise((resolve) => {
      this.db.get(`
        SELECT users 
        FROM channel_users 
        WHERE channel = ?
      `, [channel], (err, row: any) => {
        if (err) {
          logger.error('Failed to get channel users:', err);
          resolve(new Set());
        } else if (!row) {
          resolve(new Set());
        } else {
          try {
            const users = JSON.parse(row.users);
            resolve(new Set(users));
          } catch (parseErr) {
            logger.error('Failed to parse channel users JSON:', parseErr);
            resolve(new Set());
          }
        }
      });
    });
  }

  async getAllChannelUsers(): Promise<Record<string, Set<string>>> {
    const result: Record<string, Set<string>> = {};
    
    return new Promise((resolve) => {
      this.db.all(`
        SELECT channel, users 
        FROM channel_users
      `, (err, rows: any[]) => {
        if (err) {
          logger.error('Failed to load channel users:', err);
          resolve(result);
        } else {
          for (const row of rows) {
            try {
              const users = JSON.parse(row.users);
              result[row.channel] = new Set(users);
            } catch (parseErr) {
              logger.error(`Failed to parse channel users for ${row.channel}:`, parseErr);
            }
          }
          logger.debug(`Loaded channel users for ${Object.keys(result).length} channels`);
          resolve(result);
        }
      });
    });
  }

  async saveMetric(key: string, value: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.run(`
        INSERT OR REPLACE INTO bot_metrics 
        (key, value) 
        VALUES (?, ?)
      `, [key, value], (err) => {
        if (err) {
          logger.error('Failed to save metric:', err);
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  async getMetric(key: string): Promise<string | null> {
    return new Promise((resolve) => {
      this.db.get(`
        SELECT value 
        FROM bot_metrics 
        WHERE key = ?
      `, [key], (err, row: any) => {
        if (err) {
          logger.error('Failed to get metric:', err);
          resolve(null);
        } else {
          resolve(row ? row.value : null);
        }
      });
    });
  }

  async close(): Promise<void> {
    return new Promise((resolve) => {
      this.db.close((err) => {
        if (err) {
          logger.error('Error closing database:', err);
        } else {
          logger.info('Database connection closed');
        }
        resolve();
      });
    });
  }

  async cleanup(): Promise<void> {
    const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
    
    const queries = [
      // Clean up old PM threads (inactive for more than 7 days)
      { sql: 'DELETE FROM pm_threads WHERE last_activity < ?', params: [sevenDaysAgo] },
      // Clean up old channel user data (older than 1 day)
      { sql: 'DELETE FROM channel_users WHERE last_updated < ?', params: [oneDayAgo] }
    ];

    for (const query of queries) {
      await new Promise<void>((resolve, reject) => {
        this.db.run(query.sql, query.params, (err) => {
          if (err) {
            logger.error('Failed to cleanup database:', err);
            reject(err);
          } else {
            resolve();
          }
        });
      });
    }
    
    logger.debug('Database cleanup completed');
  }
}