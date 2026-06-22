import React, { useState, useEffect, useRef } from 'react';
import { 
  Activity, Key, Cpu, FileText, Plus, Trash, Copy, Check, 
  RotateCw, ShieldAlert, CheckCircle, AlertTriangle, ArrowUp, 
  ArrowDown, RefreshCw, X, Play, CopyCheck
} from 'lucide-react';

export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [keys, setKeys] = useState([]);
  const [newKey, setNewKey] = useState('');
  const [models, setModels] = useState([]);
  const [availableModels, setAvailableModels] = useState([]);
  const [rules, setRules] = useState([]);
  const [newRuleTitle, setNewRuleTitle] = useState('');
  const [newRuleContent, setNewRuleContent] = useState('');
  const [stats, setStats] = useState({
    hourly: [],
    keysCount: 0,
    activeKeysCount: 0,
    modelsCount: 0
  });
  const [logs, setLogs] = useState([]);
  const [isSyncingModels, setIsSyncingModels] = useState(false);
  const [isTestingKeys, setIsTestingKeys] = useState(false);
  const [copiedId, setCopiedId] = useState(null);
  const [apiError, setApiError] = useState('');

  // 擴充 state 用於模型同步時間、搜尋與篩選
  const [lastSyncTime, setLastSyncTime] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('ALL');

  // 新增狀態用於 Playground 模型測試
  const [selectedTestModel, setSelectedTestModel] = useState('');
  const [chatHistory, setChatHistory] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [isChatting, setIsChatting] = useState(false);
  const chatEndRef = useRef(null);

  // 自動捲動到聊天最下方
  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatHistory]);

  // 1. 定時輪詢 Log 與 Stats
  useEffect(() => {
    fetchData();
    const interval = setInterval(() => {
      fetchLogsAndStats();
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  // 2. 當切換至金鑰管理分頁，重新取得 API Keys 資料以顯示最新狀態
  useEffect(() => {
    if (activeTab === 'keys') {
      fetchKeys();
    }
  }, [activeTab]);

  // 3. 當切換至模型排序分頁，若列表為空且有 active 金鑰，自動在背景同步一次
  useEffect(() => {
    const hasActiveKey = keys.some(k => k.status === 'active');
    if (activeTab === 'models' && availableModels.length === 0 && hasActiveKey && !isSyncingModels) {
      console.log('自動載入模型列表...');
      handleSyncModelsSilently();
    }
  }, [activeTab, availableModels.length, keys]);

  const handleSyncModelsSilently = async () => {
    setIsSyncingModels(true);
    try {
      const res = await fetch('http://localhost:4000/api/models/sync', { method: 'POST' });
      if (res.ok) {
        fetchData();
      }
    } catch (err) {
      console.error('背景自動同步模型出錯:', err);
    } finally {
      setIsSyncingModels(false);
    }
  };

  const formatSyncTime = (isoString) => {
    if (!isoString) return '無';
    try {
      const date = new Date(isoString);
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`;
    } catch (e) {
      return '無';
    }
  };

  const handleSendTestMessage = async (e) => {
    if (e) e.preventDefault();
    if (!chatInput.trim() || !selectedTestModel || isChatting) return;

    const userMsg = { role: 'user', content: chatInput.trim() };
    const assistantMsg = { role: 'assistant', content: '' };

    setChatHistory(prev => [...prev, userMsg, assistantMsg]);
    const targetMessages = [...chatHistory, userMsg];
    const originalInput = chatInput.trim();
    setChatInput('');
    setIsChatting(true);

    try {
      const res = await fetch('http://localhost:4000/api/test/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: selectedTestModel,
          messages: targetMessages,
          stream: true
        })
      });

      if (!res.ok) {
        const text = await res.text();
        setChatHistory(prev => {
          const updated = [...prev];
          updated[updated.length - 1].content = `錯誤 (HTTP ${res.status}): ${text || '無法測試此模型'}`;
          return updated;
        });
        setIsChatting(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop(); // 保留不完整的一行

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('data:')) {
            const dataStr = trimmed.slice(5).trim();
            if (dataStr === '[DONE]') continue;
            try {
              const chunk = JSON.parse(dataStr);
              if (chunk.choices && chunk.choices[0].delta && chunk.choices[0].delta.content) {
                const deltaText = chunk.choices[0].delta.content;
                setChatHistory(prev => {
                  const updated = [...prev];
                  updated[updated.length - 1].content += deltaText;
                  return updated;
                });
              }
            } catch (err) {
              // 忽略 JSON 解析異常
            }
          }
        }
      }
    } catch (err) {
      setChatHistory(prev => {
        const updated = [...prev];
        updated[updated.length - 1].content = `連線異常: ${err.message}`;
        return updated;
      });
    } finally {
      setIsChatting(false);
    }
  };

  const fetchData = async () => {
    try {
      const keysRes = await fetch('http://localhost:4000/api/keys');
      if (keysRes.ok) setKeys(await keysRes.json());

      const modelsRes = await fetch('http://localhost:4000/api/models');
      if (modelsRes.ok) setModels(await modelsRes.json());

      const availModelsRes = await fetch('http://localhost:4000/api/models/available');
      if (availModelsRes.ok) {
        const data = await availModelsRes.json();
        setAvailableModels(data.models || []);
        setLastSyncTime(data.lastSyncTime || null);
        if (data.models && data.models.length > 0) {
          setSelectedTestModel(prev => prev || data.models[0].id);
        }
      }

      const rulesRes = await fetch('http://localhost:4000/api/rules');
      if (rulesRes.ok) setRules(await rulesRes.json());

      fetchLogsAndStats();
    } catch (err) {
      setApiError('無法連接到 Gateway 服務。請確保 Electron 背景服務已成功啟動！');
    }
  };

  const fetchLogsAndStats = async () => {
    try {
      const statsRes = await fetch('http://localhost:4000/api/stats');
      if (statsRes.ok) setStats(await statsRes.json());

      const logsRes = await fetch('http://localhost:4000/api/logs');
      if (logsRes.ok) setLogs(await logsRes.json());
      
      setApiError(''); // 成功連線，清除錯誤
    } catch (err) {
      // 避免頻繁報錯
    }
  };

  const fetchKeys = async () => {
    try {
      const keysRes = await fetch('http://localhost:4000/api/keys');
      if (keysRes.ok) setKeys(await keysRes.json());
    } catch (err) {
      console.error('取得金鑰資料失敗:', err);
    }
  };

  // --- API Key 操作 ---
  const handleAddKey = async (e) => {
    e.preventDefault();
    if (!newKey.trim()) return;
    try {
      const res = await fetch('http://localhost:4000/api/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: newKey.trim() })
      });
      if (res.ok) {
        setNewKey('');
        fetchData();
      } else {
        const data = await res.json();
        alert(`新增失敗: ${data.error}`);
      }
    } catch (err) {
      alert('新增金鑰出錯');
    }
  };

  const handleDeleteKey = async (id) => {
    if (!confirm('確認要刪除此 API Key？')) return;
    try {
      const res = await fetch(`http://localhost:4000/api/keys/${id}`, {
        method: 'DELETE'
      });
      if (res.ok) fetchData();
    } catch (err) {
      alert('刪除金鑰出錯');
    }
  };

  const handleTestKeys = async () => {
    setIsTestingKeys(true);
    try {
      const res = await fetch('http://localhost:4000/api/keys/test', { method: 'POST' });
      if (res.ok) {
        const results = await res.json();
        const failures = results.filter(r => !r.success);
        if (failures.length > 0) {
          alert(`一鍵測試完成！共有 ${failures.length} 把金鑰測試失敗 (已自動設為 Inactive)，請檢查列表中的錯誤原因！`);
        } else {
          alert('一鍵測試完成！所有金鑰皆測試成功且健康運行！');
        }
      } else {
        alert('連線測試出錯');
      }
      fetchData();
    } catch (err) {
      alert('連線測試出錯');
    } finally {
      setIsTestingKeys(false);
    }
  };

  // --- 模型排序與同步 ---
  const handleSyncModels = async () => {
    setIsSyncingModels(true);
    try {
      const res = await fetch('http://localhost:4000/api/models/sync', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        alert(`同步成功！已獲取 ${data.count} 個 NVIDIA NIM 模型。`);
        fetchData();
      } else {
        const data = await res.json();
        alert(`同步失敗: ${data.error}`);
      }
    } catch (err) {
      alert('同步模型時伺服器無回應');
    } finally {
      setIsSyncingModels(false);
    }
  };

  const handleAddModelToPriority = (modelId) => {
    if (models.some(m => m.model_id === modelId)) return;
    const updated = [...models.map(m => m.model_id), modelId];
    saveModelPriorities(updated);
  };

  const handleRemoveModelFromPriority = (modelId) => {
    const updated = models.map(m => m.model_id).filter(id => id !== modelId);
    saveModelPriorities(updated);
  };

  const handleMovePriority = (index, direction) => {
    const updated = models.map(m => m.model_id);
    if (direction === 'up' && index > 0) {
      const temp = updated[index];
      updated[index] = updated[index - 1];
      updated[index - 1] = temp;
    } else if (direction === 'down' && index < updated.length - 1) {
      const temp = updated[index];
      updated[index] = updated[index + 1];
      updated[index + 1] = temp;
    }
    saveModelPriorities(updated);
  };

  const saveModelPriorities = async (modelIds) => {
    try {
      const res = await fetch('http://localhost:4000/api/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ models: modelIds })
      });
      if (res.ok) fetchData();
    } catch (err) {
      alert('儲存優先順序失敗');
    }
  };

  // --- Rules 操作 ---
  const handleAddRule = async (e) => {
    e.preventDefault();
    if (!newRuleTitle.trim() || !newRuleContent.trim()) return;
    try {
      const res = await fetch('http://localhost:4000/api/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newRuleTitle.trim(), content: newRuleContent.trim() })
      });
      if (res.ok) {
        setNewRuleTitle('');
        setNewRuleContent('');
        fetchData();
        if (window.electronAPI && window.electronAPI.notifyRulesUpdated) {
          window.electronAPI.notifyRulesUpdated();
        }
      }
    } catch (err) {
      alert('新增規則出錯');
    }
  };

  const handleDeleteRule = async (id) => {
    if (!confirm('確認要刪除此規則？')) return;
    try {
      const res = await fetch(`http://localhost:4000/api/rules/${id}`, {
        method: 'DELETE'
      });
      if (res.ok) {
        fetchData();
        if (window.electronAPI && window.electronAPI.notifyRulesUpdated) {
          window.electronAPI.notifyRulesUpdated();
        }
      }
    } catch (err) {
      alert('刪除規則出錯');
    }
  };

  const copyToClipboard = (text, id) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // 計算成功率
  const calculateSuccessRate = () => {
    if (stats.hourly.length === 0) return '100%';
    const totalRequests = stats.hourly.reduce((acc, curr) => acc + curr.request_count, 0);
    const totalSuccess = stats.hourly.reduce((acc, curr) => acc + curr.success_count, 0);
    if (totalRequests === 0) return '100%';
    return `${Math.round((totalSuccess / totalRequests) * 100)}%`;
  };

  const getTotalRequests = () => {
    return stats.hourly.reduce((acc, curr) => acc + curr.request_count, 0);
  };

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      {/* 側邊導航 */}
      <div className="glass-panel" style={{ width: '240px', margin: '12px 6px 12px 12px', display: 'flex', flexDirection: 'column', padding: '20px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '32px', paddingLeft: '8px' }}>
          <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'linear-gradient(135deg, #10b981 0%, #3b82f6 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Activity size={18} color="white" />
          </div>
          <div>
            <h1 style={{ fontSize: '17px', fontWeight: '800', fontFamily: 'Outfit', letterSpacing: '0.5px' }}>NVIDIA GATEWAY</h1>
            <span style={{ fontSize: '13px', color: '#10b981', fontWeight: '700' }}>v1.0.0 Stable</span>
          </div>
        </div>

        <nav style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1 }}>
          <button 
            className={`btn ${activeTab === 'dashboard' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ justifyContent: 'flex-start', width: '100%' }}
            onClick={() => setActiveTab('dashboard')}
          >
            <Activity size={16} />
            <span>運行狀態</span>
          </button>
          <button 
            className={`btn ${activeTab === 'keys' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ justifyContent: 'flex-start', width: '100%' }}
            onClick={() => setActiveTab('keys')}
          >
            <Key size={16} />
            <span>金鑰管理 ({stats.activeKeysCount}/{stats.keysCount})</span>
          </button>
          <button 
            className={`btn ${activeTab === 'models' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ justifyContent: 'flex-start', width: '100%' }}
            onClick={() => setActiveTab('models')}
          >
            <Cpu size={16} />
            <span>模型排序 ({stats.modelsCount})</span>
          </button>
          <button 
            className={`btn ${activeTab === 'playground' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ justifyContent: 'flex-start', width: '100%' }}
            onClick={() => setActiveTab('playground')}
          >
            <Play size={16} />
            <span>模型測試 (Playground)</span>
          </button>
          <button 
            className={`btn ${activeTab === 'rules' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ justifyContent: 'flex-start', width: '100%' }}
            onClick={() => setActiveTab('rules')}
          >
            <FileText size={16} />
            <span>規範快捷 ({rules.length})</span>
          </button>
        </nav>

        {apiError && (
          <div className="glass-panel badge-inactive" style={{ padding: '12px', fontSize: '13px', borderRadius: '8px', marginTop: '12px', whiteSpace: 'normal', lineHeight: '1.4' }}>
            <ShieldAlert size={14} style={{ marginRight: '6px', flexShrink: 0 }} />
            {apiError}
          </div>
        )}
      </div>

      {/* 主工作區 */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', margin: '12px 12px 12px 6px', overflow: 'hidden' }}>
        
        {/* Dashboard 頁面 */}
        {activeTab === 'dashboard' && (
          <div className="animate-fade-in" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '16px', overflow: 'hidden' }}>
            {/* 核心卡片欄 */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
              <div 
                className="glass-panel" 
                style={{ 
                  padding: '16px', 
                  display: 'flex', 
                  flexDirection: 'column', 
                  gap: '8px', 
                  cursor: 'pointer',
                  transition: 'all 0.2s ease'
                }}
                onClick={() => copyToClipboard('http://127.0.0.1:4000/v1', 'gateway_endpoint')}
                onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.02)'}
                onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1.0)'}
                title="點擊複製 Gateway Endpoint"
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>Gateway Endpoint</span>
                  {copiedId === 'gateway_endpoint' ? (
                    <span style={{ fontSize: '13px', color: '#10b981', display: 'flex', alignItems: 'center', gap: '2px' }}>
                      <Check size={12} />已複製
                    </span>
                  ) : (
                    <Copy size={12} style={{ color: 'var(--text-muted)' }} />
                  )}
                </div>
                <span style={{ fontSize: '17px', fontWeight: '700', color: '#10b981', fontFamily: 'Outfit' }}>http://127.0.0.1:4000/v1</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#10b981' }}></div>
                  <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>點擊複製 (Port 4000)</span>
                </div>
              </div>

              <div className="glass-panel" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <span style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>活躍 API 金鑰 pool</span>
                <span style={{ fontSize: '26px', fontWeight: '800', fontFamily: 'Outfit' }}>
                  {stats.activeKeysCount} <span style={{ fontSize: '16px', color: 'var(--text-secondary)', fontWeight: '400' }}>/ {stats.keysCount} 健康</span>
                </span>
                <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>429 自動金鑰輪詢備載</span>
              </div>

              <div className="glass-panel" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <span style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>近 24 小時請求量 / 成功率</span>
                <span style={{ fontSize: '26px', fontWeight: '800', fontFamily: 'Outfit' }}>
                  {getTotalRequests()} <span style={{ fontSize: '16px', color: '#10b981', fontWeight: '600' }}>({calculateSuccessRate()})</span>
                </span>
                <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>所有 5xx / 逾時皆觸發降級</span>
              </div>

              <div className="glass-panel" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <span style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>第一順位模型</span>
                <span style={{ fontSize: '16px', fontWeight: '700', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }} title={models[0]?.model_id || '未設定'}>
                  {models[0] ? models[0].model_id.split('/').pop() : '未設定'}
                </span>
                <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>優先嘗試順位 1 模型</span>
              </div>
            </div>

            {/* 編輯器自訂提供商整合設定引導 */}
            <div className="glass-panel" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <span style={{ fontSize: '16px', fontWeight: '700', color: '#10b981' }}>⚙️ 編輯器整合設定指引 (相容 OpenAI 接口之軟體如 Cline / Cursor / Double / Roo Code)</span>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px' }}>
                <div 
                  style={{ 
                    background: 'rgba(0,0,0,0.2)', 
                    padding: '12px', 
                    borderRadius: '8px', 
                    position: 'relative', 
                    border: '1px solid rgba(255,255,255,0.03)',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease'
                  }}
                  onClick={() => copyToClipboard('myself', 'prov_id')}
                  onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.02)'}
                  onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1.0)'}
                  title="點擊複製提供商 ID"
                >
                  <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>提供商 ID (Provider ID)</div>
                  <div style={{ fontSize: '15px', fontWeight: '600', marginTop: '6px', fontFamily: 'monospace' }}>myself</div>
                  <div 
                    className="btn btn-secondary" 
                    style={{ position: 'absolute', right: '6px', top: '6px', padding: '4px 8px', fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  >
                    {copiedId === 'prov_id' ? <Check size={12} /> : <Copy size={12} />}
                  </div>
                </div>
                <div 
                  style={{ 
                    background: 'rgba(0,0,0,0.2)', 
                    padding: '12px', 
                    borderRadius: '8px', 
                    position: 'relative', 
                    border: '1px solid rgba(255,255,255,0.03)',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease'
                  }}
                  onClick={() => copyToClipboard('http://127.0.0.1:4000/v1', 'prov_url')}
                  onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.02)'}
                  onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1.0)'}
                  title="點擊複製基礎 URL"
                >
                  <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>基礎 URL (Base URL)</div>
                  <div style={{ fontSize: '15px', fontWeight: '600', marginTop: '6px', fontFamily: 'monospace' }}>http://127.0.0.1:4000/v1</div>
                  <div 
                    className="btn btn-secondary" 
                    style={{ position: 'absolute', right: '6px', top: '6px', padding: '4px 8px', fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  >
                    {copiedId === 'prov_url' ? <Check size={12} /> : <Copy size={12} />}
                  </div>
                </div>
                <div 
                  style={{ 
                    background: 'rgba(0,0,0,0.2)', 
                    padding: '12px', 
                    borderRadius: '8px', 
                    position: 'relative', 
                    border: '1px solid rgba(255,255,255,0.03)',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease'
                  }}
                  onClick={() => copyToClipboard('any-key', 'prov_key')}
                  onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.02)'}
                  onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1.0)'}
                  title="點擊複製金鑰"
                >
                  <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>API 金鑰 (API Key)</div>
                  <div style={{ fontSize: '15px', fontWeight: '600', marginTop: '6px', fontFamily: 'monospace' }}>any-key</div>
                  <div 
                    className="btn btn-secondary" 
                    style={{ position: 'absolute', right: '6px', top: '6px', padding: '4px 8px', fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  >
                    {copiedId === 'prov_key' ? <Check size={12} /> : <Copy size={12} />}
                  </div>
                </div>
                <div 
                  style={{ 
                    background: 'rgba(0,0,0,0.2)', 
                    padding: '12px', 
                    borderRadius: '8px', 
                    position: 'relative', 
                    border: '1px solid rgba(255,255,255,0.03)',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease'
                  }}
                  onClick={() => copyToClipboard('patcher-main', 'prov_model')}
                  onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.02)'}
                  onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1.0)'}
                  title="點擊複製模型 ID"
                >
                  <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>模型 ID (Model ID)</div>
                  <div style={{ fontSize: '15px', fontWeight: '600', marginTop: '6px', fontFamily: 'monospace' }}>patcher-main</div>
                  <div 
                    className="btn btn-secondary" 
                    style={{ position: 'absolute', right: '6px', top: '6px', padding: '4px 8px', fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  >
                    {copiedId === 'prov_model' ? <Check size={12} /> : <Copy size={12} />}
                  </div>
                </div>
              </div>
              <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
                💡 註：在編輯器的自訂提供商（OpenAI 相容）設定中填入上方數值即可。對外模型 ID 可任意填寫，Gateway 將在轉發時自動重寫為您在「模型排序」中配置的第一順位 NVIDIA NIM 模型。
              </span>
            </div>

            {/* 圖表與統計 */}
            <div className="glass-panel" style={{ padding: '20px', flex: '1', minHeight: '180px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '16px', fontWeight: '700' }}>近 24 小時每小時流量分佈</span>
                <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>資料庫存儲 (SQLite)</span>
              </div>
              <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end', gap: '8px', padding: '10px 0' }}>
                {stats.hourly.length === 0 ? (
                  <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', color: 'var(--text-muted)', fontSize: '15px' }}>
                    目前尚無請求數據
                  </div>
                ) : (
                  stats.hourly.map((h, i) => {
                    const maxRequests = Math.max(...stats.hourly.map(x => x.request_count), 1);
                    const heightPercent = `${Math.max((h.request_count / maxRequests) * 100, 5)}%`;
                    const hourText = h.hour.split(' ')[1]; // 取出 HH:00
                    return (
                      <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', height: '100%' }}>
                        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'flex-end' }}>
                          <div 
                            style={{ 
                              width: '100%', 
                              height: heightPercent, 
                              background: 'linear-gradient(to top, rgba(16, 185, 129, 0.2) 0%, rgba(16, 185, 129, 0.8) 100%)', 
                              borderRadius: '4px 4px 0 0',
                              transition: 'height 0.3s ease',
                              position: 'relative'
                            }}
                            title={`時間: ${h.hour}\n總請求: ${h.request_count}\n成功: ${h.success_count}\n失敗: ${h.error_count}`}
                          ></div>
                        </div>
                        <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{hourText}</span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Gateway 即時活動日誌 */}
            <div className="glass-panel" style={{ flex: '1.5', padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px', overflow: 'hidden' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <RefreshCw size={14} className={logs.length > 0 ? 'animate-spin' : ''} style={{ animationDuration: '3s', color: '#10b981' }} />
                  <span style={{ fontSize: '16px', fontWeight: '700' }}>Gateway 即時轉發日誌 (最多 100 筆)</span>
                </div>
                <button className="btn btn-secondary" style={{ padding: '6px 10px', fontSize: '13px' }} onClick={fetchLogsAndStats}>
                  手動刷新
                </button>
              </div>

              <div style={{ flex: 1, overflowY: 'auto', background: 'rgba(0, 0, 0, 0.2)', borderRadius: '8px', border: '1px solid var(--border-color)', padding: '10px' }}>
                {logs.length === 0 ? (
                  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', color: 'var(--text-muted)', fontSize: '15px' }}>
                    等待 Cline/OpenCode 連線請求，或目前無轉發日誌。
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {logs.map((log, index) => {
                      let logColor = '#fff';
                      let icon = 'ℹ️';
                      if (log.type === 'success') { logColor = '#34d399'; icon = '✅'; }
                      else if (log.type === 'warning') { logColor = '#fbbf24'; icon = '⚠️'; }
                      else if (log.type === 'error') { logColor = '#f87171'; icon = '❌'; }
                      return (
                        <div key={index} style={{ fontSize: '14px', display: 'flex', gap: '8px', borderBottom: '1px solid rgba(255,255,255,0.02)', paddingBottom: '4px', lineHeight: '1.4' }}>
                          <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>[{log.timestamp.substring(11, 19)}]</span>
                          <span style={{ flexShrink: 0 }}>{icon}</span>
                          <span style={{ color: logColor, wordBreak: 'break-all' }}>{log.message}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* API Keys 管理頁面 */}
        {activeTab === 'keys' && (
          <div className="glass-panel animate-fade-in" style={{ flex: 1, padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px', overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h2 style={{ fontSize: '20px', fontWeight: '800', fontFamily: 'Outfit' }}>NVIDIA NIM API Keys 管理池</h2>
                <p style={{ fontSize: '15px', color: 'var(--text-secondary)', marginTop: '4px' }}>對應 patcher-main，在 429 時自動按序冷卻並切換 Key。</p>
              </div>
              <div style={{ display: 'flex', gap: '10px' }}>
                <button 
                  className="btn btn-secondary" 
                  onClick={handleTestKeys}
                  disabled={isTestingKeys || keys.length === 0}
                >
                  <RefreshCw size={14} className={isTestingKeys ? 'animate-spin' : ''} />
                  <span>{isTestingKeys ? '測試中...' : '一鍵連線測試所有 Key'}</span>
                </button>
              </div>
            </div>

            {/* 新增 Key 表單 */}
            <form onSubmit={handleAddKey} style={{ display: 'flex', gap: '10px' }}>
              <input 
                type="password" 
                placeholder="貼入 nvapi- 開頭的 NVIDIA NIM API Key" 
                className="input" 
                style={{ flex: 1 }}
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
              />
              <button type="submit" className="btn btn-primary">
                <Plus size={16} />
                <span>新增金鑰</span>
              </button>
            </form>

            {/* Keys 列表表格 */}
            <div style={{ flex: 1, overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: '8px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '15px', textAlign: 'left' }}>
                <thead>
                  <tr style={{ background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid var(--border-color)' }}>
                    <th style={{ padding: '12px' }}>API Key</th>
                    <th style={{ padding: '12px' }}>目前狀態</th>
                    <th style={{ padding: '12px' }}>連續失敗</th>
                    <th style={{ padding: '12px' }}>總錯誤數</th>
                    <th style={{ padding: '12px' }}>最後使用時間</th>
                    <th style={{ padding: '12px' }}>錯誤原因 / 提示</th>
                    <th style={{ padding: '12px', textAlign: 'center' }}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {keys.length === 0 ? (
                    <tr>
                      <td colSpan="7" style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)' }}>
                        目前沒有金鑰，請新增一把金鑰以啟動服務！
                      </td>
                    </tr>
                  ) : (
                    keys.map((k) => {
                      let badgeClass = 'badge-active';
                      let statusText = '健康 (Active)';
                      if (k.status === 'cooldown') {
                        badgeClass = 'badge-cooldown';
                        const secLeft = Math.max(0, Math.round((new Date(k.cooldown_until) - new Date()) / 1000));
                        statusText = `冷卻中 (${secLeft}s)`;
                      } else if (k.status === 'inactive') {
                        badgeClass = 'badge-inactive';
                        statusText = 'Revoked / 損壞';
                      }

                      return (
                        <tr key={k.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                          <td style={{ padding: '12px', fontFamily: 'monospace' }}>
                            nvapi-...{k.key_value.substring(k.key_value.length - 12)}
                          </td>
                          <td style={{ padding: '12px' }}>
                            <span className={`badge ${badgeClass}`}>{statusText}</span>
                          </td>
                          <td style={{ padding: '12px', color: k.consecutive_failures > 0 ? '#fbbf24' : 'inherit' }}>
                            {k.consecutive_failures}
                          </td>
                          <td style={{ padding: '12px', color: k.total_errors > 0 ? '#f87171' : 'inherit' }}>
                            {k.total_errors}
                          </td>
                          <td style={{ padding: '12px', color: 'var(--text-secondary)' }}>
                            {k.last_used_at ? k.last_used_at.substring(11, 19) : '未使用'}
                          </td>
                          <td style={{ padding: '12px', color: '#f87171', fontSize: '13px', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={k.last_error_message}>
                            {k.last_error_message || '--'}
                          </td>
                          <td style={{ padding: '12px', textAlign: 'center' }}>
                            <button className="btn btn-danger" style={{ padding: '6px 8px' }} onClick={() => handleDeleteKey(k.id)}>
                              <Trash size={12} />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 模型優先排序頁面 */}
        {activeTab === 'models' && (
          <div className="glass-panel animate-fade-in" style={{ flex: 1, padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px', overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h2 style={{ fontSize: '20px', fontWeight: '800', fontFamily: 'Outfit' }}>NVIDIA Models 順位與自動偵測</h2>
                <p style={{ fontSize: '15px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                  對應 patcher-main，在 5xx 或 Timeout 時自動切換模型，且下次新請求永遠從順位 1 開始嘗試。
                </p>
                {lastSyncTime && (
                  <span style={{ fontSize: '13px', color: '#10b981', fontWeight: '600', marginTop: '6px', display: 'inline-block' }}>
                    🔄 最後更新時間：{formatSyncTime(lastSyncTime)}
                  </span>
                )}
              </div>
              <button 
                className="btn btn-secondary" 
                onClick={handleSyncModels}
                disabled={isSyncingModels}
              >
                <RefreshCw size={14} className={isSyncingModels ? 'animate-spin' : ''} />
                <span>{isSyncingModels ? '正在向 NVIDIA NIM 同步...' : '同步 NVIDIA NIM 可用模型 (動態偵測)'}</span>
              </button>
            </div>

            <div style={{ flex: 1, display: 'flex', gap: '20px', overflow: 'hidden' }}>
              {/* 左側：當前配置優先級 (Priority List) */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '12px', height: '100%' }}>
                <h3 style={{ fontSize: '16px', fontWeight: '700' }}>⚙️ 當前模型順位 (1st &rarr; 2nd &rarr; 3rd)</h3>
                
                <div style={{ flex: 1, overflowY: 'auto', background: 'rgba(0,0,0,0.1)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {models.length === 0 ? (
                    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', color: 'var(--text-muted)', fontSize: '15px' }}>
                      尚未配置任何模型。請從右側可用列表中點擊「+」新增。
                    </div>
                  ) : (
                    models.map((m, index) => (
                      <div key={m.id} className="glass-panel" style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderLeft: `4px solid ${index === 0 ? '#10b981' : '#3b82f6'}` }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', maxWidth: '70%' }}>
                          <span style={{ fontSize: '13px', color: index === 0 ? '#10b981' : 'var(--text-secondary)', fontWeight: '700' }}>
                            第 {m.priority} 順位 {index === 0 ? '【主要 Primary】' : '【備用 Fallback】'}
                          </span>
                          <span style={{ fontSize: '15px', fontWeight: '600', wordBreak: 'break-all' }}>{m.model_id}</span>
                        </div>
                        <div style={{ display: 'flex', gap: '4px' }}>
                          <button className="btn btn-secondary" style={{ padding: '6px' }} disabled={index === 0} onClick={() => handleMovePriority(index, 'up')}>
                            <ArrowUp size={12} />
                          </button>
                          <button className="btn btn-secondary" style={{ padding: '6px' }} disabled={index === models.length - 1} onClick={() => handleMovePriority(index, 'down')}>
                            <ArrowDown size={12} />
                          </button>
                          <button className="btn btn-danger" style={{ padding: '6px' }} onClick={() => handleRemoveModelFromPriority(m.model_id)}>
                            <X size={12} />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* 右側：可用的 NVIDIA 模型庫 (Available Models) */}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '12px', height: '100%' }}>
                <h3 style={{ fontSize: '16px', fontWeight: '700' }}>🌐 NVIDIA NIM 雲端可用模型庫</h3>
                
                {/* 搜尋與分類篩選 */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <input 
                    type="text" 
                    placeholder="搜尋模型名稱或 ID..." 
                    className="input" 
                    style={{ width: '100%', padding: '8px 12px', fontSize: '15px' }}
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    {['ALL', 'Llama', 'Mistral', 'Gemma', 'Nemotron', 'Phi', 'MiniMax', 'Step', 'Other'].map(cat => (
                      <button 
                        key={cat}
                        className={`btn ${selectedCategory === cat ? 'btn-primary' : 'btn-secondary'}`}
                        style={{ padding: '4px 10px', fontSize: '13px', borderRadius: '6px' }}
                        onClick={() => setSelectedCategory(cat)}
                      >
                        {cat === 'ALL' ? '全部' : cat}
                      </button>
                    ))}
                  </div>
                </div>

                <div style={{ flex: 1, overflowY: 'auto', background: 'rgba(0,0,0,0.1)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {availableModels.length === 0 ? (
                    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', color: 'var(--text-muted)', fontSize: '15px', textAlign: 'center', padding: '20px' }}>
                      目前沒有同步下來的模型。請確認有 active 金鑰，並點擊右上方「同步」按鈕。
                    </div>
                  ) : (
                    (() => {
                      const getModelCategory = (modelId) => {
                        const id = modelId.toLowerCase();
                        if (id.includes('llama')) return 'Llama';
                        if (id.includes('mistral') || id.includes('mixtral')) return 'Mistral';
                        if (id.includes('gemma')) return 'Gemma';
                        if (id.includes('nemotron')) return 'Nemotron';
                        if (id.includes('phi')) return 'Phi';
                        if (id.includes('minimax') || id.includes('minimaxai')) return 'MiniMax';
                        if (id.includes('step')) return 'Step';
                        return 'Other';
                      };
                      
                      const filtered = availableModels.filter(am => {
                        const matchesSearch = am.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                                              am.id.toLowerCase().includes(searchTerm.toLowerCase());
                        const matchesCategory = selectedCategory === 'ALL' || getModelCategory(am.id) === selectedCategory;
                        return matchesSearch && matchesCategory;
                      });

                      if (filtered.length === 0) {
                        return (
                          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', color: 'var(--text-muted)', fontSize: '15px', textAlign: 'center', padding: '20px' }}>
                            沒有符合篩選條件的模型。
                          </div>
                        );
                      }

                      return filtered.map((am) => {
                        const isAdded = models.some(m => m.model_id === am.id);
                        return (
                          <div key={am.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: 'rgba(255,255,255,0.01)', border: '1px solid rgba(255,255,255,0.04)', borderRadius: '6px' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', maxWidth: '80%' }}>
                              <span style={{ fontSize: '14px', fontWeight: '600' }}>{am.name}</span>
                              <span style={{ fontSize: '12px', color: 'var(--text-muted)', wordBreak: 'break-all' }}>{am.id}</span>
                            </div>
                            <button 
                              className="btn btn-primary" 
                              style={{ padding: '4px 8px', fontSize: '13px' }}
                              disabled={isAdded}
                              onClick={() => handleAddModelToPriority(am.id)}
                            >
                              {isAdded ? '已加入' : '新增'}
                            </button>
                          </div>
                        );
                      });
                    })()
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 規範快捷複製頁面 */}
        {activeTab === 'rules' && (
          <div className="glass-panel animate-fade-in" style={{ flex: 1, padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px', overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h2 style={{ fontSize: '20px', fontWeight: '800', fontFamily: 'Outfit' }}>Editor Rules & 開發規範快捷鍵</h2>
                <p style={{ fontSize: '15px', color: 'var(--text-secondary)', marginTop: '4px' }}>一鍵複製高品質的 Agent/Cline 規則與 Commit 規範到您的編輯器中。</p>
              </div>
            </div>

            <div style={{ flex: 1, display: 'flex', gap: '20px', overflow: 'hidden' }}>
              {/* 左側：規則庫卡片列表 */}
              <div style={{ flex: 1.5, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '16px', paddingRight: '4px' }}>
                {rules.map((r) => (
                  <div key={r.id} className="glass-panel" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span className={`badge ${r.is_preset ? 'badge-active' : 'badge-cooldown'}`}>
                          {r.is_preset ? '系統內建' : '自訂規範'}
                        </span>
                        <h3 style={{ fontSize: '16px', fontWeight: '700' }}>{r.title}</h3>
                      </div>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button 
                          className="btn btn-primary" 
                          style={{ padding: '6px 12px', fontSize: '14px' }}
                          onClick={() => copyToClipboard(r.content, r.id)}
                        >
                          {copiedId === r.id ? <Check size={12} /> : <Copy size={12} />}
                          <span>{copiedId === r.id ? '已複製！' : '一鍵複製'}</span>
                        </button>
                        {!r.is_preset && (
                          <button className="btn btn-danger" style={{ padding: '6px' }} onClick={() => handleDeleteRule(r.id)}>
                            <Trash size={12} />
                          </button>
                        )}
                      </div>
                    </div>
                    <pre style={{ 
                       background: 'rgba(0,0,0,0.3)', 
                       padding: '12px', 
                       borderRadius: '6px', 
                       fontFamily: 'monospace', 
                       fontSize: '13.5px', 
                       whiteSpace: 'pre-wrap', 
                       wordBreak: 'break-all', 
                       border: '1px solid rgba(255,255,255,0.03)',
                       color: 'var(--text-secondary)',
                       lineHeight: '1.5'
                     }}>
                      {r.content}
                    </pre>
                  </div>
                ))}
              </div>

              {/* 右側：新增自訂規則 */}
              <div className="glass-panel" style={{ flex: 1, padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px', height: 'fit-content' }}>
                <h3 style={{ fontSize: '16px', fontWeight: '700' }}>➕ 建立自訂開發規範</h3>
                <form onSubmit={handleAddRule} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>規範標題</label>
                    <input 
                      type="text" 
                      placeholder="例如: Vue 團隊命名規範" 
                      className="input"
                      value={newRuleTitle}
                      onChange={(e) => setNewRuleTitle(e.target.value)}
                    />
                  </div>
                  
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>規則內文 (會複製進剪貼簿)</label>
                    <textarea 
                      placeholder="貼入您平常要丟給 AI Agent / Cline 的約束提示詞..." 
                      className="input" 
                      rows="10"
                      style={{ resize: 'vertical', fontFamily: 'monospace', fontSize: '14px' }}
                      value={newRuleContent}
                      onChange={(e) => setNewRuleContent(e.target.value)}
                    />
                  </div>

                  <button type="submit" className="btn btn-primary" style={{ marginTop: '4px' }}>
                    <Plus size={14} />
                    <span>新增至快捷面板</span>
                  </button>
                </form>
              </div>
            </div>
          </div>
        )}

        {/* 模型測試 Playground 頁面 */}
        {activeTab === 'playground' && (
          <div className="glass-panel animate-fade-in" style={{ flex: 1, padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px', overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h2 style={{ fontSize: '20px', fontWeight: '800', fontFamily: 'Outfit' }}>NVIDIA NIM 模型測試 Playground</h2>
                <p style={{ fontSize: '15px', color: 'var(--text-secondary)', marginTop: '4px' }}>可以直接選擇任一已同步的 NVIDIA 模型，快速進行對話發送與串流回應測試。</p>
              </div>
              <button 
                className="btn btn-secondary" 
                style={{ fontSize: '14px', padding: '8px 16px' }}
                onClick={() => setChatHistory([])}
                disabled={chatHistory.length === 0}
              >
                清空對話歷程
              </button>
            </div>

            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '16px', overflow: 'hidden' }}>
              {/* 模型選擇與狀態 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span style={{ fontSize: '15px', fontWeight: '700', color: 'var(--text-secondary)' }}>選擇測試模型:</span>
                <select 
                  className="input" 
                  style={{ minWidth: '320px', fontSize: '15px', padding: '8px 12px', background: 'rgba(15, 23, 42, 0.8)', cursor: 'pointer' }}
                  value={selectedTestModel}
                  onChange={(e) => setSelectedTestModel(e.target.value)}
                  disabled={isChatting}
                >
                  {availableModels.length === 0 ? (
                    <option value="">(無可用模型，請先點擊「同步」)</option>
                  ) : (
                    availableModels.map(m => (
                      <option key={m.id} value={m.id}>{m.name} ({m.id.split('/').shift()})</option>
                    ))
                  )}
                </select>
                {isChatting && (
                  <span style={{ fontSize: '13px', color: '#10b981', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <RefreshCw size={14} className="animate-spin" />
                    模型正在串流回應中...
                  </span>
                )}
              </div>

              {/* 聊天對話區域 */}
              <div style={{ 
                flex: 1, 
                overflowY: 'auto', 
                background: 'rgba(0, 0, 0, 0.25)', 
                borderRadius: '10px', 
                border: '1px solid var(--border-color)', 
                padding: '20px',
                display: 'flex',
                flexDirection: 'column',
                gap: '16px'
              }}>
                {chatHistory.length === 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '100%', color: 'var(--text-muted)', gap: '12px' }}>
                    <Cpu size={48} style={{ color: 'var(--border-color)' }} />
                    <span style={{ fontSize: '15px' }}>請在下方輸入訊息以測試選取的模型。所有測試將直接向 Gateway 發送。</span>
                  </div>
                ) : (
                  chatHistory.map((msg, index) => {
                    const isUser = msg.role === 'user';
                    return (
                      <div 
                        key={index} 
                        style={{ 
                          display: 'flex', 
                          justifyContent: isUser ? 'flex-end' : 'flex-start',
                          width: '100%'
                        }}
                      >
                        <div style={{ 
                          maxWidth: '75%', 
                          background: isUser ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)' : 'rgba(255,255,255,0.04)',
                          border: isUser ? 'none' : '1px solid var(--border-color)',
                          color: 'white',
                          padding: '12px 16px',
                          borderRadius: isUser ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                          fontSize: '15px',
                          lineHeight: '1.5',
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                          boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
                        }}>
                          <span style={{ fontSize: '12px', fontWeight: '700', opacity: 0.7, display: 'block', marginBottom: '6px' }}>
                            {isUser ? '👤 使用者 (User)' : `🤖 NIM 助手 (${selectedTestModel.split('/').pop()})`}
                          </span>
                          {msg.content || (isChatting && index === chatHistory.length - 1 ? 'Thinking...' : '')}
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={chatEndRef} />
              </div>

              {/* 輸入發送區域 */}
              <form onSubmit={handleSendTestMessage} style={{ display: 'flex', gap: '10px' }}>
                <input 
                  type="text" 
                  placeholder={selectedTestModel ? "請輸入對話訊息..." : "請先同步模型以進行測試"} 
                  className="input" 
                  style={{ flex: 1, fontSize: '15px', padding: '12px 16px' }}
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  disabled={!selectedTestModel || isChatting}
                />
                <button 
                  type="submit" 
                  className="btn btn-primary" 
                  style={{ padding: '0 24px', fontSize: '15px' }}
                  disabled={!selectedTestModel || !chatInput.trim() || isChatting}
                >
                  發送訊息
                </button>
              </form>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
