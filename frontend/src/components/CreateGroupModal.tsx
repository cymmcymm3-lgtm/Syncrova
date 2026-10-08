import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowRight, FolderKanban, Loader2, X } from 'lucide-react';

export default function CreateGroupModal({ isOpen, onClose, onCreate }) {
  const [groupName, setGroupName] = useState('');
  const [groupDesc, setGroupDesc] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setGroupName('');
      setGroupDesc('');
      setSubmitting(false);
    }
  }, [isOpen]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!groupName.trim() || submitting) return;

    setSubmitting(true);
    try {
      const created = await onCreate(groupName, groupDesc);
      if (created !== false) onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-50 bg-gray-950/60 backdrop-blur-sm"
          />

          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ scale: 0.96, opacity: 0, y: 18 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.96, opacity: 0, y: 18 }}
              transition={{ type: 'spring', damping: 24, stiffness: 280 }}
              className="mobile-bottom-sheet w-full max-w-lg overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-gray-800 dark:bg-gray-900"
            >
              <div className="flex items-start justify-between gap-4 border-b border-gray-100 p-5 dark:border-gray-800">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-blue-50 text-[#1877f2] dark:bg-blue-950/30 dark:text-blue-200">
                    <FolderKanban size={21} />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-xl font-black text-gray-950 dark:text-white">Create workspace</h2>
                    <p className="mt-0.5 text-sm font-semibold text-gray-500 dark:text-gray-400">Set up a focused room for your team.</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-gray-500 transition hover:bg-gray-100 dark:hover:bg-gray-800"
                  aria-label="Close"
                >
                  <X size={20} />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="space-y-5 p-5">
                <label className="block">
                  <span className="text-sm font-black text-gray-800 dark:text-gray-100">Workspace name</span>
                  <input
                    type="text"
                    value={groupName}
                    onChange={(event) => setGroupName(event.target.value)}
                    className="mt-2 h-12 w-full rounded-xl border border-gray-200 bg-white px-4 text-sm font-semibold text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-[#1877f2] focus:ring-2 focus:ring-blue-100 dark:border-gray-700 dark:bg-gray-950 dark:text-white dark:focus:ring-blue-950/50"
                    placeholder="Example: Capstone Team"
                    required
                  />
                </label>

                <label className="block">
                  <span className="text-sm font-black text-gray-800 dark:text-gray-100">Description</span>
                  <textarea
                    value={groupDesc}
                    onChange={(event) => setGroupDesc(event.target.value)}
                    rows={3}
                    className="mt-2 w-full resize-none rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-semibold text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-[#1877f2] focus:ring-2 focus:ring-blue-100 dark:border-gray-700 dark:bg-gray-950 dark:text-white dark:focus:ring-blue-950/50"
                    placeholder="What will this workspace be used for?"
                  />
                </label>

                {(groupName || groupDesc) && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-950/60"
                  >
                    <p className="text-xs font-black uppercase text-gray-500 dark:text-gray-400">Preview</p>
                    <h3 className="mt-2 truncate text-lg font-black text-gray-950 dark:text-white">
                      {groupName || 'Workspace name'}
                    </h3>
                    <p className="mt-1 line-clamp-2 text-sm font-semibold text-gray-500 dark:text-gray-400">
                      {groupDesc || 'No description yet.'}
                    </p>
                  </motion.div>
                )}

                <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    onClick={onClose}
                    disabled={submitting}
                    className="inline-flex h-11 items-center justify-center rounded-xl border border-gray-200 px-4 text-sm font-black text-gray-700 transition hover:bg-gray-50 disabled:opacity-60 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[#1877f2] px-4 text-sm font-black text-white transition hover:bg-[#0f63d5] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {submitting ? <Loader2 size={17} className="animate-spin" /> : <ArrowRight size={17} />}
                    {submitting ? 'Creating' : 'Create workspace'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}
