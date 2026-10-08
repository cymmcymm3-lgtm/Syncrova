import React, { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { KeyRound, LogIn, Mail, ShieldCheck, X } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { AuthLayout, AuthPasswordField, AuthSubmit } from './AuthBackground';

const errorMessage = (error: any, fallback: string) => error?.response?.data?.msg
  || (error?.code === 'ECONNABORTED' || error?.code === 'ERR_NETWORK'
    ? 'We could not reach Syncrova. Please check your connection and try again.'
    : fallback);

function PasswordResetDialog({ initialEmail, initialToken, onClose }: { initialEmail: string; initialToken: string; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [email, setEmail] = useState(initialEmail);
  const [token, setToken] = useState(initialToken);
  const [manualCode, setManualCode] = useState(!initialToken);
  const [step, setStep] = useState<'request' | 'reset'>(initialToken ? 'reset' : 'request');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const { login } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  const requestReset = async (event: FormEvent) => {
    event.preventDefault();
    if (loading) return;
    setLoading(true);
    setError('');
    setNotice('');
    try {
      const response = await api.post('/auth/forgot-password', { email: email.trim() });
      if (response.data?.resetToken) {
        setToken(response.data.resetToken);
        setManualCode(false);
        setStep('reset');
      } else {
        setNotice(response.data?.emailConfigured
          ? 'If this email has an account, check your inbox for a reset link.'
          : 'Email recovery is not available yet. Ask your Syncrova administrator for a private reset link, then open it to choose a new password.');
      }
    } catch (err) {
      setError(errorMessage(err, 'We could not start your password reset. Please try again.'));
    } finally {
      setLoading(false);
    }
  };

  const resetPassword = async (event: FormEvent) => {
    event.preventDefault();
    if (loading) return;
    setError('');
    if (password !== confirmation) {
      setError('Your passwords do not match. Please try again.');
      return;
    }
    setLoading(true);
    try {
      const response = await api.post('/auth/reset-password', { token: token.trim(), password });
      login(response.data.token, response.data.user);
      toast.success('Your password has been updated. Welcome back!');
      navigate('/dashboard');
    } catch (err) {
      setError(errorMessage(err, 'We could not update your password. Please try again.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <dialog ref={dialogRef} className="sv-auth-dialog" aria-labelledby="reset-title" aria-describedby="reset-description" onCancel={event => { event.preventDefault(); if (!loading) onClose(); }}>
      <div className="sv-auth-dialog-heading">
        <span className="sv-auth-form-icon"><KeyRound size={21} /></span>
        <button type="button" className="sv-auth-dialog-close" aria-label="Close password reset" onClick={onClose} disabled={loading}><X size={18} /></button>
      </div>
      <h2 id="reset-title">{step === 'request' ? 'Let’s get you back in.' : 'A fresh start.'}</h2>
      <p id="reset-description" className="sv-auth-description">{step === 'request' ? 'Enter your account email to get started with password recovery.' : 'Choose a new password for your Syncrova account.'}</p>
      {step === 'reset' && email && <p className="sv-auth-reset-account"><Mail size={16} aria-hidden="true" />{email}</p>}
      {error && <p className="sv-auth-error" role="alert">{error}</p>}
      {notice && <p className="sv-auth-error" role="status">{notice}</p>}
      {step === 'request' ? (
        <form className="sv-auth-form" onSubmit={requestReset}>
          <div className="sv-auth-field">
            <label htmlFor="recovery-email">Account email</label>
            <div className="sv-auth-input-wrap"><Mail size={18} aria-hidden="true" /><input id="recovery-email" name="email" type="email" autoComplete="email" placeholder="you@nemsu.edu.ph" value={email} onChange={event => setEmail(event.target.value)} required disabled={loading} /></div>
          </div>
          <AuthSubmit loading={loading}>{loading ? 'Checking recovery options…' : 'Continue'}</AuthSubmit>
        </form>
      ) : (
        <form className="sv-auth-form" onSubmit={resetPassword}>
          {manualCode && <div className="sv-auth-field">
            <label htmlFor="recovery-code">Reset code</label>
            <div className="sv-auth-input-wrap"><KeyRound size={18} aria-hidden="true" /><input id="recovery-code" name="reset-code" placeholder="Paste your private reset code" value={token} onChange={event => setToken(event.target.value)} autoComplete="off" required disabled={loading} /></div>
          </div>}
          <AuthPasswordField id="new-password" label="New password" autoComplete="new-password" value={password} onChange={setPassword} minLength={6} placeholder="Create a new password" hint="At least 6 characters. Make it unique to you." disabled={loading} />
          <AuthPasswordField id="confirm-password" label="Confirm new password" autoComplete="new-password" value={confirmation} onChange={setConfirmation} minLength={6} placeholder="Enter your new password again" disabled={loading} />
          <AuthSubmit loading={loading} disabled={!token.trim() || password.length < 6 || !confirmation}>{loading ? 'Updating your password…' : 'Save password & sign in'}</AuthSubmit>
        </form>
      )}
      <div className="sv-auth-dialog-footer">
        <button type="button" className="sv-auth-text-link" onClick={() => { setStep(step === 'request' ? 'reset' : 'request'); setError(''); setNotice(''); }} disabled={loading}>{step === 'request' ? 'I have a reset code' : 'Request a new link'}</button>
        <button type="button" className="sv-auth-text-link" onClick={onClose} disabled={loading}>Back to sign in</button>
      </div>
    </dialog>
  );
}

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [recovery, setRecovery] = useState<{ email: string; token: string } | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const { login } = useAuth();

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const resetToken = params.get('resetToken');
    if (resetToken) {
      setRecovery({ email: params.get('resetEmail') || '', token: resetToken });
      // Remove the private link from the address bar and browser history.
      navigate('/login', { replace: true });
    }
  }, [location.search, navigate]);

  useEffect(() => {
    const controller = new AbortController();
    api.get('/ping', { timeout: 12000, signal: controller.signal }).catch(() => {});
    return () => controller.abort();
  }, []);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (loading) return;
    setLoading(true);
    setError('');
    try {
      const response = await api.post('/auth/login', { email: email.trim(), password });
      login(response.data.token, response.data.user);
      toast.success('Welcome back!');
      navigate('/dashboard');
    } catch (err) {
      setError(errorMessage(err, 'We could not sign you in. Please try again.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout mode="login">
      <span className="sv-auth-form-icon"><LogIn size={22} aria-hidden="true" /></span>
      <h1 id="auth-title">Welcome back.</h1>
      <p className="sv-auth-description">Good to see you again. Sign in to pick up<br className="sv-auth-desktop-break" /> where you left off.</p>
      {error && <p className="sv-auth-error" role="alert">{error}</p>}
      <form className="sv-auth-form" onSubmit={handleSubmit}>
        <div className="sv-auth-field">
          <label htmlFor="login-email">Email address</label>
          <div className="sv-auth-input-wrap"><Mail size={18} aria-hidden="true" /><input id="login-email" name="email" type="email" autoComplete="email" placeholder="you@nemsu.edu.ph" value={email} onChange={event => setEmail(event.target.value)} required disabled={loading} /></div>
        </div>
        <AuthPasswordField id="login-password" value={password} onChange={setPassword} disabled={loading} />
        <div className="sv-auth-forgot-row"><button type="button" className="sv-auth-text-link" onClick={() => setRecovery({ email, token: '' })}>Forgot password?</button></div>
        <AuthSubmit loading={loading}>{loading ? 'Signing you in…' : 'Sign in to Syncrova'}</AuthSubmit>
      </form>
      <div className="sv-auth-divider">a place for your people</div>
      <p className="sv-auth-switch">Don’t have an account?<Link to="/register">Create an account</Link></p>
      <p className="sv-auth-trust"><ShieldCheck size={14} aria-hidden="true" /> A secure space for your campus connections.</p>
      {recovery && <PasswordResetDialog initialEmail={recovery.email} initialToken={recovery.token} onClose={() => setRecovery(null)} />}
    </AuthLayout>
  );
}
