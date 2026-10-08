import React, { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Building2, ChevronDown, GraduationCap, Mail, ShieldCheck, User, UserPlus } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { CAMPUS_OPTIONS, COURSE_OPTIONS } from '../utils/academics';
import { AuthLayout, AuthPasswordField, AuthSubmit } from './AuthBackground';

export default function Register() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [adminCode, setAdminCode] = useState('');
  const [course, setCourse] = useState('');
  const [campus, setCampus] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const { login } = useAuth();

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (loading) return;
    setError('');
    if (password !== confirmation) {
      setError('Your passwords do not match. Please enter the same password in both fields.');
      return;
    }
    setLoading(true);
    try {
      const response = await api.post('/auth/register', { name: name.trim(), email: email.trim(), password, course, campus, adminCode });
      login(response.data.token, response.data.user);
      toast.success('Welcome to Syncrova!');
      navigate('/dashboard');
    } catch (err) {
      setError(err?.response?.data?.msg || 'We could not create your account. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout mode="register">
      <span className="sv-auth-form-icon"><UserPlus size={22} aria-hidden="true" /></span>
      <h1 id="auth-title">Your next chapter.</h1>
      <p className="sv-auth-description">Create your account. Your campus community awaits.</p>
      {error && <p className="sv-auth-error" role="alert">{error}</p>}
      <form className="sv-auth-form" onSubmit={handleSubmit}>
        <div className="sv-auth-field">
          <label htmlFor="register-name">Full name</label>
          <div className="sv-auth-input-wrap"><User size={18} aria-hidden="true" /><input id="register-name" name="name" autoComplete="name" placeholder="Your full name" value={name} onChange={event => setName(event.target.value)} required disabled={loading} /></div>
        </div>
        <div className="sv-auth-field">
          <label htmlFor="register-email">Email address</label>
          <div className="sv-auth-input-wrap"><Mail size={18} aria-hidden="true" /><input id="register-email" name="email" type="email" autoComplete="email" placeholder="you@nemsu.edu.ph" value={email} onChange={event => setEmail(event.target.value)} required disabled={loading} /></div>
        </div>
        <div className="sv-auth-field-row">
          <div className="sv-auth-field">
            <label htmlFor="register-campus">Your campus</label>
            <div className="sv-auth-input-wrap"><Building2 size={18} aria-hidden="true" /><select id="register-campus" name="campus" value={campus} onChange={event => setCampus(event.target.value)} required disabled={loading}><option value="">Select campus</option>{CAMPUS_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}</select><ChevronDown size={14} className="sv-auth-select-chevron" aria-hidden="true" /></div>
          </div>
          <div className="sv-auth-field">
            <label htmlFor="register-course">Your course</label>
            <div className="sv-auth-input-wrap"><GraduationCap size={18} aria-hidden="true" /><select id="register-course" name="course" value={course} onChange={event => setCourse(event.target.value)} required disabled={loading}><option value="">Select course</option>{COURSE_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}</select><ChevronDown size={14} className="sv-auth-select-chevron" aria-hidden="true" /></div>
          </div>
        </div>
        <div className="sv-auth-field-row">
          <AuthPasswordField id="register-password" value={password} onChange={setPassword} autoComplete="new-password" placeholder="6+ characters" minLength={6} disabled={loading} />
          <AuthPasswordField id="register-confirm" label="Confirm password" value={confirmation} onChange={setConfirmation} autoComplete="new-password" placeholder="Confirm it" minLength={6} disabled={loading} />
        </div>
        <details className="sv-auth-admin">
          <summary>Have a developer setup code?</summary>
          <div className="sv-auth-field"><label htmlFor="register-admin">Developer setup code <span>(optional)</span></label><div className="sv-auth-input-wrap"><ShieldCheck size={18} aria-hidden="true" /><input id="register-admin" name="adminCode" type="password" autoComplete="off" value={adminCode} onChange={event => setAdminCode(event.target.value)} placeholder="Enter your assigned code" disabled={loading} /></div></div>
        </details>
        <AuthSubmit loading={loading}>{loading ? 'Creating your account…' : 'Create my account'}</AuthSubmit>
      </form>
      <p className="sv-auth-switch">Already have an account?<Link to="/login">Sign in</Link></p>
      <p className="sv-auth-trust"><ShieldCheck size={14} aria-hidden="true" /> Your password is safely protected.</p>
    </AuthLayout>
  );
}
