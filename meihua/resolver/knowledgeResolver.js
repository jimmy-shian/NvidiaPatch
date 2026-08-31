import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const knowledgeDir = path.resolve(__dirname, '../knowledge');

function loadJSON(filename) {
  const filePath = path.join(knowledgeDir, filename);
  const content = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(content);
}

const baguaData = loadJSON('bagua.json');
const hexagramsData = loadJSON('hexagrams.json');
const linesData = loadJSON('lines.json');
const correspondencesData = loadJSON('correspondences.json');
const interpretationRules = loadJSON('interpretation_rules.json');

export function resolveKnowledge(calculatorResult) {
  const { primary, mutual, changed, tiYong, question } = calculatorResult;

  // 1. Primary hexagram details
  const primaryHex = hexagramsData.find(h => h.id === primary.hexagram.id);

  // 2. Moving line text
  const movingLineEntry = linesData.find(
    l => l.hexagramId === primary.hexagram.id && l.line === primary.movingLine
  );

  // 3. Mutual hexagram details
  const mutualHex = hexagramsData.find(h => h.id === mutual.hexagram.id);

  // 4. Changed hexagram details
  const changedHex = hexagramsData.find(h => h.id === changed.hexagram.id);

  // 5. Ti and Yong correspondences
  const tiCorr = correspondencesData[tiYong.ti.trigram.name] || null;
  const yongCorr = correspondencesData[tiYong.yong.trigram.name] || null;

  // 6. Ti-Yong interpretation rule
  const relationRule = interpretationRules.tiYongRelations[tiYong.relation] || null;

  return {
    calculation: calculatorResult,
    knowledge: {
      question: question || '未指定特定占問事由',
      primaryHexagram: primaryHex,
      movingLine: movingLineEntry,
      mutualHexagram: mutualHex,
      changedHexagram: changedHex,
      ti: {
        ...tiYong.ti,
        correspondences: tiCorr
      },
      yong: {
        ...tiYong.yong,
        correspondences: yongCorr
      },
      relationRule,
      interpretationOrder: interpretationRules.interpretationOrder
    }
  };
}

export function buildLLMContext(resolvedResult, question) {
  const { calculation, knowledge } = resolvedResult;
  const q = question || calculation.question || '一般運勢與事態分析';
  const date = calculation.date || new Date();
  const dateObj = date instanceof Date ? date : new Date(date);
  const timeStr = `${dateObj.getFullYear()}年${dateObj.getMonth()+1}月${dateObj.getDate()}日 ${dateObj.getHours()}:${String(dateObj.getMinutes()).padStart(2, '0')}`;

  let methodDesc = '時間起卦（依當前年月日時干支數值推算）';
  if (calculation.method === 'random' || calculation.randomNumbers) {
    methodDesc = `隨機靈動數起卦（靈動數：${calculation.randomNumbers.join(', ')}）`;
  } else if (calculation.method === 'number') {
    methodDesc = '自訂數字起卦';
  }

  return `
=== 【梅花易數 卦象事實與知識上下文 (不可竄改)】 ===

【占問問題】：${q}
【起卦時間】：${timeStr}（台北標準時間 UTC+8，內建即時時空背景）
【起卦方式】：${methodDesc}
${calculation.randomNumbers ? `【隨機靈動數】：${calculation.randomNumbers.join(', ')}` : ''}

【本卦（主卦）】：
- 卦名：${knowledge.primaryHexagram.fullName} (第 ${knowledge.primaryHexagram.id} 卦)
- 上卦：${calculation.primary.upper.name} (${calculation.primary.upper.symbol}，五行屬${calculation.primary.upper.element})
- 下卦：${calculation.primary.lower.name} (${calculation.primary.lower.symbol}，五行屬${calculation.primary.lower.element})
- 卦辭原文：${knowledge.primaryHexagram.judgement}
- 大象辭：${knowledge.primaryHexagram.image}
- 核心關鍵字：${knowledge.primaryHexagram.keywords.join('、')}

【體用判定與五行生剋】：
- 體卦（代表求占者主體/事物本質）：${knowledge.ti.position === 'upper' ? '上卦' : '下卦'}【${knowledge.ti.trigram.name}卦】（五行屬${knowledge.ti.trigram.element}）
- 用卦（代表外部事態/環境變數）：${knowledge.yong.position === 'upper' ? '上卦' : '下卦'}【${knowledge.yong.trigram.name}卦】（五行屬${knowledge.yong.trigram.element}）
- 體用生剋關係：【${calculation.tiYong.relation}】
- 規則象意評斷：${knowledge.relationRule ? `${knowledge.relationRule.nature}（${knowledge.relationRule.summary}）` : '平穩'}
- 傳統指南：${knowledge.relationRule ? knowledge.relationRule.guidance : '順應時勢'}

【動爻】：
- 動爻位置：第 ${calculation.primary.movingLine} 爻（${knowledge.movingLine ? knowledge.movingLine.name : `第${calculation.primary.movingLine}爻`}）
- 爻辭原文：${knowledge.movingLine ? knowledge.movingLine.text : '暫無原文'}
${knowledge.movingLine && knowledge.movingLine.xiangText ? `- 爻小象辭：${knowledge.movingLine.xiangText}` : ''}

【互卦（過程與內部機制）】：
- 卦名：${knowledge.mutualHexagram.fullName} (第 ${knowledge.mutualHexagram.id} 卦)
- 上互：${calculation.mutual.upper.name} (${calculation.mutual.upper.element})，下互：${calculation.mutual.lower.name} (${calculation.mutual.lower.element})
- 卦辭：${knowledge.mutualHexagram.judgement}
- 大象辭：${knowledge.mutualHexagram.image}

【變卦（後續發展趨勢）】：
- 卦名：${knowledge.changedHexagram.fullName} (第 ${knowledge.changedHexagram.id} 卦)
- 上卦：${calculation.changed.upper.name} (${calculation.changed.upper.element})，下卦：${calculation.changed.lower.name} (${calculation.changed.lower.element})
- 卦辭：${knowledge.changedHexagram.judgement}
- 大象辭：${knowledge.changedHexagram.image}

=== 【解讀規則與輸出要求】 ===
請嚴格依據上述卦象計算事實與檢索知識庫，按照以下順序進行解讀輸出：
1. 【起卦資料與卦象結構】
2. 【主卦現狀解析】
3. 【體用五行生剋深入分析】
4. 【動爻變化與爻辭啟發】
5. 【互卦過程與內在機制】
6. 【變卦後續走向推演】
7. 【綜合判讀（有利因素/阻力因素/關鍵時機）】
8. 【務實現實建議】
`.trim();
}
