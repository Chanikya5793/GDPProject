import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet,
  Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { apiConfigured, apiRequest, apiStream, idempotencyKey } from '@/api/client';
import { useAppTheme } from '@/theme/useAppTheme';
import { createStyles } from '@/theme/createStyles';
import { getItem, setItem } from '@/api/storage';
import { AiInfo } from '@/utils/aiPrivacy';
import { AI_NOTICE_KEY, AI_NOTICE_TITLE, noticeParagraphs } from '@/utils/aiNotice';
import { toHistory } from '@/utils/chatHistory';

interface Citation {
  citation_id: string;
  entity_type: string;
  record_id: string;
  revision: number;
  title: string;
  excerpt: string;
}

interface Proposal {
  proposal_id: string;
  operation: string;
  entity_type: string;
  base_revision: number | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  rationale: string;
  status: string;
}

interface ChatResponse {
  answer: string;
  citations: Citation[];
  retrieval: { attempted: boolean; result_count: number; abstained: boolean; reason?: string };
  proposals: Proposal[];
}

interface Message extends Partial<ChatResponse> {
  id: string;
  role: 'user' | 'assistant' | 'error';
  text: string;
  /** True while the answer is still arriving, so a pause does not read as the end. */
  streaming?: boolean;
}

export default function CopilotScreen() {
  const { colors, accent, appearance } = useAppTheme();
  const styles = makeStyles(colors, accent, appearance);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<Message[]>([{
    id: 'welcome', role: 'assistant',
    text: 'Ask about planner records you approved for AI. Every answer cites exact records, and every change requires confirmation.',
  }]);
  const scrollRef = useRef<ScrollView>(null);
  // The assistant is on by default, so say once where planner text goes. The
  // encrypted store is namespaced per signed-in user, so acknowledging it on one
  // account does not silence it for another on the same device.
  const [aiInfo, setAiInfo] = useState<AiInfo | null>(null);
  const [noticeSeen, setNoticeSeen] = useState(true);

  useEffect(() => {
    if (!apiConfigured()) return;
    getItem<boolean>(AI_NOTICE_KEY, false).then(seen => setNoticeSeen(seen));
    apiRequest<AiInfo>('/v1/ai-info').then(setAiInfo).catch(() => setAiInfo(null));
  }, []);

  const acknowledgeNotice = async () => {
    setNoticeSeen(true);
    await setItem(AI_NOTICE_KEY, true);
  };
  const controllerRef = useRef<AbortController | null>(null);

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');
    // Read before the new message is appended: history is the earlier turns, so
    // a clarifying question can be answered and picked up from.
    const history = toHistory(messages);
    setMessages(previous => [...previous, { id: idempotencyKey('message'), role: 'user', text }]);
    setLoading(true);
    const controller = new AbortController();
    controllerRef.current = controller;
    const answerId = idempotencyKey('answer');
    let streamed = '';
    let settled = false;
    let streamFailure: { code?: string; detail?: string } | null = null;

    // Creates the reply on the first delta and patches it in place after that,
    // so no empty bubble appears before there is anything to read.
    const upsertAnswer = (patch: Partial<Message>) => setMessages(previous => {
      const index = previous.findIndex(message => message.id === answerId);
      if (index === -1) return [...previous, { id: answerId, role: 'assistant', text: '', ...patch }];
      const next = [...previous];
      next[index] = { ...next[index], ...patch };
      return next;
    });

    try {
      await apiStream('/v1/copilot/chat/stream', {
        signal: controller.signal,
        body: JSON.stringify({
          message: text, request_id: idempotencyKey('mobile-chat'),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
          history,
        }),
      }, ({ event, data }) => {
        if (event === 'delta') {
          streamed += (data as { text?: string }).text || '';
          upsertAnswer({ text: streamed, streaming: true });
        } else if (event === 'final') {
          // Authoritative. The citation guard can replace the whole answer once
          // the structured result is parsed, and a change that could not be
          // prepared appends to it, so this replaces the streamed text.
          settled = true;
          const response = data as ChatResponse;
          upsertAnswer({ ...response, text: response.answer, streaming: false });
        } else if (event === 'error') {
          streamFailure = data as { code?: string; detail?: string };
        }
      });
      if (!settled && !controller.signal.aborted) {
        // The model failed mid-answer or the connection dropped. Keep whatever
        // text arrived, but stop it looking complete.
        upsertAnswer({ streaming: false });
        setMessages(previous => [...previous, {
          id: idempotencyKey('error'), role: 'error',
          text: streamFailure?.detail || 'The connection ended before the answer was finished.',
        }]);
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      upsertAnswer({ streaming: false });
      // An unconfigured backend means the copilot is unavailable, not that the
      // request failed; saying "not configured" in red reads like a crash.
      const code = (error as { code?: string })?.code;
      setMessages(previous => [...previous, {
        id: idempotencyKey('error'), role: 'error',
        text: code === 'not_configured'
          ? 'The copilot needs the planner backend, which this build is not connected to. Your tasks, reminders, and notes still work — they are stored encrypted on this device.'
          : error instanceof Error ? error.message : 'The copilot request failed.',
      }]);
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
      setLoading(false);
    }
  };

  const cancel = () => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setLoading(false);
  };

  const updateProposal = (proposalId: string, proposal: Proposal) => {
    setMessages(previous => previous.map(message => ({
      ...message,
      proposals: message.proposals?.map(item => item.proposal_id === proposalId ? proposal : item),
    })));
  };

  const actOnProposal = async (proposal: Proposal, action: 'confirm' | 'reject') => {
    const body = action === 'confirm'
      ? { idempotency_key: idempotencyKey('mobile-confirm'), expected_base_revision: proposal.base_revision }
      : { reason: 'Rejected in mobile copilot' };
    const updated = await apiRequest<Proposal>(`/v1/proposals/${proposal.proposal_id}/${action}`, {
      method: 'POST', body: JSON.stringify(body),
    });
    updateProposal(proposal.proposal_id, updated);
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView ref={scrollRef} style={styles.messages} contentContainerStyle={styles.messagesContent}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}>
        {apiConfigured() && !noticeSeen && (
          <View style={styles.notice}>
            <View style={styles.noticeHeader}>
              <Ionicons name="shield-checkmark-outline" size={15} color={accent.primary} />
              <Text style={styles.noticeTitle}>{AI_NOTICE_TITLE}</Text>
            </View>
            {noticeParagraphs(aiInfo).map((paragraph, index) => (
              <Text key={index} style={styles.noticeText}>{paragraph}</Text>
            ))}
            <TouchableOpacity
              style={[styles.noticeButton, { backgroundColor: accent.primary }]}
              onPress={acknowledgeNotice}
              accessibilityRole="button"
            >
              <Text style={styles.noticeButtonText}>Got it</Text>
            </TouchableOpacity>
          </View>
        )}
        {messages.map(message => (
          <View key={message.id} style={[
            styles.message, message.role === 'user' ? styles.userMessage : styles.assistantMessage,
            message.role === 'error' && styles.errorMessage,
          ]}>
            <Text style={message.role === 'user' ? styles.userText : styles.assistantText}>{message.text}</Text>
            {message.citations?.map(citation => (
              <View key={citation.citation_id} style={styles.citation}>
                <Text style={styles.citationTitle}>[{citation.citation_id}] {citation.title} · rev {citation.revision}</Text>
                <Text style={styles.citationExcerpt} numberOfLines={2}>{citation.excerpt}</Text>
              </View>
            ))}
            {message.retrieval?.attempted && (
              <Text style={styles.disclosure}>{message.retrieval.abstained
                ? `Abstained: ${message.retrieval.reason || 'insufficient evidence'}`
                : `Retrieved ${message.retrieval.result_count} approved records`}</Text>
            )}
            {message.proposals?.map(proposal => (
              <View key={proposal.proposal_id} style={styles.proposal}>
                <Text style={styles.proposalTitle}>{proposal.operation} {proposal.entity_type} · {proposal.status}</Text>
                <Text style={styles.proposalReason}>{proposal.rationale}</Text>
                <View style={styles.previewRow}>
                  <View style={styles.preview}><Text style={styles.previewLabel}>BEFORE</Text><Text style={styles.previewText}>{JSON.stringify(proposal.before, null, 2) || 'None'}</Text></View>
                  <View style={styles.preview}><Text style={styles.previewLabel}>AFTER</Text><Text style={styles.previewText}>{JSON.stringify(proposal.after, null, 2) || 'Deleted'}</Text></View>
                </View>
                {proposal.status === 'pending' && (
                  <View style={styles.actions}>
                    <TouchableOpacity style={styles.reject} onPress={() => actOnProposal(proposal, 'reject')}><Text style={styles.rejectText}>Reject</Text></TouchableOpacity>
                    <TouchableOpacity style={styles.confirm} onPress={() => actOnProposal(proposal, 'confirm')}><Text style={styles.confirmText}>Confirm change</Text></TouchableOpacity>
                  </View>
                )}
              </View>
            ))}
          </View>
        ))}
        {loading && !messages.some(message => message.streaming) && (
          <View style={styles.loading}><ActivityIndicator color={accent.primary} /><Text style={styles.disclosure}>Retrieving approved records…</Text></View>
        )}
      </ScrollView>
      <View style={styles.inputRow}>
        <TextInput style={styles.input} value={input} onChangeText={setInput}
          editable={apiConfigured()}
          placeholder={apiConfigured() ? 'Ask your planner…' : 'Copilot unavailable in this build'}
          placeholderTextColor={colors.textMuted}
          multiline maxLength={8000} />
        <TouchableOpacity style={[styles.send, !loading && !input.trim() && styles.sendDisabled]}
          onPress={loading ? cancel : send}
          disabled={!loading && (!apiConfigured() || !input.trim())}>
          <Ionicons name={loading ? 'stop' : 'send'} size={18} color="#FFF" />
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

