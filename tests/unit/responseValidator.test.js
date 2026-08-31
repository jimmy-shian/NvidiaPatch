import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import MarkdownContent from '../../src/components/shared/MarkdownContent';

const { isUpstreamErrorContent, extractUpstreamErrorDetail } = require('../../gateway/engine/upstreamErrorDetector');
const { consumeSseLine } = require('../../gateway/chat/upstream/responseValidator');

describe('Markdown <br> Tag Rendering in MarkdownContent', () => {
  it('should render <br> tags inside markdown tables as HTML line breaks', () => {
    const md = '| Name | Description |\n|---|---|\n| Item 1 | Line 1<br>Line 2<br/>Line 3<br />Line 4 |';
    const html = renderToStaticMarkup(React.createElement(MarkdownContent, null, md));
    expect(html).toContain('<table');
    expect(html).toContain('Item 1');
    expect(html).toContain('<br/>');
    expect(html).not.toContain('&lt;br&gt;');
    expect(html).not.toContain('&lt;br/&gt;');
  });

  it('should render <br> tags in paragraphs and bold text as HTML line breaks', () => {
    const md = 'Paragraph with<br>break and **bold<br/>text**';
    const html = renderToStaticMarkup(React.createElement(MarkdownContent, null, md));
    expect(html).toContain('<br/>');
    expect(html).toContain('<strong>');
  });

  it('should preserve code blocks containing <br> without converting them', () => {
    const md = '```javascript\nconst str = "<br>";\n```';
    const html = renderToStaticMarkup(React.createElement(MarkdownContent, null, md));
    expect(html).toContain('<pre');
    expect(html).toContain('&lt;br&gt;');
  });
});

describe('Upstream Error Detector & Detail Extractor', () => {
  it('should detect server errors, timeouts, and overloaded messages', () => {
    expect(isUpstreamErrorContent('Service temporarily overloaded')).toBe(true);
    expect(isUpstreamErrorContent('Internal Server Error')).toBe(true);
    expect(isUpstreamErrorContent('502 Bad Gateway')).toBe(true);
    expect(isUpstreamErrorContent({ error: { message: 'upstream connect error' } })).toBe(true);
    expect(isUpstreamErrorContent('Hello, how are you today?')).toBe(false);
  });

  it('should extract error detail from strings and JSON objects', () => {
    const detail1 = extractUpstreamErrorDetail({ error: { message: 'Capacity exceeded' } });
    expect(detail1).toBe('Capacity exceeded');

    const detail2 = extractUpstreamErrorDetail('{\"error\": \"Model is overloaded\"}');
    expect(detail2).toBe('Model is overloaded');

    const detail3 = extractUpstreamErrorDetail('Service temporarily unavailable');
    expect(detail3).toBe('Service temporarily unavailable');
  });
});

describe('SSE Line Consumption & Stream Diagnostics', () => {
  it('should capture refusal and content_filter finish reason', () => {
    const sseLines = [];
    const fullContentRef = { value: '' };
    const finishReasonRef = { value: null };
    const hasToolCallsRef = { value: false };
    const streamMetaRef = { dataChunkCount: 0, lastError: null, refusal: null };

    const line = 'data: {\"choices\":[{\"index\":0,\"delta\":{\"refusal\":\"Content violates safety guidelines\"},\"finish_reason\":\"content_filter\"}]}';
    consumeSseLine(line, sseLines, fullContentRef, finishReasonRef, hasToolCallsRef, streamMetaRef);

    expect(streamMetaRef.dataChunkCount).toBe(1);
    expect(streamMetaRef.refusal).toBe('Content violates safety guidelines');
    expect(finishReasonRef.value).toBe('content_filter');
  });

  it('should capture embedded error payload inside HTTP 200 SSE chunk', () => {
    const sseLines = [];
    const fullContentRef = { value: '' };
    const finishReasonRef = { value: null };
    const hasToolCallsRef = { value: false };
    const streamMetaRef = { dataChunkCount: 0, lastError: null, refusal: null };

    const line = 'data: {\"error\":{\"message\":\"Service temporarily overloaded\",\"code\":503}}';
    consumeSseLine(line, sseLines, fullContentRef, finishReasonRef, hasToolCallsRef, streamMetaRef);

    expect(streamMetaRef.dataChunkCount).toBe(1);
    expect(streamMetaRef.lastError).toContain('Service temporarily overloaded');
  });

  it('should accumulate standard and reasoning content properly', () => {
    const sseLines = [];
    const fullContentRef = { value: '' };
    const finishReasonRef = { value: null };
    const hasToolCallsRef = { value: false };
    const streamMetaRef = { dataChunkCount: 0, lastError: null, refusal: null };

    consumeSseLine('data: {\"choices\":[{\"index\":0,\"delta\":{\"reasoning_content\":\"Thinking... \"}}]}', sseLines, fullContentRef, finishReasonRef, hasToolCallsRef, streamMetaRef);
    consumeSseLine('data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"Final Answer\"}}]}', sseLines, fullContentRef, finishReasonRef, hasToolCallsRef, streamMetaRef);

    expect(fullContentRef.value).toBe('Thinking... Final Answer');
    expect(streamMetaRef.dataChunkCount).toBe(2);
  });

  it('should preserve a final SSE data event when EOF has no trailing newline', () => {
    const sseLines = [];
    const fullContentRef = { value: '' };
    const finishReasonRef = { value: null };
    const hasToolCallsRef = { value: false };
    const streamMetaRef = { dataChunkCount: 0, lastError: null, refusal: null };

    const finalLine = 'data: {"choices":[{"index":0,"delta":{"content":"Final answer"},"finish_reason":"stop"}]}';
    consumeSseLine(finalLine, sseLines, fullContentRef, finishReasonRef, hasToolCallsRef, streamMetaRef);

    expect(fullContentRef.value).toBe('Final answer');
    expect(finishReasonRef.value).toBe('stop');
    expect(streamMetaRef.dataChunkCount).toBe(1);
  });

  it('should recognize reasoning_content when ordinary content is absent', () => {
    const sseLines = [];
    const fullContentRef = { value: '' };
    const finishReasonRef = { value: null };
    const hasToolCallsRef = { value: false };
    const streamMetaRef = { dataChunkCount: 0, lastError: null, refusal: null };

    consumeSseLine(
      'data: {"choices":[{"delta":{"reasoning_content":"reasoning survives EOF"}}]}',
      sseLines, fullContentRef, finishReasonRef, hasToolCallsRef, streamMetaRef
    );

    expect(fullContentRef.value).toBe('reasoning survives EOF');
  });

  it('should classify whitespace-only output as empty', () => {
    expect(!String(' \n\t ').trim()).toBe(true);
  });
});
