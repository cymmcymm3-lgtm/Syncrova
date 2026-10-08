import React, { useState } from 'react';
import toast from 'react-hot-toast';
import api from '../services/api';

type CreatePostProps = {
  groupId?: string;
  onPostCreated?: () => void;
};

export default function CreatePost({ groupId, onPostCreated }: CreatePostProps) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await api.post('/posts', { groupId, title, content });
      setTitle('');
      setContent('');
      onPostCreated?.();
      toast.success('Announcement posted');
    } catch (err) {
      toast.error(err.response?.data?.msg || 'Failed to create announcement');
    }
  };

  return (
    <form onSubmit={handleSubmit} className="mb-6 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <input type="text" placeholder="Announcement title" className="mb-2 h-11 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 text-sm font-semibold outline-none transition focus:border-[#1877f2] focus:bg-white focus:ring-4 focus:ring-blue-500/10 dark:border-gray-700 dark:bg-gray-950 dark:text-white" value={title} onChange={e => setTitle(e.target.value)} required />
      <textarea placeholder="Share an update" className="mb-2 w-full resize-none rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm font-semibold outline-none transition focus:border-[#1877f2] focus:bg-white focus:ring-4 focus:ring-blue-500/10 dark:border-gray-700 dark:bg-gray-950 dark:text-white" rows={3} value={content} onChange={e => setContent(e.target.value)} required />
      <button type="submit" className="rounded-xl bg-[#1877f2] px-4 py-2.5 text-sm font-black text-white transition hover:bg-[#0f63d5]">Create Announcement</button>
    </form>
  );
}
