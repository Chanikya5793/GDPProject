import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView, Image,
} from 'react-native';
import { router } from 'expo-router';
import { useAuth } from '@/contexts/AuthContext';
import { useAppTheme } from '@/theme/useAppTheme';
import { createStyles } from '@/theme/createStyles';
import { campusEmail } from '@/utils/campusEmail';

export default function LoginScreen() {
  const { login, register, configured, requestPasswordReset } = useAuth();
  const { colors, accent, appearance } = useAppTheme();
  const [mode, setMode] = useState<'login' | 'register' | 'reset'>('login');
  const isRegister = mode === 'register';
  const isReset = mode === 'reset';
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const changeMode = (next: typeof mode) => {
    setMode(next);
    setError('');
    setNotice('');
    setPassword('');
  };

  const handleSubmit = async () => {
    if (busy) return;
    setError('');
    setNotice('');
    if (!email.trim() || (!isReset && !password.trim())) {
      setError('Please fill in all fields');
      return;
    }
    if (isRegister && !name.trim()) {
      setError('Please enter your name');
      return;
    }

    setBusy(true);
    try {
      if (isReset) {
        const result = await requestPasswordReset(email);
        if (result.success) setNotice('If a planner account exists for that address, a password reset link will arrive by email.');
        else setError(result.error || 'Could not send password reset email.');
        return;
      }
      const result = isRegister
        ? await register(name.trim(), email.trim(), password)
        : await login(email.trim(), password);

      if (result.success) router.replace('/(tabs)');
      else setError(result.error || 'Authentication failed.');
    } finally {
      setBusy(false);
    }
  };

  const styles = makeStyles(colors, accent, appearance);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.logoSection}>
          <View style={[styles.logoCircle, { backgroundColor: accent.surface }]}>
            <Text style={[styles.logoText, { color: accent.primary }]}>NW</Text>
          </View>
          <Text style={styles.title}>Northwest</Text>
          <Text style={styles.subtitle}>Student Planner</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>
            {{ login: 'Welcome Back', register: 'Create Account', reset: 'Reset your password' }[mode]}
          </Text>

          {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
          {notice ? <Text accessibilityLiveRegion="polite" style={styles.hint}>{notice}</Text> : null}

          {isRegister && (
            <View style={styles.field}>
              <Text style={styles.label}>Name</Text>
              <TextInput
                style={styles.input}
                value={name}
                onChangeText={setName}
                placeholder="Your name"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="words"
              />
            </View>
          )}

          <View style={styles.field}>
            <Text style={styles.label}>S number or NW email</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="S123456"
              placeholderTextColor={colors.textMuted}
              keyboardType="email-address"
              textContentType="username"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect={false}
            />
            {email.trim() && !email.includes('@') ? (
              <Text style={styles.hint}>{isReset ? 'Reset email goes to' : 'Signs in as'} {campusEmail(email)}</Text>
            ) : null}
          </View>

          {!isReset && (
            <View style={styles.field}>
              <Text style={styles.label}>Password</Text>
              <TextInput
                style={styles.input}
                value={password}
                onChangeText={setPassword}
                placeholder="Password"
                placeholderTextColor={colors.textMuted}
                secureTextEntry
              />
            </View>
          )}

          <TouchableOpacity
            style={[styles.button, { backgroundColor: accent.primary }]}
            onPress={handleSubmit}
            disabled={busy}
            activeOpacity={0.8}
          >
            <Text style={styles.buttonText}>
              {{ login: 'Sign In', register: 'Create Account', reset: 'Send reset link' }[mode]}
            </Text>
          </TouchableOpacity>

          {configured && mode === 'login' && (
            <TouchableOpacity onPress={() => changeMode('reset')} style={styles.toggleBtn} disabled={busy}>
              <Text style={[styles.toggleText, { color: accent.primary }]}>Forgot password?</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            onPress={() => changeMode(mode === 'login' ? 'register' : 'login')}
            disabled={busy}
            style={styles.toggleBtn}
          >
            <Text style={[styles.toggleText, { color: accent.primary }]}>
              {{ login: "Don't have an account? Register", register: 'Already have an account? Sign In', reset: 'Back to sign in' }[mode]}
            </Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.disclaimer}>
          Planner data is encrypted on this device and scoped to your authenticated account.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function makeStyles(colors: ReturnType<typeof useAppTheme>['colors'], accent: ReturnType<typeof useAppTheme>['accent'], appearance: ReturnType<typeof useAppTheme>['appearance']) {
  return createStyles(appearance)({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    scroll: {
      flexGrow: 1,
      justifyContent: 'center',
      padding: 24,
    },
    logoSection: {
      alignItems: 'center',
      marginBottom: 32,
    },
    logoCircle: {
      width: 72,
      height: 72,
      borderRadius: 36,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 12,
    },
    logoText: {
      fontSize: 28,
      fontWeight: '800',
    },
    title: {
      fontSize: 28,
      fontWeight: '700',
      color: colors.text,
    },
    subtitle: {
      fontSize: 16,
      color: colors.textSecondary,
      marginTop: 2,
    },
    card: {
      backgroundColor: colors.card,
      borderRadius: 16,
      padding: 24,
      ...(Platform.OS === 'android' ? {
        elevation: 2,
      } : {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.08,
        shadowRadius: 12,
      }),
    },
    cardTitle: {
      fontSize: 20,
      fontWeight: '600',
      color: colors.text,
      marginBottom: 20,
    },
    field: {
      marginBottom: 16,
    },
    label: {
      fontSize: 14,
      fontWeight: '500',
      color: colors.textSecondary,
      marginBottom: 6,
    },
    hint: {
      fontSize: 12,
      color: colors.textMuted,
      marginTop: 6,
    },
    input: {
      backgroundColor: colors.surfaceVariant,
      borderRadius: 10,
      padding: 14,
      fontSize: 16,
      color: colors.text,
      borderWidth: 1,
      borderColor: colors.border,
    },
    button: {
      borderRadius: 10,
      padding: 16,
      alignItems: 'center',
      marginTop: 8,
    },
    buttonText: {
      color: '#FFFFFF',
      fontSize: 16,
      fontWeight: '600',
    },
    toggleBtn: {
      marginTop: 16,
      alignItems: 'center',
    },
    toggleText: {
      fontSize: 14,
      fontWeight: '500',
    },
    error: {
      color: colors.error,
      fontSize: 14,
      marginBottom: 12,
      textAlign: 'center',
    },
    disclaimer: {
      textAlign: 'center',
      color: colors.textMuted,
      fontSize: 12,
      marginTop: 24,
    },
  });
}
