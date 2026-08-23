import React, { useState } from 'react';
import { Check, Copy } from 'lucide-react';

export default function CodeBlock({ language, value }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy text', err);
    }
  };

  return (
    <div className="code-block-container my-3 rounded-lg border border-slate-800 bg-[#0d1117] overflow-hidden text-sm">
      <div className="code-block-header flex items-center justify-between px-3 py-1.5 bg-[#161b22] border-b border-slate-800 text-xs text-slate-400">
        <span className="font-mono">{language || 'text'}</span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 hover:text-white transition-colors py-0.5 px-1.5 rounded hover:bg-slate-700"
          title="Copy code"
        >
          {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      <pre className="p-3 overflow-x-auto font-mono text-slate-200 text-xs leading-relaxed">
        <code>{value}</code>
      </pre>
    </div>
  );
}
