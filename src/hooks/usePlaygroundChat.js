import { useState, useCallback } from 'react';
import { buildSkillSystemMessage } from '../components/Playground/divinationSkills';

export default function usePlaygroundChat(gatewayUrl, adminToken) {
  const [selectedTestModel, setSelectedTestModel] = useState('');
  const [chatHistory, setChatHistory] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [isChatting, setIsChatting] = useState(false);
  const [selectedSkillIds, setSelectedSkillIds] = useState([]);

  const handleSendTestMessage = useCallback(async (e) => {
    if (e) e.preventDefault();
    if (!chatInput.trim() || !selectedTestModel || isChatting) return;

    const userMsg = { role: 'user', content: chatInput.trim() };
    const assistantMsg = { role: 'assistant', content: '', thinkingContent: '' };

    setChatHistory(prev => [...prev, userMsg, assistantMsg]);
    const skillSystemMessage = buildSkillSystemMessage(selectedSkillIds);
    const baseMessages = skillSystemMessage
      ? [{ role: 'system', content: skillSystemMessage }, ...chatHistory, userMsg]
      : [...chatHistory, userMsg];
    const targetMessages = baseMessages;
    setChatInput('');
    setIsChatting(true);

    // 暫時性錯誤（503/502/504）的自動重試次數上限
    const MAX_TEMPORARY_RETRIES = 1;
    let temporaryRetryCount = 0;

    try {
      while (true) {
        const res = await fetch(gatewayUrl + '/api/test/chat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(adminToken ? { 'Authorization': `Bearer ${adminToken}` } : {})
          },
          body: JSON.stringify({
            model: selectedTestModel,
            messages: targetMessages,
            stream: true
          })
        });

        if (!res.ok) {
          const text = await res.text();
          // 若是暫時性錯誤（503/502/504），自動重試一次，避免直接顯示錯誤。
          const isTemporary = res.status === 503 || res.status === 502 || res.status === 504;
          if (isTemporary && temporaryRetryCount < MAX_TEMPORARY_RETRIES) {
            temporaryRetryCount += 1;
            console.log(`收到 HTTP ${res.status}（暫時性錯誤），自動重試第 ${temporaryRetryCount} 次。`);
            await new Promise(resolve => setTimeout(resolve, 2000));
            continue;
          }
          setChatHistory(prev => {
            const updated = [...prev];
            updated[updated.length - 1].content = `Error (HTTP ${res.status}): ${text || 'Unable to test model'}`;
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
          buffer = lines.pop();

          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('data:')) {
              const dataStr = trimmed.slice(5).trim();
              if (dataStr === '[DONE]') continue;
              try {
                const chunk = JSON.parse(dataStr);
                if (chunk.choices && chunk.choices[0].delta) {
                  const delta = chunk.choices[0].delta;
                  if (delta.reasoning_content) {
                    setChatHistory(prev => {
                      const updated = [...prev];
                      const lastMsg = updated[updated.length - 1];
                      if (lastMsg && lastMsg.role === 'assistant') {
                        lastMsg.thinkingContent += delta.reasoning_content;
                      }
                      return updated;
                    });
                  }
                  if (delta.content) {
                    setChatHistory(prev => {
                      const updated = [...prev];
                      updated[updated.length - 1].content += delta.content;
                      return updated;
                    });
                  }
                }
              } catch (err) {
                // ignore parse errors
              }
            }
          }
        }
        // 串流讀取成功後跳出重試迴圈
        break;
      }
    } catch (err) {
      setChatHistory(prev => {
        const updated = [...prev];
        updated[updated.length - 1].content = `Connection error: ${err.message}`;
        return updated;
      });
    } finally {
      setIsChatting(false);
    }
  }, [chatInput, selectedTestModel, isChatting, chatHistory, selectedSkillIds, gatewayUrl, adminToken]);

  return {
    selectedTestModel,
    setSelectedTestModel,
    chatHistory,
    setChatHistory,
    chatInput,
    setChatInput,
    isChatting,
    selectedSkillIds,
    setSelectedSkillIds,
    handleSendTestMessage
  };
}