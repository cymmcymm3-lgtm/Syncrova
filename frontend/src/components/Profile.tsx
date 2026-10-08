import { ChangeEvent, FormEvent, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import {
  Camera,
  Check,
  Eye,
  EyeOff,
  Image as ImageIcon,
  Loader2,
  Lock,
  LogOut,
  Mail,
  MapPin,
  Pencil,
  Save,
  ShieldCheck,
  UserRound,
  X
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import type { User } from '../types/models';
import api from '../services/api';
import { optimizeImageFile, resolveMediaUrl } from '../utils/media';
import { CAMPUS_OPTIONS, COURSE_OPTIONS } from '../utils/academics';
import { PageSkeleton } from './SkeletonLoader';
import { DeveloperAvatarFrame } from './DeveloperIdentity';
import './profile-clean.css';

type ProfileUser = User & {
  course?: string;
  campus?: string;
  bio?: string;
  coverPhoto?: string;
  createdAt?: string | number | Date;
  isDeveloper?: boolean;
};

type PasswordForm = {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
};

type Section = 'profile' | 'security';

type ImageResponse = {
  avatar?: string;
  coverPhoto?: string;
  user?: ProfileUser;
};

type PhotoPreview = {
  src: string;
  alt: string;
} | null;

const getErrorMessage = (error: unknown, fallback: string): string => {
  const candidate = error as { response?: { data?: { msg?: unknown } } };
  return typeof candidate?.response?.data?.msg === 'string' ? candidate.response.data.msg : fallback;
};

const formatMemberSince = (value?: string | number | Date): string => {
  if (!value) return 'Recently joined';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Recently joined';
  return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
};

function ProfileAvatar({ name, source }: { name?: string; source: string }) {
  return (
    <span className="profile-clean__avatar" aria-hidden="true">
      {source ? (
        <img src={source} alt="" onError={event => { event.currentTarget.style.display = 'none'; }} />
      ) : (
        (name || 'U').charAt(0).toUpperCase()
      )}
    </span>
  );
}

function Detail({ label, children, icon: Icon }: { label: string; children: React.ReactNode; icon?: typeof Mail }) {
  return (
    <div className="profile-clean__detail">
      {Icon && <Icon size={17} aria-hidden="true" />}
      <div>
        <dt>{label}</dt>
        <dd>{children}</dd>
      </div>
    </div>
  );
}

export default function Profile() {
  const { user, login, logout } = useAuth();
  const profile = user as ProfileUser | null;
  const [name, setName] = useState('');
  const [course, setCourse] = useState('');
  const [campus, setCampus] = useState('');
  const [bio, setBio] = useState('');
  const [avatar, setAvatar] = useState('');
  const [coverPhoto, setCoverPhoto] = useState('');
  const [coverPreview, setCoverPreview] = useState('');
  const [editing, setEditing] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [section, setSection] = useState<Section>('profile');
  const [passwordForm, setPasswordForm] = useState<PasswordForm>({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });
  const [changingPassword, setChangingPassword] = useState(false);
  const [showPasswords, setShowPasswords] = useState(false);
  const [photoPreview, setPhotoPreview] = useState<PhotoPreview>(null);

  useEffect(() => {
    if (!profile) return;
    setName(profile.name || '');
    setCourse(profile.course || '');
    setCampus(profile.campus || '');
    setBio(profile.bio || '');
    setAvatar(profile.avatar || '');
    setCoverPhoto(profile.coverPhoto || '');
  }, [profile]);

  useEffect(() => () => {
    if (coverPreview) URL.revokeObjectURL(coverPreview);
  }, [coverPreview]);

  useEffect(() => {
    if (!photoPreview) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPhotoPreview(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [photoPreview]);

  const updateSessionUser = (nextUser: ProfileUser) => {
    const token = localStorage.getItem('token');
    if (token) login(token, nextUser);
  };

  const resetProfileDraft = () => {
    if (!profile) return;
    setName(profile.name || '');
    setCourse(profile.course || '');
    setCampus(profile.campus || '');
    setBio(profile.bio || '');
    setEditing(false);
  };

  const handleProfileUpdate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim()) {
      toast.error('Name is required');
      return;
    }

    setSavingProfile(true);
    try {
      const response = await api.put<ProfileUser>('/users/profile', {
        name: name.trim(),
        course,
        campus,
        bio
      });
      updateSessionUser(response.data);
      toast.success('Profile updated');
      setEditing(false);
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not update your profile'));
    } finally {
      setSavingProfile(false);
    }
  };

  const handleAvatarUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Please choose an image');
      return;
    }

    setUploadingAvatar(true);
    try {
      const uploadFile = await optimizeImageFile(file, {
        maxDimension: 900,
        quality: 0.86,
        minBytes: 300 * 1024
      });
      if (uploadFile.size > 5 * 1024 * 1024) {
        toast.error('Profile photo must be 5MB or smaller');
        return;
      }

      const formData = new FormData();
      formData.append('avatar', uploadFile);
      const response = await api.post<ImageResponse>('/users/avatar', formData);
      const nextAvatar = response.data.avatar || response.data.user?.avatar || '';
      setAvatar(nextAvatar);
      if (response.data.user) updateSessionUser(response.data.user);
      toast.success('Profile photo updated');
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not upload your profile photo'));
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleCoverUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Please choose an image');
      return;
    }

    setUploadingCover(true);
    try {
      const uploadFile = await optimizeImageFile(file, {
        maxDimension: 1800,
        quality: 0.84,
        minBytes: 500 * 1024
      });
      if (uploadFile.size > 5 * 1024 * 1024) {
        toast.error('Cover photo must be 5MB or smaller');
        return;
      }

      setCoverPreview(URL.createObjectURL(uploadFile));
      const formData = new FormData();
      formData.append('coverPhoto', uploadFile);
      const response = await api.post<ImageResponse>('/users/cover-photo', formData);
      const nextCover = response.data.coverPhoto || response.data.user?.coverPhoto || '';
      setCoverPhoto(nextCover);
      setCoverPreview('');
      if (response.data.user) updateSessionUser(response.data.user);
      toast.success('Cover photo updated');
    } catch (error) {
      setCoverPreview('');
      toast.error(getErrorMessage(error, 'Could not upload your cover photo'));
    } finally {
      setUploadingCover(false);
    }
  };

  const handleChangePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const { currentPassword, newPassword, confirmPassword } = passwordForm;
    if (!currentPassword || !newPassword || !confirmPassword) {
      toast.error('Complete all password fields');
      return;
    }
    if (newPassword.length < 6) {
      toast.error('New password must be at least 6 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error('New passwords do not match');
      return;
    }

    setChangingPassword(true);
    try {
      await api.put('/users/password', { currentPassword, newPassword });
      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      toast.success('Password changed');
    } catch (error) {
      toast.error(getErrorMessage(error, 'Could not change your password'));
    } finally {
      setChangingPassword(false);
    }
  };

  if (!profile) return <PageSkeleton variant="profile" rows={4} />;

  const avatarSource = resolveMediaUrl(avatar || profile.avatar || '');
  const coverSource = coverPreview || resolveMediaUrl(coverPhoto || profile.coverPhoto || '');
  const isDeveloper = Boolean(profile.isDeveloper);

  return (
    <div className="mobile-page profile-clean">
      <section className="profile-clean__hero">
        <div className="profile-clean__cover">
          {coverSource ? (
            <button
              type="button"
              className="profile-clean__cover-preview"
              onClick={() => setPhotoPreview({ src: coverSource, alt: `${profile.name || 'Your'} cover photo` })}
              aria-label="View cover photo"
            >
              <img src={coverSource} alt="" onError={event => { event.currentTarget.style.display = 'none'; }} />
              <span>View cover</span>
            </button>
          ) : <div className="profile-clean__cover-fallback" aria-hidden="true" />}
          <label className="profile-clean__cover-action">
            {uploadingCover ? <Loader2 size={16} className="animate-spin" /> : <Camera size={16} />}
            <span>{uploadingCover ? 'Uploading…' : 'Change cover'}</span>
            <input type="file" accept="image/*" onChange={handleCoverUpload} disabled={uploadingCover} />
          </label>
        </div>

        <div className="profile-clean__identity">
          <div className="profile-clean__avatar-control">
            <DeveloperAvatarFrame user={profile} className="profile-clean__avatar-frame">
              <button
                type="button"
                className="profile-clean__avatar-preview"
                onClick={() => avatarSource && setPhotoPreview({ src: avatarSource, alt: `${profile.name || 'Your'} profile picture` })}
                disabled={!avatarSource}
                aria-label="View profile picture"
                title={avatarSource ? 'View profile picture' : undefined}
              >
                <ProfileAvatar name={profile.name} source={avatarSource} />
                {avatarSource && <span className="profile-clean__avatar-view-label">View</span>}
              </button>
            </DeveloperAvatarFrame>
            <label className="profile-clean__avatar-upload" title="Change profile photo">
            <span className="profile-clean__avatar-action">
              {uploadingAvatar ? <Loader2 size={15} className="animate-spin" /> : <Camera size={15} />}
            </span>
              <input type="file" accept="image/*" onChange={handleAvatarUpload} disabled={uploadingAvatar} />
            </label>
          </div>

          <div className="profile-clean__identity-copy">
            <div className="profile-clean__identity-title">
              <h1>{profile.name || 'Your profile'}</h1>
              {isDeveloper && <span className="profile-clean__role"><ShieldCheck size={15} /> Developer</span>}
            </div>
            <p>{[profile.course, profile.campus].filter(Boolean).join(' · ') || 'Add your course and campus to complete your profile.'}</p>
          </div>

          <button type="button" className="profile-clean__edit-button" onClick={() => { setSection('profile'); setEditing(true); }}>
            <Pencil size={16} /> Edit profile
          </button>
        </div>
      </section>

      <nav className="profile-clean__tabs" aria-label="Profile sections">
        <button type="button" className={section === 'profile' ? 'is-active' : ''} onClick={() => setSection('profile')}>
          <UserRound size={17} /> Profile
        </button>
        <button type="button" className={section === 'security' ? 'is-active' : ''} onClick={() => setSection('security')}>
          <Lock size={17} /> Security
        </button>
      </nav>

      {section === 'profile' && (
        <main className="profile-clean__content">
          <section className="profile-clean__surface profile-clean__about">
            <div className="profile-clean__heading">
              <div>
                <h2>About</h2>
                <p>Keep the essentials current so classmates can recognize you.</p>
              </div>
              {!editing && (
                <button type="button" className="profile-clean__quiet-button" onClick={() => setEditing(true)}>
                  <Pencil size={16} /> Edit
                </button>
              )}
            </div>

            {editing ? (
              <form className="profile-clean__form" onSubmit={handleProfileUpdate}>
                <label>
                  <span>Full name</span>
                  <input value={name} onChange={event => setName(event.target.value)} autoComplete="name" />
                </label>
                <label>
                  <span>Course or program</span>
                  <select value={course} onChange={event => setCourse(event.target.value)}>
                    <option value="">Select course</option>
                    {COURSE_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}
                  </select>
                </label>
                <label>
                  <span>Campus</span>
                  <select value={campus} onChange={event => setCampus(event.target.value)}>
                    <option value="">Select campus</option>
                    {CAMPUS_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}
                  </select>
                </label>
                <label className="profile-clean__bio-field">
                  <span>Bio</span>
                  <textarea
                    value={bio}
                    onChange={event => setBio(event.target.value)}
                    rows={4}
                    placeholder="A short introduction for classmates."
                  />
                </label>
                <div className="profile-clean__form-actions">
                  <button type="button" className="profile-clean__quiet-button" onClick={resetProfileDraft} disabled={savingProfile}>
                    <X size={16} /> Cancel
                  </button>
                  <button type="submit" className="profile-clean__primary-button" disabled={savingProfile}>
                    {savingProfile ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                    {savingProfile ? 'Saving…' : 'Save changes'}
                  </button>
                </div>
              </form>
            ) : (
              <>
                <div className="profile-clean__bio">
                  <p>{profile.bio || 'No bio yet. Add a short introduction to make your profile more personal.'}</p>
                </div>
                <dl className="profile-clean__details">
                  <Detail label="Email" icon={Mail}>{profile.email || 'Not available'}</Detail>
                  <Detail label="Course" icon={UserRound}>{profile.course || 'Not set'}</Detail>
                  <Detail label="Campus" icon={MapPin}>{profile.campus || 'Not set'}</Detail>
                </dl>
              </>
            )}
          </section>

          <aside className="profile-clean__sidebar">
            <section className="profile-clean__surface profile-clean__account-card">
              <span className="profile-clean__account-icon"><ImageIcon size={19} /></span>
              <h2>Profile photos</h2>
              <p>Use the photo controls above to update your profile image or cover.</p>
              <div className="profile-clean__account-status">
                <span className={avatarSource ? 'is-ready' : ''}><Check size={15} /> Profile photo</span>
                <span className={coverSource ? 'is-ready' : ''}><Check size={15} /> Cover photo</span>
              </div>
            </section>
            <section className="profile-clean__member-card">
              <p>Member since</p>
              <strong>{formatMemberSince(profile.createdAt)}</strong>
            </section>
          </aside>
        </main>
      )}

      {section === 'security' && (
        <main className="profile-clean__security-layout">
          <section className="profile-clean__surface profile-clean__security-card">
            <div className="profile-clean__heading">
              <div>
                <h2>Password</h2>
                <p>Use a password only you know. Your password remains protected in the system.</p>
              </div>
              <span className="profile-clean__security-icon"><ShieldCheck size={21} /></span>
            </div>

            <form className="profile-clean__form" onSubmit={handleChangePassword}>
              <label>
                <span>Current password</span>
                <input
                  type={showPasswords ? 'text' : 'password'}
                  value={passwordForm.currentPassword}
                  onChange={event => setPasswordForm(current => ({ ...current, currentPassword: event.target.value }))}
                  autoComplete="current-password"
                />
              </label>
              <label>
                <span>New password</span>
                <input
                  type={showPasswords ? 'text' : 'password'}
                  value={passwordForm.newPassword}
                  onChange={event => setPasswordForm(current => ({ ...current, newPassword: event.target.value }))}
                  autoComplete="new-password"
                />
              </label>
              <label>
                <span>Confirm new password</span>
                <input
                  type={showPasswords ? 'text' : 'password'}
                  value={passwordForm.confirmPassword}
                  onChange={event => setPasswordForm(current => ({ ...current, confirmPassword: event.target.value }))}
                  autoComplete="new-password"
                />
              </label>
              <div className="profile-clean__form-actions">
                <button type="button" className="profile-clean__quiet-button" onClick={() => setShowPasswords(value => !value)}>
                  {showPasswords ? <EyeOff size={16} /> : <Eye size={16} />}
                  {showPasswords ? 'Hide passwords' : 'Show passwords'}
                </button>
                <button type="submit" className="profile-clean__primary-button" disabled={changingPassword}>
                  {changingPassword ? <Loader2 size={16} className="animate-spin" /> : <Lock size={16} />}
                  {changingPassword ? 'Updating…' : 'Change password'}
                </button>
              </div>
            </form>
          </section>

          <section className="profile-clean__signout-card">
            <div>
              <h2>Sign out</h2>
              <p>End this session on the current device.</p>
            </div>
            <button type="button" className="profile-clean__signout-button" onClick={logout}>
              <LogOut size={17} /> Sign out
            </button>
          </section>
        </main>
      )}

      {photoPreview && (
        <div
          className="profile-clean__photo-viewer"
          role="dialog"
          aria-modal="true"
          aria-label={photoPreview.alt}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setPhotoPreview(null);
          }}
        >
          <div className="profile-clean__photo-viewer-content">
            <img src={photoPreview.src} alt={photoPreview.alt} />
            <button type="button" onClick={() => setPhotoPreview(null)} aria-label="Close photo preview">
              <X size={19} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
