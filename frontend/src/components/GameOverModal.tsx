import { RotateCcw, Trophy, X } from 'lucide-react';

export default function GameOverModal({
  open,
  title = 'Game over',
  score = 0,
  detail = '',
  saving = false,
  saved = false,
  onRetry,
  onExit
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm overflow-hidden rounded-3xl border border-white/10 bg-gray-950 text-white shadow-2xl shadow-blue-500/20">
        <div className="relative p-5 text-center">
          <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-blue-400 via-cyan-300 to-emerald-300" />
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br from-[#1877f2] to-[#00b2ff] shadow-xl shadow-blue-500/25">
            <Trophy size={30} />
          </div>
          <h3 className="mt-4 text-2xl font-black tracking-normal">{title}</h3>
          <p className="mt-2 text-sm font-semibold text-white/55">{detail || 'Nice run. Close this result or try again.'}</p>
          <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.06] p-4">
            <p className="text-xs font-black uppercase text-white/45">Score</p>
            <p className="mt-1 text-4xl font-black">{score}</p>
            <p className="mt-1 text-xs font-bold text-white/45">{saving ? 'Saving score...' : saved ? 'Saved to rankings' : 'Ready'}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 border-t border-white/10 p-4">
          <button
            type="button"
            onClick={onExit}
            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-3 text-sm font-black text-white transition hover:bg-white/10"
          >
            <X size={17} />
            Close
          </button>
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-black text-gray-950 transition hover:bg-cyan-100"
          >
            <RotateCcw size={17} />
            Try again
          </button>
        </div>
      </div>
    </div>
  );
}
