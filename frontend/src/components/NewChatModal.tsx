import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Search, User, X } from 'lucide-react';
import api from '../services/api';
import toast from 'react-hot-toast';
import { resolveMediaUrl } from '../utils/media';

export default function NewChatModal({ onClose, onSelectUser, title = 'New chat', helper = 'Search classmates by name or email.' }) {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);

  const searchUsers = async (query = search) => {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      setResults([]);
      return;
    }

    setLoading(true);
    try {
      const res = await api.get(`/users/search?q=${encodeURIComponent(trimmedQuery)}`);
      setResults(res.data);
    } catch (err) {
      toast.error('Search failed');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timeout = setTimeout(() => {
      searchUsers(search);
    }, 250);

    return () => clearTimeout(timeout);
  }, [search]);

  const renderAvatar = (userData) => {
    const avatarUrl = resolveMediaUrl(userData.avatar);

    return (
      <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-pink-500 to-indigo-500 text-white shadow-sm">
        {avatarUrl ? (
          <img src={avatarUrl} alt={userData.name} className="h-full w-full object-cover" />
        ) : (
          <User size={20} />
        )}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center bg-gray-950/55 p-4 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, y: 8, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.98 }}
        transition={{ type: 'spring', damping: 24, stiffness: 280 }}
        className="flex max-h-[min(38rem,calc(100svh_-_2rem))] w-full max-w-md flex-col overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900"
      >
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4 dark:border-gray-800">
          <div>
            <h2 className="text-lg font-bold text-gray-950 dark:text-white">{title}</h2>
            <p className="text-sm text-gray-500">{helper}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-2 text-gray-500 transition hover:bg-gray-100 hover:text-gray-900 dark:hover:bg-gray-800 dark:hover:text-white"
            aria-label="Close new chat"
          >
            <X size={18} />
          </button>
        </div>

        <div className="min-h-0 flex-1 p-5">
          <div className="relative mb-4">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search by name or email"
              className="w-full rounded-full border border-gray-200 bg-gray-50 py-3 pl-10 pr-4 text-sm outline-none transition focus:border-pink-300 focus:bg-white focus:ring-4 focus:ring-pink-500/10 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:focus:border-pink-500"
              value={search}
              onChange={e => setSearch(e.target.value)}
              autoFocus
            />
          </div>

          <div className="max-h-[min(24rem,calc(100svh_-_14rem))] space-y-1 overflow-y-auto pr-1">
            {loading && (
              <div className="space-y-2">
                {[0, 1, 2].map(item => (
                  <div key={item} className="flex animate-pulse items-center gap-3 rounded-2xl p-3">
                    <div className="h-11 w-11 rounded-full bg-gray-200 dark:bg-gray-800" />
                    <div className="flex-1 space-y-2">
                      <div className="h-3 w-1/2 rounded bg-gray-200 dark:bg-gray-800" />
                      <div className="h-3 w-3/4 rounded bg-gray-200 dark:bg-gray-800" />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {!loading && search.trim() && results.length === 0 && (
              <div className="rounded-2xl border border-dashed border-gray-200 px-4 py-8 text-center text-sm text-gray-500 dark:border-gray-700">
                No matching users found.
              </div>
            )}

            {!loading && results.map(userData => (
              <button
                key={userData._id}
                onClick={() => onSelectUser(userData)}
                className="flex w-full items-center gap-3 rounded-2xl p-3 text-left transition hover:bg-pink-50 dark:hover:bg-pink-950/20"
              >
                {renderAvatar(userData)}
                <div className="min-w-0">
                  <div className="truncate font-semibold text-gray-950 dark:text-white">{userData.name}</div>
                  <div className="truncate text-sm text-gray-500">{userData.email}</div>
                  <div className="truncate text-xs font-semibold text-gray-400">{[userData.course, userData.campus].filter(Boolean).join(' - ') || 'Academic details not set'}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
