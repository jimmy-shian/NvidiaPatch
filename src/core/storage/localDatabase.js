/**
 * Local-first IndexedDB Database with In-Memory fallback for Node/Unit Tests
 * Handles persistent storage for Conversations, Messages, Custom Skills, Context, Settings, and Context Summaries.
 */
import { openDB } from 'idb';

const DB_NAME = 'NvidiaPatchMobileDB';
const DB_VERSION = 2;

let dbPromise = null;

// In-Memory fallback store for environments without IndexedDB (e.g. Node.js unit test runner)
const memStores = {
  conversations: new Map(),
  messages: new Map(),
  user_skills: new Map(),
  personal_context: new Map(),
  provider_configs: new Map(),
  conversation_summaries: new Map()
};

const isIndexedDBAvailable = typeof indexedDB !== 'undefined';

export function getDatabase() {
  if (!isIndexedDBAvailable) {
    return null;
  }
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('conversations')) {
          const convStore = db.createObjectStore('conversations', { keyPath: 'id' });
          convStore.createIndex('updatedAt', 'updatedAt');
        }
        if (!db.objectStoreNames.contains('messages')) {
          const msgStore = db.createObjectStore('messages', { keyPath: 'id' });
          msgStore.createIndex('conversationId', 'conversationId');
          msgStore.createIndex('createdAt', 'createdAt');
        }
        if (!db.objectStoreNames.contains('user_skills')) {
          db.createObjectStore('user_skills', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('personal_context')) {
          db.createObjectStore('personal_context', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('provider_configs')) {
          db.createObjectStore('provider_configs', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('conversation_summaries')) {
          db.createObjectStore('conversation_summaries', { keyPath: 'conversationId' });
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
    if (!db) {
      const list = Array.from(memStores.conversations.values());
      return list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    }
    const list = await db.getAllFromIndex('conversations', 'updatedAt');
    return list.reverse();
  },

  async getConversation(id) {
    const db = await getDatabase();
    if (!db) return memStores.conversations.get(id) || null;
    return db.get('conversations', id);
  },

  async saveConversation(conv) {
    const updated = {
      ...conv,
      updatedAt: conv.updatedAt || Date.now()
    };
    const db = await getDatabase();
    if (!db) {
      memStores.conversations.set(updated.id, updated);
      return updated;
    }
    await db.put('conversations', updated);
    return updated;
  },

  async deleteConversation(id) {
    const db = await getDatabase();
    if (!db) {
      memStores.conversations.delete(id);
      memStores.conversation_summaries.delete(id);
      for (const [k, v] of memStores.messages.entries()) {
        if (v.conversationId === id) memStores.messages.delete(k);
      }
      return;
    }
    const tx = db.transaction(['conversations', 'messages', 'conversation_summaries'], 'readwrite');
    await tx.objectStore('conversations').delete(id);
    await tx.objectStore('conversation_summaries').delete(id);
    
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
    let list = [];
    if (!db) {
      list = Array.from(memStores.messages.values()).filter(m => m.conversationId === conversationId);
    } else {
      list = await db.getAllFromIndex('messages', 'conversationId', conversationId);
    }
    return list.sort((a, b) => {
      if (a.createdAt !== b.createdAt) {
        return a.createdAt - b.createdAt;
      }
      return (a.ordinal || 0) - (b.ordinal || 0);
    });
  },

  async saveMessage(msg) {
    const toSave = {
      id: msg.id || `msg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      createdAt: msg.createdAt || Date.now(),
      ordinal: msg.ordinal || 0,
      ...msg
    };
    const db = await getDatabase();
    if (!db) {
      memStores.messages.set(toSave.id, toSave);
      return toSave;
    }
    await db.put('messages', toSave);
    return toSave;
  },

  async saveMessages(msgs = []) {
    if (!msgs || msgs.length === 0) return [];
    const db = await getDatabase();
    const saved = [];
    if (!db) {
      msgs.forEach((m, i) => {
        const toSave = {
          id: m.id || `msg_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 7)}`,
          createdAt: m.createdAt || Date.now(),
          ordinal: m.ordinal ?? i,
          ...m
        };
        memStores.messages.set(toSave.id, toSave);
        saved.push(toSave);
      });
      return saved;
    }
    const tx = db.transaction('messages', 'readwrite');
    for (let i = 0; i < msgs.length; i++) {
      const m = msgs[i];
      const toSave = {
        id: m.id || `msg_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 7)}`,
        createdAt: m.createdAt || Date.now(),
        ordinal: m.ordinal ?? i,
        ...m
      };
      await tx.store.put(toSave);
      saved.push(toSave);
    }
    await tx.done;
    return saved;
  },

  async updateMessage(id, updates) {
    const db = await getDatabase();
    if (!db) {
      const existing = memStores.messages.get(id);
      if (!existing) return null;
      const updated = { ...existing, ...updates };
      memStores.messages.set(id, updated);
      return updated;
    }
    const existing = await db.get('messages', id);
    if (!existing) return null;
    const updated = { ...existing, ...updates };
    await db.put('messages', updated);
    return updated;
  },

  async deleteMessage(id) {
    const db = await getDatabase();
    if (!db) {
      memStores.messages.delete(id);
      return;
    }
    await db.delete('messages', id);
  },

  async deleteMessagesAfter(conversationId, targetCreatedAt) {
    const db = await getDatabase();
    if (!db) {
      for (const [k, v] of memStores.messages.entries()) {
        if (v.conversationId === conversationId && v.createdAt > targetCreatedAt) {
          memStores.messages.delete(k);
        }
      }
      return;
    }
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

  async cleanupOrphanedToolMessages(conversationId) {
    const db = await getDatabase();
    if (!db) {
      for (const [k, v] of memStores.messages.entries()) {
        if (v.conversationId === conversationId) {
          if (v.role === 'tool' || (v.role === 'assistant' && !v.content?.trim() && !v.thinkingContent?.trim() && (!v.toolExecutions || v.toolExecutions.length === 0))) {
            memStores.messages.delete(k);
          }
        }
      }
      return;
    }
    const tx = db.transaction('messages', 'readwrite');
    const msgIndex = tx.store.index('conversationId');
    let cursor = await msgIndex.openCursor(IDBKeyRange.only(conversationId));
    while (cursor) {
      const m = cursor.value;
      if (m.role === 'tool' || (m.role === 'assistant' && !m.content?.trim() && !m.thinkingContent?.trim() && (!m.toolExecutions || m.toolExecutions.length === 0))) {
        await cursor.delete();
      }
      cursor = await cursor.continue();
    }
    await tx.done;
  },

  // --- Context Summaries (Compression) ---
  async getConversationSummary(conversationId) {
    const db = await getDatabase();
    if (!db) return memStores.conversation_summaries.get(conversationId) || null;
    return db.get('conversation_summaries', conversationId);
  },

  async saveConversationSummary(summaryObj) {
    const record = {
      createdAt: Date.now(),
      ...summaryObj
    };
    const db = await getDatabase();
    if (!db) {
      memStores.conversation_summaries.set(summaryObj.conversationId, record);
      return;
    }
    await db.put('conversation_summaries', record);
  },

  async deleteConversationSummary(conversationId) {
    const db = await getDatabase();
    if (!db) {
      memStores.conversation_summaries.delete(conversationId);
      return;
    }
    await db.delete('conversation_summaries', conversationId);
  },

  // --- Custom Skills ---
  async getUserSkills() {
    const db = await getDatabase();
    if (!db) return Array.from(memStores.user_skills.values());
    return db.getAll('user_skills');
  },

  async saveUserSkill(skill) {
    const toSave = {
      ...skill,
      updatedAt: Date.now()
    };
    const db = await getDatabase();
    if (!db) {
      memStores.user_skills.set(toSave.id, toSave);
      return toSave;
    }
    await db.put('user_skills', toSave);
    return toSave;
  },

  async deleteUserSkill(id) {
    const db = await getDatabase();
    if (!db) {
      memStores.user_skills.delete(id);
      return;
    }
    await db.delete('user_skills', id);
  },

  // --- Personal Context ---
  async getContextSetting(key, defaultValue = '') {
    const db = await getDatabase();
    if (!db) {
      return memStores.personal_context.get(key)?.value ?? defaultValue;
    }
    const row = await db.get('personal_context', key);
    return row ? row.value : defaultValue;
  },

  async getAllContextSettings() {
    const db = await getDatabase();
    if (!db) {
      const result = {};
      for (const [k, v] of memStores.personal_context.entries()) {
        result[k] = v.value;
      }
      return result;
    }
    const rows = await db.getAll('personal_context');
    const result = {};
    for (const r of rows) {
      result[r.key] = r.value;
    }
    return result;
  },

  async saveContextSetting(key, value) {
    const db = await getDatabase();
    if (!db) {
      memStores.personal_context.set(key, { key, value });
      return;
    }
    await db.put('personal_context', { key, value });
  },

  async saveAllContextSettings(settingsObj) {
    const db = await getDatabase();
    if (!db) {
      for (const [key, value] of Object.entries(settingsObj)) {
        memStores.personal_context.set(key, { key, value });
      }
      return;
    }
    const tx = db.transaction('personal_context', 'readwrite');
    for (const [key, value] of Object.entries(settingsObj)) {
      await tx.store.put({ key, value });
    }
    await tx.done;
  },

  // --- Provider Configs ---
  async getProviderConfigs() {
    const db = await getDatabase();
    if (!db) return Array.from(memStores.provider_configs.values());
    return db.getAll('provider_configs');
  },

  async saveProviderConfig(config) {
    const db = await getDatabase();
    if (!db) {
      memStores.provider_configs.set(config.id, config);
      return;
    }
    await db.put('provider_configs', config);
  }
};
