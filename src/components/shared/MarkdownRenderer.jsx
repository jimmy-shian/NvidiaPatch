import React from 'react';
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

export default function MarkdownRenderer({ content }) {
  if (!content) return null;

  return (
    <div className="markdown-content text-slate-100 text-[14.5px] leading-relaxed break-words">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={{
          code({ node, inline, className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || '');
            const value = String(children).replace(/\n$/, '');

            if (!inline && match) {
              return (
                <CodeBlock
                  language={match[1]}
                  value={value}
                />
              );
            }

            if (!inline && value.includes('\n')) {
              return (
                <CodeBlock
                  language=""
                  value={value}
                />
              );
            }

            return (
              <code className="px-1.5 py-0.5 rounded bg-slate-800 font-mono text-[13px] text-emerald-400 border border-slate-700/50" {...props}>
                {children}
              </code>
            );
          },
          table({ children }) {
            return (
              <div className="table-scroll-container my-3 max-w-full overflow-x-auto rounded-xl border border-slate-800/80 bg-slate-950/40 shadow-inner">
                <table className="w-max min-w-full table-auto divide-y divide-slate-800 text-xs text-left">
                  {children}
                </table>
              </div>
            );
          },
          thead({ children }) {
            return <thead className="bg-slate-800/90 text-slate-200 font-semibold">{children}</thead>;
          },
          th({ children }) {
            return (
              <th className="px-3.5 py-2.5 font-semibold text-slate-200 text-left align-middle border-b border-slate-700/70 whitespace-nowrap min-w-[5rem]">
                {renderContentWithLineBreaks(children)}
              </th>
            );
          },
          td({ children }) {
            return (
              <td className="px-3.5 py-2.5 border-t border-slate-800/60 text-slate-300 align-top leading-relaxed text-left min-w-[6.5rem] max-w-[22rem]">
                {renderContentWithLineBreaks(children)}
              </td>
            );
          },
          a({ href, children }) {
            return (
              <a href={href} target="_blank" rel="noopener noreferrer" className="text-emerald-400 underline hover:text-emerald-300">
                {children}
              </a>
            );
          }
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
