import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View
} from 'react-native';
import { AxiosError } from 'axios';
import { ArrowRight, Eye, EyeOff, Lock, Mail, UserRound } from 'lucide-react-native';
import api from '../services/api';
import { useAuth } from '../store/AuthContext';

const syncrovaLogo = require('../../assets/syncrova-app-logo.png');

export default function LoginScreen() {
  const { login, register } = useAuth();
  const { height } = useWindowDimensions();
  const compact = height < 760;
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const isRegister = mode === 'register';
  const submitDisabled = submitting
    || !email.trim()
    || !password
    || (isRegister && (!name.trim() || password.length < 6 || password !== confirmPassword));

  useEffect(() => {
    api.get('/ping', { timeout: 12000 }).catch(() => {});
  }, []);

  const submit = async () => {
    if (submitDisabled) return;
    setSubmitting(true);
    setError('');
    try {
      if (isRegister) {
        await register({ name: name.trim(), email: email.trim(), password });
      } else {
        await login(email.trim(), password);
      }
    } catch (err) {
      const axiosError = err as AxiosError<{ msg?: string }>;
      setError(axiosError.response?.data?.msg || (isRegister ? 'Sign up failed' : 'Login failed'));
    } finally {
      setSubmitting(false);
    }
  };

  const switchMode = () => {
    setMode(value => (value === 'login' ? 'register' : 'login'));
    setError('');
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior={Platform.select({ ios: 'padding', android: undefined })}
        style={styles.keyboard}
      >
        <ScrollView
          contentContainerStyle={[styles.scrollContent, compact && styles.scrollContentCompact]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={[styles.hero, compact && styles.heroCompact]}>
            <View style={[styles.logoWrap, compact && styles.logoWrapCompact]}>
              <Image resizeMode="contain" source={syncrovaLogo} style={[styles.logoImage, compact && styles.logoImageCompact]} />
            </View>
            <Text style={[styles.appName, compact && styles.appNameCompact]} numberOfLines={1}>
              Syncrova Messenger
            </Text>
            <Text style={[styles.tagline, compact && styles.taglineCompact]}>
              Sign in to continue your realtime campus conversations.
            </Text>
          </View>

          <View style={[styles.card, compact && styles.cardCompact]}>
            <View style={styles.accentLine} />
            <Text style={styles.title}>{isRegister ? 'Create account' : 'Welcome back'}</Text>
            <Text style={styles.subtitle}>
              {isRegister ? 'Use this account for Syncrova and Messenger.' : 'Use your Syncrova account to open chats.'}
            </Text>

            {isRegister ? (
              <View style={styles.fieldGroup}>
                <Text style={styles.label}>Full Name</Text>
                <View style={styles.inputShell}>
                  <UserRound color="#0A7CFF" size={19} />
                  <TextInput
                    autoCapitalize="words"
                    autoCorrect={false}
                    onChangeText={setName}
                    placeholder="Your name"
                    placeholderTextColor="#94A3B8"
                    returnKeyType="next"
                    style={styles.input}
                    textContentType="name"
                    value={name}
                  />
                </View>
              </View>
            ) : null}

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Student Email</Text>
              <View style={styles.inputShell}>
                <Mail color="#0891B2" size={19} />
                <TextInput
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  onChangeText={setEmail}
                  placeholder="example@nemsu.edu.ph"
                  placeholderTextColor="#94A3B8"
                  returnKeyType="next"
                  style={styles.input}
                  textContentType="emailAddress"
                  value={email}
                />
              </View>
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Password</Text>
              <View style={styles.inputShell}>
                <Lock color="#DB2777" size={19} />
                <TextInput
                  onChangeText={setPassword}
                  onSubmitEditing={submit}
                  placeholder="Enter your password"
                  placeholderTextColor="#94A3B8"
                  returnKeyType="done"
                  secureTextEntry={!showPassword}
                  style={styles.input}
                  textContentType="password"
                  value={password}
                />
                <Pressable
                  accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
                  hitSlop={10}
                  onPress={() => setShowPassword(value => !value)}
                  style={styles.eyeButton}
                >
                  {showPassword ? <EyeOff color="#64748B" size={20} /> : <Eye color="#64748B" size={20} />}
                </Pressable>
              </View>
            </View>

            {isRegister ? (
              <View style={styles.fieldGroup}>
                <Text style={styles.label}>Confirm Password</Text>
                <View style={styles.inputShell}>
                  <Lock color="#DB2777" size={19} />
                  <TextInput
                    onChangeText={setConfirmPassword}
                    onSubmitEditing={submit}
                    placeholder="Repeat your password"
                    placeholderTextColor="#94A3B8"
                    returnKeyType="done"
                    secureTextEntry={!showPassword}
                    style={styles.input}
                    textContentType="password"
                    value={confirmPassword}
                  />
                </View>
              </View>
            ) : null}

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <Pressable
              android_ripple={{ color: 'rgba(255,255,255,0.18)' }}
              disabled={submitDisabled}
              onPress={submit}
              style={({ pressed }) => [
                styles.loginButton,
                submitDisabled && styles.loginButtonDisabled,
                pressed && !submitting ? styles.loginButtonPressed : null
              ]}
            >
              {submitting ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <View style={styles.loginButtonContent}>
                  <Text style={styles.loginButtonText}>{isRegister ? 'Sign up' : 'Sign in'}</Text>
                  <ArrowRight color="#FFFFFF" size={18} />
                </View>
              )}
            </Pressable>

            <Pressable onPress={switchMode} style={styles.modeSwitch}>
              <Text style={styles.modeSwitchText}>
                {isRegister ? 'Already have an account? Sign in' : 'No account yet? Sign up'}
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#08111F'
  },
  keyboard: {
    flex: 1
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'flex-start',
    paddingHorizontal: 20,
    paddingBottom: 36,
    paddingTop: 18
  },
  scrollContentCompact: {
    paddingBottom: 22,
    paddingTop: 8
  },
  hero: {
    alignItems: 'center',
    marginBottom: 14
  },
  heroCompact: {
    marginBottom: 10
  },
  logoWrap: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    height: 58,
    justifyContent: 'center',
    shadowColor: '#0A7CFF',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.32,
    shadowRadius: 22,
    width: 58,
    elevation: 8
  },
  logoWrapCompact: {
    borderRadius: 17,
    height: 50,
    width: 50
  },
  logoImage: {
    height: 48,
    width: 48
  },
  logoImageCompact: {
    height: 42,
    width: 42
  },
  appName: {
    color: '#FFFFFF',
    fontSize: 26,
    fontWeight: '900',
    letterSpacing: 0,
    marginTop: 12
  },
  appNameCompact: {
    fontSize: 23,
    marginTop: 9
  },
  tagline: {
    color: 'rgba(255,255,255,0.68)',
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 21,
    marginTop: 6,
    maxWidth: 310,
    textAlign: 'center'
  },
  taglineCompact: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    overflow: 'hidden',
    padding: 20,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.24,
    shadowRadius: 28,
    elevation: 10
  },
  cardCompact: {
    borderRadius: 22,
    padding: 16
  },
  accentLine: {
    backgroundColor: '#0A7CFF',
    height: 4,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0
  },
  title: {
    color: '#0F172A',
    fontSize: 25,
    fontWeight: '900',
    letterSpacing: 0,
    marginTop: 6,
    textAlign: 'center'
  },
  subtitle: {
    color: '#64748B',
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 19,
    marginBottom: 16,
    marginTop: 6,
    textAlign: 'center'
  },
  fieldGroup: {
    marginBottom: 11
  },
  label: {
    color: '#334155',
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 7
  },
  inputShell: {
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderColor: '#E2E8F0',
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row',
    minHeight: 56,
    paddingHorizontal: 14
  },
  input: {
    color: '#0F172A',
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    minHeight: 54,
    paddingHorizontal: 11
  },
  eyeButton: {
    alignItems: 'center',
    height: 38,
    justifyContent: 'center',
    width: 38
  },
  error: {
    color: '#DC2626',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 10
  },
  loginButton: {
    alignItems: 'center',
    backgroundColor: '#0A7CFF',
    borderRadius: 18,
    display: 'flex',
    height: 56,
    justifyContent: 'center',
    marginTop: 4,
    shadowColor: '#0A7CFF',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.28,
    shadowRadius: 18,
    elevation: 7,
    width: '100%',
    zIndex: 3
  },
  loginButtonDisabled: {
    backgroundColor: '#94A3B8',
    shadowOpacity: 0
  },
  loginButtonPressed: {
    opacity: 0.88,
    transform: [{ scale: 0.99 }]
  },
  loginButtonContent: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8
  },
  loginButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '900'
  },
  modeSwitch: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 42,
    paddingTop: 10
  },
  modeSwitchText: {
    color: '#0A7CFF',
    fontSize: 14,
    fontWeight: '900'
  }
});
