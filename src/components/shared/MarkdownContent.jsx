import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';

const markdownComponents = {
  a: ({ node, ...props }) => (
    <a {...props} className="md-link" target="_blank" rel="noopener noreferrer" />
  ),
  table: ({ node, ...props }) => (
    <div className="md-table-wrap">
      <table {...props} className="md-table" />
    </div>
  ),
  th: ({ node, style, ...props }) => <th {...props} style={style} />,
  td: ({ node, style, ...props }) => <td {...props} style={style} />,
  pre: ({ node, ...props }) => <pre {...props} className="md-code-block" />,
  code: ({ node, inline, className, children, ...props }) => {
    if (inline || !className) {
      return <code {...props} className="md-inline-code">{children}</code>;
    }
    return <code {...props} className={className}>{children}</code>;
  },
  blockquote: ({ node, ...props }) => <blockquote {...props} />,
  ul: ({ node, ...props }) => <ul {...props} className="md-list" />,
  ol: ({ node, ...props }) => <ol {...props} className="md-list" />,
  input: ({ node, ...props }) => <input {...props} disabled />,
  img: ({ node, ...props }) => <img {...props} className="md-image" loading="lazy" />,
  hr: ({ node, ...props }) => <hr {...props} />
};

export default function MarkdownContent({ children }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkBreaks]}
      components={markdownComponents}
    >
      {children || ''}
    </ReactMarkdown>
  );
}