function makeStyles(colors: ReturnType<typeof useAppTheme>['colors'], accent: ReturnType<typeof useAppTheme>['accent'], appearance: ReturnType<typeof useAppTheme>['appearance']) {
  return createStyles(appearance)({
    container: { flex: 1, backgroundColor: colors.background },
    messages: { flex: 1 },
    notice: {
      backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1,
      borderColor: colors.border, borderLeftWidth: 3, borderLeftColor: accent.primary,
      padding: 14, marginBottom: 14,
    },
    noticeHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
    noticeTitle: { fontSize: 14, fontWeight: '700', color: colors.text },
    noticeText: { fontSize: 12, lineHeight: 18, color: colors.textMuted, marginBottom: 8 },
    noticeButton: { alignSelf: 'flex-start', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 7 },
    noticeButtonText: { color: '#FFF', fontWeight: '600', fontSize: 13 }, messagesContent: { padding: 16, gap: 12 },
    message: { maxWidth: '92%', borderRadius: 14, padding: 12, gap: 8 },
    userMessage: { alignSelf: 'flex-end', backgroundColor: accent.primary },
    assistantMessage: { alignSelf: 'flex-start', backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
    errorMessage: { borderColor: colors.error },
    userText: { color: '#FFF', lineHeight: 20 }, assistantText: { color: colors.text, lineHeight: 20 },
    citation: { borderLeftWidth: 2, borderLeftColor: accent.primary, paddingLeft: 8 },
    citationTitle: { color: accent.primary, fontWeight: '600', fontSize: 12 },
    citationExcerpt: { color: colors.textSecondary, fontSize: 11, marginTop: 2 },
    disclosure: { color: colors.textMuted, fontSize: 11 },
    proposal: { borderWidth: 1, borderColor: accent.primary, borderRadius: 10, padding: 10, gap: 8 },
    proposalTitle: { color: accent.primary, fontWeight: '700', textTransform: 'capitalize' },
    proposalReason: { color: colors.textSecondary, fontSize: 12 },
    previewRow: { flexDirection: 'row', gap: 6 }, preview: { flex: 1, backgroundColor: colors.surfaceVariant, padding: 6, borderRadius: 6, maxHeight: 140 },
    previewLabel: { color: colors.textMuted, fontSize: 9, fontWeight: '700' }, previewText: { color: colors.text, fontSize: 9 },
    actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
    reject: { padding: 8 }, rejectText: { color: colors.error, fontWeight: '600', fontSize: 12 },
    confirm: { padding: 8, backgroundColor: accent.primary, borderRadius: 7 }, confirmText: { color: '#FFF', fontWeight: '700', fontSize: 12 },
    loading: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 8 },
    inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 12, backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.border },
    input: { flex: 1, maxHeight: 100, color: colors.text, backgroundColor: colors.surfaceVariant, borderRadius: 12, padding: 12 },
    send: { width: 42, height: 42, borderRadius: 12, backgroundColor: accent.primary, alignItems: 'center', justifyContent: 'center' },
    sendDisabled: { opacity: 0.45 },
  });
}
