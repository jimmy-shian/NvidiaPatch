import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import CodeBlock from './CodeBlock';

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
              <div className="overflow-x-auto my-3 border border-slate-800 rounded-lg">
                <table className="min-w-full divide-y divide-slate-800 text-xs text-left">
                  {children}
                </table>
              </div>
            );
          },
          th({ children }) {
            return <th className="px-3 py-2 bg-slate-800/80 font-semibold text-slate-200">{children}</th>;
          },
          td({ children }) {
            return <td className="px-3 py-2 border-t border-slate-800/60 text-slate-300">{children}</td>;
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
