/**
 * Storage Manager
 * 管理对话历史的存储、查询、更新和删除
 * 使用 chrome.storage.local 作为持久化存储
 */

const STORAGE_KEY = 'ai_chat_conversations';
const SETTINGS_KEY = 'ai_chat_settings';
const MAX_STORAGE_SIZE = 5 * 1024 * 1024; // 5MB

const DEFAULT_SETTINGS = {
  autoSave: false,
  exportFormat: 'markdown',
  maxConversations: 200
};

/**
 * 生成唯一ID
 */
function generateId() {
  return `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * 获取所有对话
 */
async function getAllConversations() {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    return result[STORAGE_KEY] || [];
  } catch (error) {
    console.error('[Storage] Failed to get conversations:', error);
    return [];
  }
}

/**
 * 获取单个对话
 */
async function getConversation(id) {
  const conversations = await getAllConversations();
  return conversations.find(conv => conv.id === id);
}

/**
 * 保存对话
 */
async function saveConversation(conversationData) {
  try {
    const conversations = await getAllConversations();
    
    // 生成ID和时间戳
    const conversation = {
      id: generateId(),
      title: conversationData.title || 'Untitled Conversation',
      content: conversationData.content || '',
      provider: conversationData.provider || 'unknown',
      timestamp: Date.now(),
      url: conversationData.url || window.location.href,
      conversationId: conversationData.conversationId || '',
      tags: conversationData.tags || [],
      isFavorite: conversationData.isFavorite || false,
      notes: conversationData.notes || '',
      messageCount: conversationData.messageCount || 0
    };

    conversations.push(conversation);
    
    // 检查存储容量
    await checkAndCleanupStorage(conversations);
    
    await chrome.storage.local.set({ [STORAGE_KEY]: conversations });
    
    console.log('[Storage] Conversation saved:', conversation.id);
    return conversation;
  } catch (error) {
    console.error('[Storage] Failed to save conversation:', error);
    throw error;
  }
}

/**
 * 更新对话
 */
async function updateConversation(id, updates) {
  try {
    const conversations = await getAllConversations();
    const index = conversations.findIndex(conv => conv.id === id);
    
    if (index === -1) {
      throw new Error(`Conversation ${id} not found`);
    }
    
    conversations[index] = {
      ...conversations[index],
      ...updates,
      id, // 保持ID不变
      modifiedAt: Date.now()
    };
    
    await chrome.storage.local.set({ [STORAGE_KEY]: conversations });
    
    console.log('[Storage] Conversation updated:', id);
    return conversations[index];
  } catch (error) {
    console.error('[Storage] Failed to update conversation:', error);
    throw error;
  }
}

/**
 * 删除对话
 */
async function deleteConversation(id) {
  try {
    const conversations = await getAllConversations();
    const filtered = conversations.filter(conv => conv.id !== id);
    
    await chrome.storage.local.set({ [STORAGE_KEY]: filtered });
    
    console.log('[Storage] Conversation deleted:', id);
    return true;
  } catch (error) {
    console.error('[Storage] Failed to delete conversation:', error);
    throw error;
  }
}

/**
 * 批量删除对话
 */
async function deleteConversations(ids) {
  try {
    const conversations = await getAllConversations();
    const filtered = conversations.filter(conv => !ids.includes(conv.id));
    
    await chrome.storage.local.set({ [STORAGE_KEY]: filtered });
    
    console.log('[Storage] Conversations deleted:', ids.length);
    return true;
  } catch (error) {
    console.error('[Storage] Failed to delete conversations:', error);
    throw error;
  }
}

/**
 * 查找重复对话（通过 conversationId）
 */
async function findDuplicate(conversationId) {
  if (!conversationId) return null;
  
  const conversations = await getAllConversations();
  return conversations.find(conv => conv.conversationId === conversationId);
}

/**
 * 搜索对话
 */
async function searchConversations(query, filters = {}) {
  const conversations = await getAllConversations();
  
  let results = conversations;
  
  // 关键词搜索
  if (query && query.trim()) {
    const lowerQuery = query.toLowerCase();
    results = results.filter(conv => 
      conv.title.toLowerCase().includes(lowerQuery) ||
      conv.content.toLowerCase().includes(lowerQuery) ||
      conv.notes.toLowerCase().includes(lowerQuery) ||
      conv.tags.some(tag => tag.toLowerCase().includes(lowerQuery))
    );
  }
  
  // 按平台筛选
  if (filters.provider) {
    results = results.filter(conv => conv.provider === filters.provider);
  }
  
  // 按收藏筛选
  if (filters.isFavorite !== undefined) {
    results = results.filter(conv => conv.isFavorite === filters.isFavorite);
  }
  
  // 按时间范围筛选
  if (filters.startDate) {
    results = results.filter(conv => conv.timestamp >= filters.startDate);
  }
  if (filters.endDate) {
    results = results.filter(conv => conv.timestamp <= filters.endDate);
  }
  
  // 按标签筛选
  if (filters.tags && filters.tags.length > 0) {
    results = results.filter(conv => 
      filters.tags.some(tag => conv.tags.includes(tag))
    );
  }
  
  // 排序（默认按时间倒序）
  results.sort((a, b) => b.timestamp - a.timestamp);
  
  return results;
}

/**
 * 获取统计信息
 */
async function getStatistics() {
  const conversations = await getAllConversations();
  
  const stats = {
    total: conversations.length,
    favorites: conversations.filter(c => c.isFavorite).length,
    byProvider: {},
    totalMessages: 0,
    oldestTimestamp: conversations.length > 0 ? Math.min(...conversations.map(c => c.timestamp)) : null,
    newestTimestamp: conversations.length > 0 ? Math.max(...conversations.map(c => c.timestamp)) : null,
    storageSize: 0
  };
  
  // 按平台统计
  conversations.forEach(conv => {
    stats.byProvider[conv.provider] = (stats.byProvider[conv.provider] || 0) + 1;
    stats.totalMessages += conv.messageCount || 0;
  });
  
  // 计算存储大小
  const storageData = await chrome.storage.local.get(null);
  stats.storageSize = JSON.stringify(storageData).length;
  stats.storageSizeKB = Math.round(stats.storageSize / 1024);
  stats.storageUsagePercent = Math.round((stats.storageSize / MAX_STORAGE_SIZE) * 100);
  
  return stats;
}

/**
 * 检查并清理存储空间
 */
async function checkAndCleanupStorage(conversations) {
  const size = JSON.stringify(conversations).length;
  const usagePercent = (size / MAX_STORAGE_SIZE) * 100;
  
  if (usagePercent > 90) {
    console.warn('[Storage] Storage usage above 90%, cleaning up...');
    
    // 删除最旧的非收藏对话
    conversations.sort((a, b) => b.timestamp - a.timestamp);
    const nonFavorites = conversations.filter(c => !c.isFavorite);
    
    if (nonFavorites.length > 0) {
      // 删除最旧的10%
      const toRemove = Math.ceil(nonFavorites.length * 0.1);
      const toDelete = nonFavorites.slice(-toRemove).map(c => c.id);
      
      console.log(`[Storage] Auto-deleting ${toRemove} old conversations`);
      
      return conversations.filter(c => !toDelete.includes(c.id));
    }
  }
  
  return conversations;
}

/**
 * 清空所有对话
 */
async function clearAllConversations() {
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: [] });
    console.log('[Storage] All conversations cleared');
    return true;
  } catch (error) {
    console.error('[Storage] Failed to clear conversations:', error);
    throw error;
  }
}

/**
 * 导出所有数据
 */
async function exportAllData() {
  const conversations = await getAllConversations();
  const settings = await getSettings();
  const stats = await getStatistics();
  
  return {
    version: '1.0',
    exportDate: new Date().toISOString(),
    conversations: conversations,
    settings: settings,
    statistics: stats
  };
}

/**
 * 导入数据
 */
async function importData(data, mergeStrategy = 'skip') {
  try {
    if (!data || !data.conversations || !Array.isArray(data.conversations)) {
      throw new Error('Invalid import data format');
    }
    
    const existingConversations = await getAllConversations();
    const results = {
      imported: 0,
      skipped: 0,
      updated: 0,
      errors: []
    };
    
    for (const convData of data.conversations) {
      try {
        // 检查是否存在重复
        const duplicate = await findDuplicate(convData.conversationId);
        
        if (duplicate) {
          if (mergeStrategy === 'skip') {
            results.skipped++;
            continue;
          } else if (mergeStrategy === 'update') {
            await updateConversation(duplicate.id, convData);
            results.updated++;
            continue;
          }
        }
        
        // 保存新对话
        await saveConversation(convData);
        results.imported++;
        
      } catch (error) {
        results.errors.push({
          conversation: convData.title,
          error: error.message
        });
      }
    }
    
    return results;
  } catch (error) {
    console.error('[Storage] Import failed:', error);
    throw error;
  }
}

/**
 * 获取设置
 */
async function getSettings() {
  try {
    const result = await chrome.storage.local.get(SETTINGS_KEY);
    return { ...DEFAULT_SETTINGS, ...(result[SETTINGS_KEY] || {}) };
  } catch (error) {
    console.error('[Storage] Failed to get settings:', error);
    return DEFAULT_SETTINGS;
  }
}

/**
 * 保存设置
 */
async function saveSettings(settings) {
  try {
    await chrome.storage.local.set({ 
      [SETTINGS_KEY]: { ...DEFAULT_SETTINGS, ...settings } 
    });
    console.log('[Storage] Settings saved');
    return true;
  } catch (error) {
    console.error('[Storage] Failed to save settings:', error);
    throw error;
  }
}

/**
 * 获取所有标签
 */
async function getAllTags() {
  const conversations = await getAllConversations();
  const tags = new Set();
  
  conversations.forEach(conv => {
    conv.tags.forEach(tag => tags.add(tag));
  });
  
  return Array.from(tags).sort();
}

// 导出所有函数
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    getAllConversations,
    getConversation,
    saveConversation,
    updateConversation,
    deleteConversation,
    deleteConversations,
    findDuplicate,
    searchConversations,
    getStatistics,
    clearAllConversations,
    exportAllData,
    importData,
    getSettings,
    saveSettings,
    getAllTags
  };
}
