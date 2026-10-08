import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import api from '../services/api';

export default function TaskList({ groupId }) {
  const [tasks, setTasks] = useState([]);
  const [newTask, setNewTask] = useState('');

  useEffect(() => {
    fetchTasks();
  }, [groupId]);

  const fetchTasks = async () => {
    const res = await api.get(`/tasks/group/${groupId}`);
    setTasks(res.data);
  };

  const addTask = async () => {
    if (!newTask) return;
    await api.post('/tasks', { groupId, description: newTask });
    toast.success('Task added');
    setNewTask('');
    fetchTasks();
  };

  const toggleComplete = async (taskId) => {
    await api.put(`/tasks/${taskId}/complete`);
    fetchTasks();
  };

  return (
    <div className="bg-white/10 backdrop-blur-md rounded-xl p-4 border border-white/20">
      <div className="flex gap-2 mb-4">
        <input type="text" className="flex-1 p-2 rounded-lg bg-white/20 text-white placeholder-indigo-200 border border-white/30 focus:outline-none" placeholder="New task..." value={newTask} onChange={e => setNewTask(e.target.value)} />
        <button onClick={addTask} className="bg-green-500/80 hover:bg-green-500 text-white px-4 py-2 rounded-lg transition">Add</button>
      </div>
      <ul>
        {tasks.map(task => (
          <li key={task._id} className="flex items-center gap-2 border-b border-white/20 py-2 text-white">
            <input type="checkbox" checked={task.completed} onChange={() => toggleComplete(task._id)} className="accent-blue-500" />
            <span className={task.completed ? 'line-through text-indigo-300' : ''}>{task.description}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}