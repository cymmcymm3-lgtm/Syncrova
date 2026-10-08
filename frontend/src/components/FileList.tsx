import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import api from '../services/api';
import { resolveMediaUrl } from '../utils/media';

export default function FileList({ groupId }) {
  const [files, setFiles] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);

  useEffect(() => {
    fetchFiles();
  }, [groupId]);

  const fetchFiles = async () => {
    const res = await api.get(`/files/group/${groupId}`);
    setFiles(res.data);
  };

  const uploadFile = async () => {
    if (!selectedFile) return;
    const formData = new FormData();
    formData.append('file', selectedFile);
    await api.post(`/files/upload/${groupId}`, formData);
    toast.success('File uploaded');
    setSelectedFile(null);
    fetchFiles();
  };

  // ✅ Use relative URL instead of localhost
  const downloadUrl = (file) => resolveMediaUrl(file.url || file.fileUrl || `/uploads/${file.filename}`);

  return (
    <div className="bg-white/10 backdrop-blur-md rounded-xl p-4 border border-white/20">
      <div className="flex gap-2 mb-4">
        <input type="file" onChange={e => setSelectedFile(e.target.files[0])} className="text-white file:mr-2 file:py-1 file:px-3 file:rounded-full file:border-0 file:text-sm file:bg-pink-500 file:text-white hover:file:bg-pink-600" />
        <button onClick={uploadFile} className="bg-pink-500/80 hover:bg-pink-500 text-white px-4 py-1 rounded-lg transition">Upload</button>
      </div>
      <ul>
        {files.map(file => (
          <li key={file._id} className="border-b border-white/20 py-2 flex justify-between text-white">
            <span>{file.originalName}</span>
            <a href={downloadUrl(file)} download className="text-pink-300 hover:text-pink-400">Download</a>
          </li>
        ))}
      </ul>
    </div>
  );
}
