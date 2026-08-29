import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';

/**
 * Remark plugin to convert <br>, <br/>, <br />, <BR> in text and HTML nodes
 * into Markdown AST break nodes ({ type: 'break' }), properly breaking lines in
 * Markdown tables, lists, and paragraphs while preserving code blocks.
 */
function remarkHtmlBreak() {
  return (tree) => {
    function transform(node) {
      if (!node) return;
      if (node.type === 'code' || node.type === 'inlineCode') return;
      if (!node.children || !Array.isArray(node.children)) return;

      const newChildren = [];
      for (const child of node.children) {
        if (child.type === 'text' && /<br\s*\/?>/i.test(child.value)) {
          const parts = child.value.split(/(<br\s*\/?>)/gi);
          for (const part of parts) {
            if (!part) continue;
            if (/^<br\s*\/?>$/i.test(part)) {
              newChildren.push({ type: 'break' });
            } else {
              newChildren.push({ type: 'text', value: part });
            }
          }
        } else if (child.type === 'html' && /^<br\s*\/?>$/i.test(child.value.trim())) {
          newChildren.push({ type: 'break' });
        } else {
          transform(child);
          newChildren.push(child);
        }
      }
      node.children = newChildren;
    }
    transform(tree);
  };
}

const markdownPlugins = [remarkGfm, remarkBreaks, remarkHtmlBreak];

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

function MarkdownContent({ children }) {
  return (
    <ReactMarkdown
      remarkPlugins={markdownPlugins}
      components={markdownComponents}
    >
      {children || ''}
    </ReactMarkdown>
  );
}

export default React.memo(MarkdownContent);