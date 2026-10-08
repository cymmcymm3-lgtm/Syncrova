import React, { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, BookOpen, Check, Eye, EyeOff, Heart, Loader2, LockKeyhole, MessageCircle, Send, ShieldCheck, Sparkles, Users } from 'lucide-react';
import './auth.css';

export function AuthBrand() {
  return (
    <Link to="/login" className="sv-auth-brand" aria-label="Syncrova home">
      <img src="/syncrova-app-logo.png" alt="" width="42" height="42" />
      <span>Syncrova<span className="sv-auth-brand-dot">.</span></span>
    </Link>
  );
}

function CampusIllustration() {
  return (
    <div className="sv-auth-illustration" aria-hidden="true">
      <div className="sv-auth-orbit sv-auth-orbit-one" />
      <div className="sv-auth-orbit sv-auth-orbit-two" />
      <span className="sv-auth-spark sv-auth-spark-one"><Sparkles size={25} /></span>
      <span className="sv-auth-spark sv-auth-spark-two"><Sparkles size={16} /></span>
      <div className="sv-auth-note">
        <span className="sv-auth-note-icon"><BookOpen size={19} /></span>
        <div><strong>A little more together.</strong><span>Big ideas start with a conversation.</span></div>
      </div>
      <div className="sv-auth-preview">
        <div className="sv-auth-preview-top">
          <span className="sv-auth-preview-avatar"><Users size={22} /></span>
          <div><strong>The study circle</strong><span>Your people. Your space.</span></div>
          <span className="sv-auth-preview-menu">···</span>
        </div>
        <div className="sv-auth-preview-body">
          <span className="sv-auth-preview-day">A LITTLE CAMPUS INSPIRATION</span>
          <div className="sv-auth-bubble">Library session after class? <BookOpen size={15} /></div>
          <div className="sv-auth-bubble sv-auth-bubble-own">Count me in! <Heart size={15} /></div>
          <div className="sv-auth-preview-read"><Check size={12} /><Check size={12} /> Better, together</div>
        </div>
        <div className="sv-auth-preview-compose"><span>Let a good conversation begin...</span><span><Send size={16} /></span></div>
      </div>
      <div className="sv-auth-connect-note">
        <span className="sv-auth-connect-icon"><MessageCircle size={20} /></span>
        <div><strong>Real connections.</strong><span>Right here on campus.</span></div>
        <span className="sv-auth-connect-check"><Check size={14} /></span>
      </div>
    </div>
  );
}

export function AuthLayout({ mode, children }: { mode: 'login' | 'register'; children: ReactNode }) {
  const registering = mode === 'register';
  return (
    <div className={`sv-auth sv-auth--${mode}`}>
      <div className="sv-auth-shell">
        <header className="sv-auth-header">
          <AuthBrand />
          <div className="sv-auth-header-action">
            <span>{registering ? 'Already part of the community?' : 'New around here?'}</span>
            <Link to={registering ? '/login' : '/register'}>{registering ? 'Sign in' : 'Join Syncrova'}<ArrowRight size={15} /></Link>
          </div>
        </header>
        <main className="sv-auth-main">
          <aside className="sv-auth-showcase" aria-label="Welcome to the Syncrova community">
            <div className="sv-auth-showcase-copy">
              <span className="sv-auth-eyebrow"><span /> YOUR CAMPUS, CONNECTED</span>
              <h2>{registering ? <>Good things start<br />with <em>your people.</em></> : <>Your campus.<br />A little <em>closer.</em></>}</h2>
              <p>{registering ? 'Find your circle, share your ideas, and make more of campus life. It all starts here.' : 'The conversations, connections, and little moments that make campus feel like home.'}</p>
            </div>
            <CampusIllustration />
            <div className="sv-auth-showcase-footer"><span><MessageCircle size={15} /> Connect</span><span><BookOpen size={15} /> Collaborate</span><span><Sparkles size={15} /> Create</span></div>
          </aside>
          <section className="sv-auth-form-panel" aria-labelledby="auth-title">{children}</section>
        </main>
        <footer className="sv-auth-footer"><span>© {new Date().getFullYear()} Syncrova</span><span>Made for campus life.</span><span><ShieldCheck size={14} /> Your connection starts here</span></footer>
      </div>
    </div>
  );
}

interface PasswordFieldProps {
  id: string;
  label?: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  placeholder?: string;
  minLength?: number;
  hint?: string;
  disabled?: boolean;
}

export function AuthPasswordField({ id, label = 'Password', value, onChange, autoComplete = 'current-password', placeholder = 'Enter your password', minLength, hint, disabled }: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="sv-auth-field">
      <label htmlFor={id}>{label}</label>
      <div className="sv-auth-input-wrap">
        <LockKeyhole size={18} aria-hidden="true" />
        <input id={id} name={id} type={visible ? 'text' : 'password'} value={value} onChange={event => onChange(event.target.value)} autoComplete={autoComplete} placeholder={placeholder} minLength={minLength} required disabled={disabled} aria-describedby={hint ? `${id}-hint` : undefined} className="sv-auth-password-input" />
        <button className="sv-auth-password-toggle" type="button" onClick={() => setVisible(current => !current)} aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`} aria-pressed={visible} disabled={disabled}>{visible ? <EyeOff size={18} /> : <Eye size={18} />}</button>
      </div>
      {hint && <p id={`${id}-hint`} className="sv-auth-hint">{hint}</p>}
    </div>
  );
}

export function AuthSubmit({ loading, children, disabled = false }: { loading: boolean; children: ReactNode; disabled?: boolean }) {
  return <button type="submit" className="sv-auth-submit" disabled={loading || disabled} aria-busy={loading}><span>{children}</span>{loading ? <Loader2 size={18} className="sv-auth-spinner" aria-hidden="true" /> : <ArrowRight size={18} aria-hidden="true" />}</button>;
}
