import React, { useState } from 'react';
import { CheckCircle2, ChevronRight, Sparkles, FileText } from 'lucide-react';
import { isMeaningfulRequirement, isOptionInInput } from '../../core/utils/optionsParser';

/**
 * OptionsBlock
 * Renders structured choice items produced by LLM <options> blocks.
 * Supports multi-select and click-again-to-deselect, synced with chat input when currentInput is provided.
 */
export default function OptionsBlock({
  title = '',
  options = [],
  onSelectOption,
  currentInput = undefined
}) {
  const [selectedIds, setSelectedIds] = useState(() => new Set());

  if (!options || options.length === 0) return null;

  const isControlledByInput = typeof currentInput === 'string';

  const handleSelect = (opt) => {
    if (!isControlledByInput) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(opt.id)) {
          next.delete(opt.id);
        } else {
          next.add(opt.id);
        }
        return next;
      });
    }
    if (onSelectOption) {
      onSelectOption(opt);
    }
  };

  return (
    <div className="my-1.5 w-full rounded-xl bg-gradient-to-b from-[#0e1626] to-[#0a101d] border border-emerald-500/25 p-2 sm:p-2.5 shadow-sm text-slate-100 select-none">
      {/* Header bar / Title */}
      <div className="flex items-center gap-1.5 mb-1.5 pb-1 border-b border-emerald-500/15">
        <div className="w-4 h-4 rounded-md bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 shrink-0">
          <Sparkles size={10} />
        </div>
        <span className="font-semibold text-xs text-emerald-300 truncate">
          {title || '可選項目'}
        </span>
        <span className="ml-auto text-[10px] font-mono bg-emerald-950/80 text-emerald-400 border border-emerald-800/50 px-1.5 py-0.2 rounded-full shrink-0">
          {`${options.length} 個選項`}
        </span>
      </div>

      {/* Options List: 緊湊單欄排列 */}
      <div className="flex flex-col space-y-1 w-full">
        {options.map((opt, idx) => {
          const isSelected = isControlledByInput
            ? isOptionInInput(currentInput, opt)
            : selectedIds.has(opt.id);
          const showRequirement = isMeaningfulRequirement(opt.requirement);
          const letter = String.fromCharCode(65 + (idx % 26)); // A, B, C...

          return (
            <button
              key={opt.id || idx}
              type="button"
              onClick={() => handleSelect(opt)}
              aria-pressed={isSelected}
              className={`w-full text-left group relative rounded-lg border px-2.5 py-1.5 transition-all cursor-pointer block ${
                isSelected
                  ? 'bg-emerald-950/60 border-emerald-400 shadow-sm shadow-emerald-900/40 ring-1 ring-emerald-400/40'
                  : 'bg-slate-900/80 hover:bg-slate-800/90 border-slate-700/60 hover:border-emerald-500/40'
              }`}
            >
              {/* Main option row */}
              <div className="flex items-center gap-2 w-full">
                {/* Prefix Badge */}
                <div
                  className={`w-5 h-5 rounded-md flex items-center justify-center font-bold font-mono text-[10px] shrink-0 transition-colors ${
                    isSelected
                      ? 'bg-emerald-500 text-slate-950'
                      : 'bg-slate-800 border border-slate-700 text-emerald-400 group-hover:border-emerald-500/60'
                  }`}
                >
                  {letter}
                </div>

                {/* Main Label and metadata */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center flex-wrap gap-x-1.5 gap-y-0.5">
                    <span className="font-semibold text-xs text-white group-hover:text-emerald-200 transition-colors break-words">
                      {opt.label}
                    </span>
                    {isSelected && (
                      <CheckCircle2 size={12} className="text-emerald-400 inline shrink-0" />
                    )}
                    {showRequirement && (
                      <span className="inline-flex items-center gap-0.5 px-1.5 py-0 rounded bg-amber-950/40 border border-amber-600/30 text-[10px] text-amber-300/90 max-w-full leading-tight">
                        <FileText size={9} className="shrink-0 text-amber-400" />
                        <span className="truncate">{'需補充：'}{opt.requirement}</span>
                      </span>
                    )}
                  </div>

                  {/* Secondary Description */}
                  {opt.desc && (
                    <div className="mt-0.5 text-[10px] text-slate-400 leading-tight font-normal line-clamp-1 break-words">
                      {opt.desc}
                    </div>
                  )}
                </div>

                {/* Right Arrow Action Cue */}
                <div className="shrink-0 text-slate-600 group-hover:text-emerald-400 transition-colors">
                  <ChevronRight size={13} />
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
