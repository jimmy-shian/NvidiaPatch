import React, { useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import CodeBlock from './CodeBlock';

/**
 * Safely transforms literal <br>, <br/>, <br /> in text nodes into native React <br /> elements
 * without allowing arbitrary or unsafe HTML execution.
 */
export function renderContentWithLineBreaks(children) {
  if (typeof children === 'string') {
    if (!/<br\s*\/?>/i.test(children)) return children;
    const parts = children.split(/<br\s*\/?>/gi);
    return parts.map((part, idx) => (
      <React.Fragment key={idx}>
        {idx > 0 && <br />}
        {part}
      </React.Fragment>
    ));
  }
  if (Array.isArray(children)) {
    return children.map((c, i) => (
      <React.Fragment key={i}>{renderContentWithLineBreaks(c)}</React.Fragment>
    ));
  }
  if (React.isValidElement(children) && children.props?.children) {
    return React.cloneElement(children, {
      ...children.props,
      children: renderContentWithLineBreaks(children.props.children)
    });
  }
  return children;
}

/**
 * Stable Table Container with scroll position retention across live streaming tokens
 */
export function TableScrollContainer({ children }) {
  const containerRef = useRef(null);
  const scrollLeftRef = useRef(0);
  const isInteractingRef = useRef(false);

  const handleScroll = (e) => {
    scrollLeftRef.current = e.currentTarget.scrollLeft;
  };

  const handleTouchStart = () => {
    isInteractingRef.current = true;
  };

  const handleTouchEnd = () => {
    setTimeout(() => {
      isInteractingRef.current = false;
    }, 300);
  };

  // Preserve and restore horizontal scroll position across live markdown token updates
  useEffect(() => {
    if (containerRef.current && scrollLeftRef.current > 0) {
      if (Math.abs(containerRef.current.scrollLeft - scrollLeftRef.current) > 2) {
        containerRef.current.scrollLeft = scrollLeftRef.current;
      }
    }
  });

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      className="table-scroll-container my-3 max-w-full overflow-x-auto rounded-xl border border-slate-800/80 bg-slate-950/40 shadow-inner"
      style={{
        WebkitOverflowScrolling: 'touch',
        touchAction: 'pan-x pan-y',
        overscrollBehaviorX: 'contain'
      }}
    >
      <table className="w-max min-w-full table-auto divide-y divide-slate-800 text-xs text-left">
        {children}
      </table>
    </div>
  );
}

function MarkdownCodeBlock({ node, inline, className, children, ...props }) {
  const match = /language-(\w+)/.exec(className || '');
  const value = String(children).replace(/\n$/, '');

  if (!inline && match) {
    return <CodeBlock language={match[1]} value={value} />;
  }

  if (!inline && value.includes('\n')) {
    return <CodeBlock language="" value={value} />;
  }

  return (
    <code className="px-1.5 py-0.5 rounded bg-slate-800 font-mono text-[13px] text-emerald-400 border border-slate-700/50" {...props}>
      {children}
    </code>
  );
}

function MarkdownThead({ children }) {
  return <thead className="bg-slate-800/90 text-slate-200 font-semibold">{children}</thead>;
}

function MarkdownTh({ children }) {
  return (
    <th className="px-3.5 py-2.5 font-semibold text-slate-200 text-left align-middle border-b border-slate-700/70 whitespace-nowrap min-w-[5rem]">
      {renderContentWithLineBreaks(children)}
    </th>
  );
}

function MarkdownTd({ children }) {
  return (
    <td className="px-3.5 py-2.5 border-t border-slate-800/60 text-slate-300 align-top leading-relaxed text-left min-w-[6.5rem] max-w-[22rem]">
      {renderContentWithLineBreaks(children)}
    </td>
  );
}

function MarkdownLink({ href, children }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-emerald-400 underline hover:text-emerald-300">
      {children}
    </a>
  );
}

// Stable components map to prevent React unmounting/remounting DOM during streaming
const STABLE_MARKDOWN_COMPONENTS = {
  code: MarkdownCodeBlock,
  table: TableScrollContainer,
  thead: MarkdownThead,
  th: MarkdownTh,
  td: MarkdownTd,
  a: MarkdownLink
};

export default function MarkdownRenderer({ content }) {
  if (!content) return null;

  return (
    <div className="markdown-content text-slate-100 text-[14.5px] leading-relaxed break-words">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={STABLE_MARKDOWN_COMPONENTS}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
