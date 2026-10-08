import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Users, Crown, Star, UserMinus, ArrowUp, ArrowDown } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import toast from 'react-hot-toast';
import { resolveMediaUrl } from '../utils/media';
import LoadingSpinner from './LoadingSpinner';

// Helper to generate avatar URL (uses UI Avatars if no real avatar)
const getAvatarUrl = (user) => {
  if (user?.avatar && user.avatar !== '') {
    return resolveMediaUrl(user.avatar);
  }
  // Fallback: generate a nice avatar with initials
  const name = user?.name || 'User';
  const initials = name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(initials)}&background=ec4899&color=fff&bold=true&length=2`;
};

export default function GroupMembers({ groupId, onUserClick }) {
  const { user } = useAuth();
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isCreator, setIsCreator] = useState(false);
  const [isCoCreator, setIsCoCreator] = useState(false);

  useEffect(() => {
    if (!groupId) return;
    fetchMembers();
  }, [groupId]);

  const fetchMembers = async () => {
    setLoading(true);
    try {
      const res = await api.get(`/groups/${groupId}/members`);
      setMembers(res.data);
      if (user && user._id) {
        const currentMember = res.data.find(m => m._id === user._id);
        setIsCreator(currentMember?.role === 'creator');
        setIsCoCreator(currentMember?.role === 'co-creator');
      }
    } catch (err) {
      console.error(err);
      toast.error(err.response?.data?.msg || 'Failed to load members');
    } finally {
      setLoading(false);
    }
  };

  const kickMember = async (memberId, memberName) => {
    if (!window.confirm(`Remove ${memberName} from the workspace?`)) return;
    try {
      await api.delete(`/groups/${groupId}/kick/${memberId}`);
      toast.success(`${memberName} removed`);
      fetchMembers();
    } catch (err) {
      toast.error(err.response?.data?.msg || 'Failed to kick');
    }
  };

  const promoteToCoCreator = async (memberId, memberName) => {
    if (!window.confirm(`Promote ${memberName} to admin?`)) return;
    try {
      await api.put(`/groups/${groupId}/promote/${memberId}`);
      toast.success(`${memberName} is now an admin`);
      fetchMembers();
    } catch (err) {
      toast.error(err.response?.data?.msg || 'Promotion failed');
    }
  };

  const demoteToMember = async (memberId, memberName) => {
    if (!window.confirm(`Demote ${memberName} from admin to member?`)) return;
    try {
      await api.put(`/groups/${groupId}/demote/${memberId}`);
      toast.success(`${memberName} demoted to member`);
      fetchMembers();
    } catch (err) {
      toast.error(err.response?.data?.msg || 'Demotion failed');
    }
  };

  const getRoleIcon = (role) => {
    switch (role) {
      case 'creator': return <Crown size={16} className="text-yellow-500" />;
      case 'co-creator': return <Star size={16} className="text-indigo-500" />;
      default: return <Users size={16} className="text-gray-400" />;
    }
  };

  const getRoleBadge = (role) => {
    const labels = {
      creator: 'Owner',
      'co-creator': 'Admin',
      member: 'Member'
    };
    const styles = {
      creator: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400',
      'co-creator': 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400',
      member: 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400',
    };
    return <span className={`text-xs px-2 py-0.5 rounded-full ${styles[role]}`}>{labels[role] || 'Member'}</span>;
  };

  if (loading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm">
        <LoadingSpinner compact label="Loading members" />
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <Users size={20} className="text-pink-500" />
        <h3 className="font-semibold text-gray-900 dark:text-white">Workspace Members ({members.length})</h3>
      </div>
      <div className="space-y-2">
        {members.map(member => {
          const isCurrentUser = member._id === user?._id;
          const canKick = (isCreator || isCoCreator) && member.role !== 'creator' && !isCurrentUser;
          const canPromote = isCreator && member.role === 'member';
          const canDemote = isCreator && member.role === 'co-creator';
          const avatarUrl = getAvatarUrl(member);
          return (
            <div key={member._id} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/50 rounded-xl">
              <button
                type="button"
                onClick={() => onUserClick?.(member)}
                className="flex min-w-0 items-center gap-3 rounded-lg text-left transition hover:text-pink-600 dark:hover:text-pink-300"
              >
                <img
                  src={avatarUrl}
                  alt={member.name}
                  className="w-10 h-10 rounded-full object-cover bg-gray-200 dark:bg-gray-600"
                  onError={(e) => {
                    const target = e.currentTarget;
                    target.onerror = null;
                    target.style.display = 'none';
                    const parent = target.parentElement;
                    const fallback = document.createElement('div');
                    fallback.className = 'w-10 h-10 rounded-full bg-gradient-to-r from-pink-500 to-indigo-600 flex items-center justify-center text-white font-semibold';
                    fallback.textContent = member.name?.charAt(0).toUpperCase() || '?';
                    parent.appendChild(fallback);
                  }}
                />
                <div>
                  <div className="font-medium text-gray-900 dark:text-white">
                    {member.name}
                    {isCurrentUser && <span className="text-xs text-gray-400 ml-1">(you)</span>}
                  </div>
                  <div className="flex items-center gap-1 mt-1">
                    {getRoleIcon(member.role)}
                    {getRoleBadge(member.role)}
                  </div>
                </div>
              </button>
              <div className="flex items-center gap-1">
                {canPromote && (
                  <button
                    onClick={() => promoteToCoCreator(member._id, member.name)}
                    className="p-1.5 text-indigo-500 hover:bg-indigo-100 dark:hover:bg-indigo-900/30 rounded-lg transition"
                    title="Promote to admin"
                  >
                    <ArrowUp size={16} />
                  </button>
                )}
                {canDemote && (
                  <button
                    onClick={() => demoteToMember(member._id, member.name)}
                    className="p-1.5 text-orange-500 hover:bg-orange-100 dark:hover:bg-orange-900/30 rounded-lg transition"
                    title="Demote to member"
                  >
                    <ArrowDown size={16} />
                  </button>
                )}
                {canKick && (
                  <button
                    onClick={() => kickMember(member._id, member.name)}
                    className="p-1.5 text-red-500 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-lg transition"
                    title="Kick member"
                  >
                    <UserMinus size={16} />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
