/**
 * Local-first IndexedDB Database
 * Handles persistent storage for Conversations, Messages, Custom Skills, Context, and Settings.
 */
import { openDB } from 'idb';

const DB_NAME = 'NvidiaPatchMobileDB';
const DB_VERSION = 1;

let dbPromise = null;

export function getDatabase() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        // Conversations store
        if (!db.objectStoreNames.contains('conversations')) {
          const convStore = db.createObjectStore('conversations', { keyPath: 'id' });
          convStore.createIndex('updatedAt', 'updatedAt');
        }

        // Messages store
        if (!db.objectStoreNames.contains('messages')) {
          const msgStore = db.createObjectStore('messages', { keyPath: 'id' });
          msgStore.createIndex('conversationId', 'conversationId');
          msgStore.createIndex('createdAt', 'createdAt');
        }

        // User Custom / Overridden Skills store
        if (!db.objectStoreNames.contains('user_skills')) {
          db.createObjectStore('user_skills', { keyPath: 'id' });
        }

        // Personal Context & Background settings store
        if (!db.objectStoreNames.contains('personal_context')) {
          db.createObjectStore('personal_context', { keyPath: 'key' });
        }

        // Provider configs store (metadata; sensitive keys in SecureStorage)
        if (!db.objectStoreNames.contains('provider_configs')) {
          db.createObjectStore('provider_configs', { keyPath: 'id' });
        }
      }
    });
  }
  return dbPromise;
}

export const LocalDB = {
  // --- Conversations ---
  async getConversations() {
    const db = await getDatabase();
    const list = await db.getAllFromIndex('conversations', 'updatedAt');
    return list.reverse(); // Most recent first
  },

  async getConversation(id) {
    const db = await getDatabase();
    return db.get('conversations', id);
  },

  async saveConversation(conv) {
    const db = await getDatabase();
    const updated = {
      ...conv,
      updatedAt: conv.updatedAt || Date.now()
    };
    await db.put('conversations', updated);
    return updated;
  },

  async deleteConversation(id) {
    const db = await getDatabase();
    const tx = db.transaction(['conversations', 'messages'], 'readwrite');
    await tx.objectStore('conversations').delete(id);
    
    // Delete all messages belonging to this conversation
    const msgIndex = tx.objectStore('messages').index('conversationId');
    let cursor = await msgIndex.openCursor(IDBKeyRange.only(id));
    while (cursor) {
      await cursor.delete();
      cursor = await cursor.continue();
    }
    await tx.done;
  },

  // --- Messages ---
  async getMessages(conversationId) {
    const db = await getDatabase();
    const list = await db.getAllFromIndex('messages', 'conversationId', conversationId);
    return list.sort((a, b) => a.createdAt - b.createdAt);
  },

  async saveMessage(msg) {
    const db = await getDatabase();
    const toSave = {
      id: msg.id || `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      createdAt: msg.createdAt || Date.now(),
      ...msg
    };
    await db.put('messages', toSave);
    return toSave;
  },

  async updateMessage(id, updates) {
    const db = await getDatabase();
    const existing = await db.get('messages', id);
    if (!existing) return null;
    const updated = { ...existing, ...updates };
    await db.put('messages', updated);
    return updated;
  },

  async deleteMessage(id) {
    const db = await getDatabase();
    await db.delete('messages', id);
  },

  async deleteMessagesAfter(conversationId, targetCreatedAt) {
    const db = await getDatabase();
    const tx = db.transaction('messages', 'readwrite');
    const msgIndex = tx.store.index('conversationId');
    let cursor = await msgIndex.openCursor(IDBKeyRange.only(conversationId));
    while (cursor) {
      if (cursor.value.createdAt > targetCreatedAt) {
        await cursor.delete();
      }
      cursor = await cursor.continue();
    }
    await tx.done;
  },

  // --- Custom Skills ---
  async getUserSkills() {
    const db = await getDatabase();
    return db.getAll('user_skills');
  },

  async saveUserSkill(skill) {
    const db = await getDatabase();
    const toSave = {
      ...skill,
      updatedAt: Date.now()
    };
    await db.put('user_skills', toSave);
    return toSave;
  },

  async deleteUserSkill(id) {
    const db = await getDatabase();
    await db.delete('user_skills', id);
  },

  // --- Personal Context ---
  async getContextSetting(key, defaultValue = '') {
    const db = await getDatabase();
    const row = await db.get('personal_context', key);
    return row ? row.value : defaultValue;
  },

  async getAllContextSettings() {
    const db = await getDatabase();
    const rows = await db.getAll('personal_context');
    const result = {};
    for (const r of rows) {
      result[r.key] = r.value;
    }
    return result;
  },

  async saveContextSetting(key, value) {
    const db = await getDatabase();
    await db.put('personal_context', { key, value });
  },

  async saveAllContextSettings(settingsObj) {
    const db = await getDatabase();
    const tx = db.transaction('personal_context', 'readwrite');
    for (const [key, value] of Object.entries(settingsObj)) {
      await tx.store.put({ key, value });
    }
    await tx.done;
  },

  // --- Provider Configs ---
  async getProviderConfigs() {
    const db = await getDatabase();
    return db.getAll('provider_configs');
  },

  async saveProviderConfig(config) {
    const db = await getDatabase();
    await db.put('provider_configs', config);
  }
};
