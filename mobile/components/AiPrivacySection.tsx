import { useCallback, useEffect, useState } from 'react';
import { Alert, StyleSheet, Switch, Text, TouchableOpacity, View, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { apiConfigured, apiRequest } from '@/api/client';
import { useAppTheme } from '@/theme/useAppTheme';
import { createStyles } from '@/theme/createStyles';
import {
  AiInfo, AiPrivacy, defaultPrivacy, INDEXABLE_TYPES, IndexableType, privacySummary,
  providerNotice, RetainedChat, RETENTION_CHOICES, setAiEnabled, setRetainChat,
  setRetentionDays, toggleIndexedType,
} from '@/utils/aiPrivacy';

// Mirrors web's Settings → AI Privacy & Indexing. The mobile app already sent
// approved_for_ai on every record but gave no way to see or change what that
// approval covered, so the only honest answer to "what does the copilot see?"
// was to open the website.
//
// Unlike web, the whole section is gated on a configured backend. These
// settings live server-side, so with no backend web's copy of this section
// renders an error and leaves the two delete buttons enabled — buttons that
// cannot do anything. Here it says plainly that there is nothing to configure.

type Status = 'loading' | 'ready' | 'saving' | 'error' | 'unavailable';

export default function AiPrivacySection() {
  const { colors, accent, appearance } = useAppTheme();
  const [privacy, setPrivacy] = useState<AiPrivacy>(defaultPrivacy);
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState('');
  const [aiInfo, setAiInfo] = useState<AiInfo | null>(null);
  // What retention actually kept. These rows were written and never readable:
  // the only lookup was by request_id, which the client never reuses.
  const [chats, setChats] = useState<RetainedChat[]>([]);
  const [chatsError, setChatsError] = useState('');
  const s = makeStyles(colors, appearance);

  useEffect(() => {
    if (!apiConfigured()) { setStatus('unavailable'); return; }
    apiRequest<AiPrivacy>('/v1/privacy')
      .then(value => { setPrivacy(value); setStatus('ready'); })
      .catch(err => { setError((err as Error).message); setStatus('error'); });
  }, []);

  useEffect(() => {
    if (!apiConfigured()) return;
    apiRequest<AiInfo>('/v1/ai-info').then(setAiInfo).catch(() => setAiInfo(null));
    loadChats();
  }, []);

  const save = useCallback(async (next: AiPrivacy) => {
    const previous = privacy;
    setPrivacy(next);
    setStatus('saving');
    setError('');
    try {
      const saved = await apiRequest<AiPrivacy>('/v1/privacy', {
        method: 'PUT', body: JSON.stringify(next),
      });
      setPrivacy(saved);
      setStatus('ready');
    } catch (err) {
      // Roll back rather than leave the switches showing a state the server
      // rejected — this screen is the user's account of what the AI can see.
      setPrivacy(previous);
      setStatus('error');
      setError((err as Error).message);
    }
  }, [privacy]);

  // Listed whatever the switch currently says: turning retention off stops new
  // rows being written, and anything kept while it was on is still there to
  // read and clear.
  const loadChats = useCallback(() => {
    apiRequest<RetainedChat[]>('/v1/chats')
      .then(rows => { setChats(rows); setChatsError(''); })
      .catch(err => setChatsError((err as Error).message));
  }, []);

  const deleteOneChat = async (chat: RetainedChat) => {
    try {
      await apiRequest(`/v1/chats/${encodeURIComponent(chat.request_id)}`, { method: 'DELETE' });
      setChats(previous => previous.filter(item => item.request_id !== chat.request_id));
    } catch (err) {
      setChatsError((err as Error).message);
    }
  };

  const purge = (path: string, title: string, message: string) => {
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setStatus('saving');
          setError('');
          try {
            await apiRequest(path, { method: 'DELETE' });
            if (path === '/v1/chats') setChats([]);
            setStatus('ready');
            Alert.alert(title, 'Done.');
          } catch (err) {
            setStatus('error');
            setError((err as Error).message);
          }
        },
      },
    ]);
  };

  const busy = status === 'saving' || status === 'loading';

  if (status === 'unavailable') {
    return (
      <View style={s.section}>
        <Header colors={colors} appearance={appearance} />
        <Text style={s.blurb}>
          These settings live with the planner backend, which this build is not
          connected to. Nothing is indexed and no record text leaves this device —
          your tasks, reminders, and notes are stored encrypted here.
        </Text>
      </View>
    );
  }

  return (
    <View style={s.section}>
      <Header colors={colors} appearance={appearance} trailing={status === 'saving' ? 'Saving…' : undefined} />
      <Text style={s.blurb}>{privacySummary(privacy)}</Text>

      <View style={s.row}>
        <View style={s.rowInfo}>
          <Text style={s.rowLabel}>AI Copilot</Text>
          <Text style={s.rowDesc}>Complete opt-out. Turning this off also deletes your vector index.</Text>
        </View>
        <Switch
          value={privacy.ai_enabled}
          disabled={busy}
          onValueChange={value => save(setAiEnabled(privacy, value))}
          trackColor={{ true: accent.primary, false: colors.surfaceVariant }}
          thumbColor={Platform.OS === 'android' ? (privacy.ai_enabled ? accent.light : '#f4f3f4') : undefined}
          accessibilityLabel="Enable AI Copilot"
        />
      </View>

      <View style={s.stackRow}>
        <Text style={s.rowLabel}>Indexed record types</Text>
        <Text style={s.rowDesc}>Only individually approved records from these types can be indexed.</Text>
        <View style={s.pills}>
          {INDEXABLE_TYPES.map(type => {
            const on = privacy.indexed_entity_types.includes(type);
            return (
              <TouchableOpacity
                key={type}
                style={[
                  s.pill,
                  on && { backgroundColor: accent.primary },
                  !privacy.ai_enabled && s.pillDisabled,
                ]}
                disabled={!privacy.ai_enabled || busy}
                onPress={() => save(toggleIndexedType(privacy, type as IndexableType))}
                accessibilityRole="button"
                accessibilityLabel={`${on ? 'Stop indexing' : 'Index'} ${type} records`}
              >
                <Text style={[s.pillText, on && { color: '#FFF' }]}>{type}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <View style={s.row}>
        <View style={s.rowInfo}>
          <Text style={s.rowLabel}>Attachment text</Text>
          <Text style={s.rowDesc}>Index text only from attachments you approve on the record.</Text>
        </View>
        <Switch
          value={privacy.index_attachments}
          disabled={!privacy.ai_enabled || busy}
          onValueChange={value => save({ ...privacy, index_attachments: value })}
          trackColor={{ true: accent.primary, false: colors.surfaceVariant }}
          thumbColor={Platform.OS === 'android' ? (privacy.index_attachments ? accent.light : '#f4f3f4') : undefined}
          accessibilityLabel="Index approved attachment text"
        />
      </View>

      <View style={s.row}>
        <View style={s.rowInfo}>
          <Text style={s.rowLabel}>Retain copilot chats</Text>
          <Text style={s.rowDesc}>Off by default. Current chats remain in memory only.</Text>
        </View>
        <Switch
          value={privacy.retain_chat}
          disabled={!privacy.ai_enabled || busy}
          onValueChange={value => save(setRetainChat(privacy, value))}
          trackColor={{ true: accent.primary, false: colors.surfaceVariant }}
          thumbColor={Platform.OS === 'android' ? (privacy.retain_chat ? accent.light : '#f4f3f4') : undefined}
          accessibilityLabel="Retain copilot chats"
        />
      </View>

      {privacy.retain_chat && (
        <View style={s.stackRow}>
          <Text style={s.rowLabel}>Chat retention</Text>
          <Text style={s.rowDesc}>Automatically expire server-side chat data.</Text>
          <View style={s.pills}>
            {RETENTION_CHOICES.map(days => {
              const on = privacy.chat_retention_days === days;
              return (
                <TouchableOpacity
                  key={days}
                  style={[s.pill, on && { backgroundColor: accent.primary }]}
                  disabled={busy}
                  onPress={() => save(setRetentionDays(privacy, days))}
                  accessibilityRole="button"
                  accessibilityLabel={`Keep chats for ${days} days`}
                >
                  <Text style={[s.pillText, on && { color: '#FFF' }]}>{days} days</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      )}

      {Boolean(error) && <Text style={[s.rowDesc, { color: colors.error }]}>{error}</Text>}

      <TouchableOpacity
        style={s.dangerRow}
        disabled={busy}
        onPress={() => purge(
          '/v1/index',
          'Delete my AI index',
          'This permanently removes everything the copilot has indexed from your records. It cannot be undone.',
        )}
      >
        <Ionicons name="trash-outline" size={16} color={colors.error} />
        <Text style={[s.dangerText, { color: colors.error }]}>Delete my AI index</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={s.dangerRow}
        disabled={busy}
        onPress={() => purge(
          '/v1/chats',
          'Delete retained chats',
          'This permanently removes every copilot chat kept on the server. It cannot be undone.',
        )}
      >
        <Ionicons name="trash-outline" size={16} color={colors.error} />
        <Text style={[s.dangerText, { color: colors.error }]}>Delete retained chats</Text>
      </TouchableOpacity>

      <View style={s.chatsHead}>
        <Ionicons name="chatbubbles-outline" size={15} color={colors.textSecondary} />
        <Text style={s.chatsTitle}>Retained chats</Text>
        <Text style={s.footnote}>{chats.length ? `${chats.length} stored` : 'Nothing stored'}</Text>
        <TouchableOpacity onPress={loadChats}><Text style={s.chatsRefresh}>Refresh</Text></TouchableOpacity>
      </View>
      {chatsError ? <Text style={[s.dangerText, { color: colors.error }]}>{chatsError}</Text> : null}
      {!chats.length && !chatsError ? (
        <Text style={s.footnote}>
          {privacy.retain_chat
            ? 'Nothing has been kept yet. Exchanges appear here once you ask the assistant something.'
            : 'Retention is off, so nothing new is being kept. Anything saved while it was on would still be listed here.'}
        </Text>
      ) : null}
      {chats.map(chat => (
        <View key={chat.request_id} style={s.chatRow}>
          <View style={s.chatText}>
            <Text style={s.chatQuestion} numberOfLines={1}>{chat.question}</Text>
            <Text style={s.chatAnswer} numberOfLines={2}>{chat.answer}</Text>
          </View>
          <TouchableOpacity onPress={() => deleteOneChat(chat)} accessibilityLabel={`Delete ${chat.question}`}>
            <Ionicons name="trash-outline" size={15} color={colors.error} />
          </TouchableOpacity>
        </View>
      ))}

      <Text style={s.footnote}>Record content is never indexed without approval.</Text>
      {aiInfo && <Text style={s.footnote}>{providerNotice(aiInfo)}</Text>}
    </View>
  );
}

function Header({ colors, appearance, trailing }: {
  colors: ReturnType<typeof useAppTheme>['colors'];
  appearance: ReturnType<typeof useAppTheme>['appearance'];
  trailing?: string;
}) {
  const s = makeStyles(colors, appearance);
  return (
    <View style={s.sectionHeader}>
      <Ionicons name="shield-checkmark-outline" size={18} color={colors.text} />
      <Text style={s.sectionTitle}>AI Privacy &amp; Indexing</Text>
      {trailing ? <Text style={s.count}>{trailing}</Text> : null}
    </View>
  );
}

function makeStyles(colors: ReturnType<typeof useAppTheme>['colors'], appearance: ReturnType<typeof useAppTheme>['appearance']) {
  return createStyles(appearance)({
    section: {
      backgroundColor: colors.surface, borderRadius: 14, padding: 16, marginBottom: 16,
    },
    sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
    sectionTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
    count: { fontSize: 12, color: colors.textMuted },
    blurb: { fontSize: 12, color: colors.textMuted, marginBottom: 6, lineHeight: 17 },
    row: {
      flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12,
      borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border,
    },
    stackRow: {
      paddingVertical: 12,
      borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border,
    },
    rowInfo: { flex: 1 },
    rowLabel: { fontSize: 14, fontWeight: '600', color: colors.text },
    rowDesc: { fontSize: 12, color: colors.textMuted, marginTop: 2, lineHeight: 17 },
    pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
    pill: {
      paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8,
      backgroundColor: colors.surfaceVariant,
    },
    pillDisabled: { opacity: 0.45 },
    pillText: { fontSize: 12, color: colors.text, fontWeight: '600', textTransform: 'capitalize' },
    dangerRow: {
      flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 12,
      borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border,
    },
    chatsHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12 },
    chatsTitle: { fontWeight: '700', color: colors.text, fontSize: 13 },
    chatsRefresh: { marginLeft: 'auto', color: colors.textSecondary, fontSize: 11, fontWeight: '700' },
    chatRow: {
      flexDirection: 'row', alignItems: 'flex-start', gap: 8,
      backgroundColor: colors.surfaceVariant, borderRadius: 8, padding: 8, marginTop: 6,
    },
    chatText: { flex: 1, gap: 2 },
    chatQuestion: { fontSize: 12, fontWeight: '700', color: colors.text },
    chatAnswer: { fontSize: 12, color: colors.textMuted },
    dangerText: { fontSize: 14, fontWeight: '600' },
    footnote: { fontSize: 11, color: colors.textMuted, marginTop: 10, lineHeight: 16 },
  });
}
