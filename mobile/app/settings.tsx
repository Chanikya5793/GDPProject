import { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, TextInput,
  Switch, Alert, Platform,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/contexts/AuthContext';
import { useSettings } from '@/contexts/SettingsContext';
import { useAppTheme } from '@/theme/useAppTheme';

const ACCENT_COLORS = [
  { id: 'green' as const, label: 'Green', color: '#006A4E' },
  { id: 'blue' as const, label: 'Blue', color: '#3B82F6' },
  { id: 'purple' as const, label: 'Purple', color: '#7C3AED' },
  { id: 'amber' as const, label: 'Amber', color: '#D97706' },
];

export default function SettingsScreen() {
  const { user, updateUser, logout } = useAuth();
  const { settings, updateSetting, resetSettings } = useSettings();
  const { colors, accent } = useAppTheme();

  const [name, setName] = useState(user?.name || '');
  const [email, setEmail] = useState(user?.email || '');

  const saveProfile = () => {
    if (!name.trim()) return;
    updateUser({ name: name.trim(), email: email.trim() });
    Alert.alert('Saved', 'Profile updated.');
  };

  const handleLogout = () => {
    Alert.alert('Sign Out', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: async () => {
        await logout();
        router.replace('/login');
      }},
    ]);
  };

  const s = makeStyles(colors, accent);
  const profileChanged = name !== user?.name || email !== user?.email;

  const initials = (user?.name || 'U').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content}>
      {/* Profile */}
      <View style={s.section}>
        <View style={s.sectionHeader}>
          <Ionicons name="person" size={18} color={colors.text} />
          <Text style={s.sectionTitle}>Profile</Text>
        </View>
        <View style={s.profileRow}>
          <View style={[s.avatar, { backgroundColor: accent.surface }]}>
            <Text style={[s.avatarText, { color: accent.primary }]}>{initials}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <TextInput style={s.input} value={name} onChangeText={setName} placeholder="Name" placeholderTextColor={colors.textMuted} />
            <TextInput style={[s.input, { marginTop: 8 }]} value={email} onChangeText={setEmail} placeholder="Email" placeholderTextColor={colors.textMuted} keyboardType="email-address" autoCapitalize="none" />
          </View>
        </View>
        {profileChanged && (
          <TouchableOpacity style={[s.saveBtn, { backgroundColor: accent.primary }]} onPress={saveProfile}>
            <Text style={s.saveBtnText}>Save Changes</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Appearance */}
      <View style={s.section}>
        <View style={s.sectionHeader}>
          <Ionicons name="color-palette" size={18} color={colors.text} />
          <Text style={s.sectionTitle}>Appearance</Text>
        </View>

        <Text style={s.rowLabel}>Theme</Text>
        <View style={s.segmentRow}>
          {(['light', 'dark', 'system'] as const).map(t => (
            <TouchableOpacity
              key={t}
              style={[s.segment, settings.theme === t && { backgroundColor: accent.primary }]}
              onPress={() => updateSetting('theme', t)}
            >
              <Ionicons
                name={t === 'light' ? 'sunny' : t === 'dark' ? 'moon' : 'phone-portrait'}
                size={14}
                color={settings.theme === t ? '#FFF' : colors.textSecondary}
              />
              <Text style={[s.segmentText, settings.theme === t && { color: '#FFF' }]}>
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={s.rowLabel}>Accent Color</Text>
        <View style={s.accentRow}>
          {ACCENT_COLORS.map(c => (
            <TouchableOpacity
              key={c.id}
              style={[s.accentDot, { backgroundColor: c.color }, settings.accentColor === c.id && s.accentDotActive]}
              onPress={() => updateSetting('accentColor', c.id)}
            >
              {settings.accentColor === c.id && <Ionicons name="checkmark" size={14} color="#FFF" />}
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Planner Preferences */}
      <View style={s.section}>
        <View style={s.sectionHeader}>
          <Ionicons name="calendar" size={18} color={colors.text} />
          <Text style={s.sectionTitle}>Planner</Text>
        </View>

        <SettingsRow label="Week Starts On" colors={colors}>
          <View style={s.miniSegment}>
            {(['sunday', 'monday'] as const).map(d => (
              <TouchableOpacity
                key={d}
                style={[s.miniSeg, settings.weekStartsOn === d && { backgroundColor: accent.primary }]}
                onPress={() => updateSetting('weekStartsOn', d)}
              >
                <Text style={[s.miniSegText, settings.weekStartsOn === d && { color: '#FFF' }]}>
                  {d === 'sunday' ? 'Sun' : 'Mon'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </SettingsRow>

        <SettingsRow label="Default Priority" colors={colors}>
          <View style={s.miniSegment}>
            {(['high', 'medium', 'low'] as const).map(p => (
              <TouchableOpacity
                key={p}
                style={[s.miniSeg, settings.defaultPriority === p && { backgroundColor: accent.primary }]}
                onPress={() => updateSetting('defaultPriority', p)}
              >
                <Text style={[s.miniSegText, settings.defaultPriority === p && { color: '#FFF' }]}>
                  {p.charAt(0).toUpperCase() + p.slice(1)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </SettingsRow>

        <SettingsRow label="Show Completed Tasks" colors={colors}>
          <Switch
            value={settings.showCompleted}
            onValueChange={v => updateSetting('showCompleted', v)}
            trackColor={{ true: accent.primary, false: colors.surfaceVariant }}
            thumbColor={Platform.OS === 'android' ? (settings.showCompleted ? accent.light : '#f4f3f4') : undefined}
          />
        </SettingsRow>

        <SettingsRow label="Due Date Alerts" colors={colors}>
          <Switch
            value={settings.dueDateAlerts}
            onValueChange={v => updateSetting('dueDateAlerts', v)}
            trackColor={{ true: accent.primary, false: colors.surfaceVariant }}
            thumbColor={Platform.OS === 'android' ? (settings.dueDateAlerts ? accent.light : '#f4f3f4') : undefined}
          />
        </SettingsRow>
      </View>

      {/* Actions */}
      <View style={s.section}>
        <TouchableOpacity style={s.actionRow} onPress={resetSettings}>
          <Ionicons name="refresh" size={18} color={colors.textSecondary} />
          <Text style={[s.actionText, { color: colors.text }]}>Reset All Settings</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.actionRow} onPress={handleLogout}>
          <Ionicons name="log-out-outline" size={18} color={colors.error} />
          <Text style={[s.actionText, { color: colors.error }]}>Sign Out</Text>
        </TouchableOpacity>
      </View>

      <Text style={s.footer}>
        Northwest Student Planner{'\n'}Data stored locally on device.
      </Text>
      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

function SettingsRow({ label, colors, children }: {
  label: string;
  colors: ReturnType<typeof useAppTheme>['colors'];
  children: React.ReactNode;
}) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12 }}>
      <Text style={{ fontSize: 15, color: colors.text }}>{label}</Text>
      {children}
    </View>
  );
}

function makeStyles(colors: ReturnType<typeof useAppTheme>['colors'], accent: ReturnType<typeof useAppTheme>['accent']) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { padding: 20 },
    section: { backgroundColor: colors.card, borderRadius: 14, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: colors.border },
    sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
    sectionTitle: { fontSize: 17, fontWeight: '600', color: colors.text },
    profileRow: { flexDirection: 'row', gap: 14, alignItems: 'flex-start' },
    avatar: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
    avatarText: { fontSize: 18, fontWeight: '700' },
    input: { backgroundColor: colors.surfaceVariant, borderRadius: 8, padding: 12, fontSize: 15, color: colors.text, borderWidth: 1, borderColor: colors.border },
    saveBtn: { marginTop: 12, borderRadius: 8, padding: 12, alignItems: 'center' },
    saveBtnText: { color: '#FFF', fontWeight: '600', fontSize: 15 },
    rowLabel: { fontSize: 14, fontWeight: '500', color: colors.textSecondary, marginTop: 12, marginBottom: 6 },
    segmentRow: { flexDirection: 'row', gap: 8 },
    segment: { flex: 1, flexDirection: 'row', paddingVertical: 10, borderRadius: 8, alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: colors.surfaceVariant },
    segmentText: { fontSize: 13, fontWeight: '500', color: colors.text },
    accentRow: { flexDirection: 'row', gap: 12 },
    accentDot: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
    accentDotActive: { borderWidth: 3, borderColor: '#FFF', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 4, elevation: 4 },
    miniSegment: { flexDirection: 'row', gap: 4 },
    miniSeg: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, backgroundColor: colors.surfaceVariant },
    miniSegText: { fontSize: 13, fontWeight: '500', color: colors.text },
    actionRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.borderLight },
    actionText: { fontSize: 15, fontWeight: '500' },
    footer: { textAlign: 'center', color: colors.textMuted, fontSize: 12, marginTop: 16, lineHeight: 18 },
  });
}
