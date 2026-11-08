import React, { useState } from 'react';
import { CheckCircle2, ChevronRight, Sparkles, FileText } from 'lucide-react';

/**
 * OptionsBlock
 * Renders structured choice items produced by LLM <options> blocks.
 * Designed for mobile screens: full-width single-column layout (一行一個),
 * with clear visual hierarchy, labels, descriptions, and follow-up requirements.
 */
export default function OptionsBlock({
  title = '',
  options = [],
  onSelectOption
}) {
  const [selectedId, setSelectedId] = useState(null);

  if (!options || options.length === 0) return null;

  const handleSelect = (opt) => {
    setSelectedId(opt.id);
    if (onSelectOption) {
      onSelectOption(opt);
    }
  };

  return (
    <div className="my-2.5 w-full rounded-2xl bg-gradient-to-b from-[#0e1626] to-[#0a101d] border border-emerald-500/25 p-3 sm:p-3.5 shadow-md shadow-black/40 text-slate-100 select-text">
      {/* Header bar / Title */}
      <div className="flex items-center gap-2 mb-2.5 pb-2 border-b border-emerald-500/15">
        <div className="w-5 h-5 rounded-lg bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 shrink-0">
          <Sparkles size={12} />
        </div>
        <span className="font-semibold text-xs sm:text-sm text-emerald-300">
          {title || '可選項目 / 建議下一步'}
        </span>
        <span className="ml-auto text-[10px] font-mono bg-emerald-950/80 text-emerald-400 border border-emerald-800/50 px-1.5 py-0.5 rounded-full shrink-0">
          {options.length} 個選項
        </span>
      </div>

      {/* Options List: 一行一個 (單欄縱向排列) */}
      <div className="flex flex-col space-y-2 w-full">
        {options.map((opt, idx) => {
          const isSelected = selectedId === opt.id;
          const letter = String.fromCharCode(65 + (idx % 26)); // A, B, C...

          return (
            <button
              key={opt.id || idx}
              type="button"
              onClick={() => handleSelect(opt)}
              className={`w-full text-left group relative rounded-xl border p-2.5 transition-all cursor-pointer block ${
                isSelected
                  ? 'bg-emerald-950/60 border-emerald-400 shadow-sm shadow-emerald-900/40 ring-1 ring-emerald-400/40'
                  : 'bg-slate-900/80 hover:bg-slate-800/90 border-slate-700/60 hover:border-emerald-500/40'
              }`}
            >
              {/* Main option row */}
              <div className="flex items-start gap-2.5 w-full">
                {/* Prefix Badge */}
                <div
                  className={`w-6 h-6 rounded-lg flex items-center justify-center font-bold font-mono text-xs shrink-0 transition-colors ${
                    isSelected
                      ? 'bg-emerald-500 text-slate-950'
                      : 'bg-slate-800 border border-slate-700 text-emerald-400 group-hover:border-emerald-500/60'
                  }`}
                >
                  {letter}
                </div>

                {/* Main Label and metadata */}
                <div className="flex-1 min-w-0 pt-0.5">
                  <div className="font-semibold text-xs sm:text-sm text-white group-hover:text-emerald-200 transition-colors flex items-center gap-1.5 break-words">
                    <span>{opt.label}</span>
                    {isSelected && (
                      <CheckCircle2 size={13} className="text-emerald-400 inline shrink-0" />
                    )}
                  </div>

                  {/* Secondary Description */}
                  {opt.desc && (
                    <div className="mt-1 text-[11px] sm:text-xs text-slate-400 leading-relaxed font-normal break-words">
                      {opt.desc}
                    </div>
                  )}

                  {/* Follow-up Requirement / Hint Badge */}
                  {opt.requirement && (
                    <div className="mt-1.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-950/40 border border-amber-600/30 text-[10px] text-amber-300/90 max-w-full">
                      <FileText size={10} className="shrink-0 text-amber-400" />
                      <span className="truncate">需補充：{opt.requirement}</span>
                    </div>
                  )}
                </div>

                {/* Right Arrow Action Cue */}
                <div className="shrink-0 pt-1 text-slate-600 group-hover:text-emerald-400 transition-colors">
                  <ChevronRight size={14} />
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
