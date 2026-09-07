import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet,
  Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { apiConfigured, apiRequest, apiStream, idempotencyKey } from '@/api/client';
import { useAppTheme } from '@/theme/useAppTheme';
import { createStyles } from '@/theme/createStyles';
import { getItem, setItem } from '@/api/storage';
import { Conversation, ConversationDetail } from '@/utils/conversations';
import { normalizeStoredThread, StoredThread } from '@/utils/threadStore';
import { AiInfo } from '@/utils/aiPrivacy';
import { AI_NOTICE_KEY, AI_NOTICE_TITLE, noticeParagraphs } from '@/utils/aiNotice';

// The conversation survives leaving the tab or restarting the app. It lived in
// component state alone, so a long run of changes or a clarifying question
// waiting to be answered was lost the moment the screen unmounted. The store is
// already scoped per signed-in user and stays on the device; turning on server
// side chat retention is still a separate decision.
const CHAT_STORE = 'ai:conversation';
// Enough for a working thread. The API only replays the last 20 turns anyway.
const KEPT_MESSAGES = 60;

// The tab bar is position:'absolute' on iOS, so it floats over the screen and
// the bottom of this view sits underneath it. Every other screen clears it with
// padding on its list; this one has an input row down there, and without the
// same allowance the box to type in is behind the tab bar and simply cannot be
// seen. 49pt is the iOS tab bar itself, above whatever the home indicator takes.
const IOS_TAB_BAR_HEIGHT = 49;
import { toHistory } from '@/utils/chatHistory';
import { seriesSummary } from '@/utils/series';
import { changeLines, changeSummary } from '@/utils/changePreview';

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
  /** Every record a confirmed create writes; more than one for a repeat. */
  series?: { content?: { due_date?: string; date?: string } }[];
  base_revision: number | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  rationale: string;
  status: string;
}

interface AgentStep {
  tool: string;
  label: string;
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
  /** What the assistant looked up for itself before answering. */
  steps?: AgentStep[];
  /** True while the answer is still arriving, so a pause does not read as the end. */
  streaming?: boolean;
}

export default function CopilotScreen() {
  const { colors, accent, appearance } = useAppTheme();
  const insets = useSafeAreaInsets();
  const tabBarSpace = Platform.OS === 'ios' ? IOS_TAB_BAR_HEIGHT + insets.bottom : 0;
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
  /** Message ids whose batch of changes is opened up for review. */
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // The thread this conversation belongs to. The server owns the transcript, so
  // a thread started here can be picked up on the web and the other way round.
  const [conversationId, setConversationId] = useState<string | null>(null);
  const conversationIdRef = useRef<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [showThreads, setShowThreads] = useState(false);

  useEffect(() => {
    if (!apiConfigured()) return;
    getItem<boolean>(AI_NOTICE_KEY, false).then(seen => setNoticeSeen(seen));
    apiRequest<AiInfo>('/v1/ai-info').then(setAiInfo).catch(() => setAiInfo(null));
  }, []);

  // Reading the store is async, so a message sent before it resolves would be
  // wiped by the restore landing on top of it. Sending bumps the generation and
  // an older restore is dropped.
  const generationRef = useRef(0);
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    const generation = ++generationRef.current;
    getItem<StoredThread<Message> | Message[] | null>(CHAT_STORE, null)
      .then(saved => {
        if (generationRef.current !== generation) return;
        const stored = normalizeStoredThread<Message>(saved);
        if (stored.messages.length) setMessages(stored.messages);
        setConversationId(stored.conversationId);
        conversationIdRef.current = stored.conversationId;
        setRestored(true);
      })
      .catch(() => setRestored(true));
  }, []);

  useEffect(() => {
    // Never mid-stream: a half-written answer is not worth keeping, and the
    // final event rewrites it anyway. An untouched thread is nothing to restore.
    if (!restored || loading) return;
    if (!messages.some(message => message.id !== 'welcome')) return;
    setItem(CHAT_STORE, {
      conversationId: conversationIdRef.current,
      messages: messages.slice(-KEPT_MESSAGES),
    }).catch(() => {});
  }, [messages, restored, loading]);

  const acknowledgeNotice = async () => {
    setNoticeSeen(true);
    await setItem(AI_NOTICE_KEY, true);
  };
  const controllerRef = useRef<AbortController | null>(null);

  const loadConversations = async () => {
    if (!apiConfigured()) return;
    try {
      setConversations(await apiRequest<Conversation[]>('/v1/conversations?limit=50'));
    } catch {
      // The list is a convenience; failing to fetch it must not break chatting.
    }
  };

  useEffect(() => { loadConversations(); }, []);

  /** Open a stored thread, replacing what is on screen with its transcript. */
  const openConversation = async (id: string) => {
    controllerRef.current?.abort();
    generationRef.current += 1;
    setShowThreads(false);
    setLoading(false);
    try {
      const detail = await apiRequest<ConversationDetail>(
        `/v1/conversations/${encodeURIComponent(id)}`,
      );
      setMessages(detail.messages.map(turn => ({
        id: idempotencyKey('turn'),
        role: turn.role === 'user' ? 'user' : 'assistant',
        text: turn.text,
        // Proposals are not carried: they expire, so one offered from history
        // could never be confirmed and would only look like a failed change.
      })) as Message[]);
      setConversationId(id);
      conversationIdRef.current = id;
      setRestored(true);
    } catch (error) {
      Alert.alert('Could not open', (error as Error).message);
    }
  };

  /** Start a fresh thread. Nothing is written until the first message. */
  const newConversation = () => {
    controllerRef.current?.abort();
    generationRef.current += 1;
    setShowThreads(false);
    setLoading(false);
    setConversationId(null);
    conversationIdRef.current = null;
    setRestored(true);
    setMessages([{
      id: 'welcome', role: 'assistant',
      text: 'Ask about planner records you approved for AI. Every answer cites exact records, and every change requires confirmation.',
    }]);
  };

  const renameConversation = (thread: Conversation) => {
    Alert.prompt?.('Rename conversation', undefined, async title => {
      if (!title?.trim()) return;
      try {
        await apiRequest(`/v1/conversations/${encodeURIComponent(thread.conversation_id)}`, {
          method: 'PATCH', body: JSON.stringify({ title: title.trim() }),
        });
        await loadConversations();
      } catch (error) {
        Alert.alert('Could not rename', (error as Error).message);
      }
    }, 'plain-text', thread.title);
  };

  const removeConversation = (thread: Conversation) => {
    Alert.alert('Delete conversation', `Delete “${thread.title}”? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await apiRequest(
              `/v1/conversations/${encodeURIComponent(thread.conversation_id)}`,
              { method: 'DELETE' },
            );
            if (conversationIdRef.current === thread.conversation_id) newConversation();
            await loadConversations();
          } catch (error) {
            Alert.alert('Could not delete', (error as Error).message);
          }
        },
      },
    ]);
  };

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');
    // Read before the new message is appended: history is the earlier turns, so
    // a clarifying question can be answered and picked up from.
    const history = toHistory(messages);
    // Supersede a restore still in flight: what is on screen now is the thread.
    generationRef.current += 1;
    setRestored(true);
    setMessages(previous => [...previous, { id: idempotencyKey('message'), role: 'user', text }]);
    setLoading(true);
    const controller = new AbortController();
    controllerRef.current = controller;
    const answerId = idempotencyKey('answer');
    let streamed = '';
    let steps: AgentStep[] = [];
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
          conversation_id: conversationIdRef.current,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
          history,
        }),
      }, ({ event, data }) => {
        const thread = (data as { conversation_id?: string })?.conversation_id;
        if (thread) conversationIdRef.current = thread;
        if (event === 'delta') {
          streamed += (data as { text?: string }).text || '';
          upsertAnswer({ text: streamed, streaming: true });
        } else if (event === 'step') {
          // The assistant looked something up for itself. Whatever streamed
          // before belonged to the round it has moved past, so it is cleared
          // rather than left above an answer it no longer leads into.
          steps = [...steps, data as AgentStep];
          streamed = '';
          upsertAnswer({ steps, text: '', streaming: true });
        } else if (event === 'final') {
          // Authoritative. The citation guard can replace the whole answer once
          // the structured result is parsed, and a change that could not be
          // prepared appends to it, so this replaces the streamed text.
          settled = true;
          const response = data as ChatResponse;
          upsertAnswer({ ...response, text: response.answer, steps, streaming: false });
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
      if (conversationIdRef.current !== conversationId) {
        setConversationId(conversationIdRef.current);
      }
      loadConversations();
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

  // One at a time on purpose: each confirmation carries its own base revision,
  // so a record edited elsewhere is the only one refused. The first failure
  // stops the run, because the later changes were agreed to assuming the
  // earlier ones happened.
  const actOnEvery = async (proposals: Proposal[], action: 'confirm' | 'reject') => {
    for (const proposal of proposals) {
      if (proposal.status === 'pending') await actOnProposal(proposal, action);
    }
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

  const proposalCard = (proposal: Proposal) => (
    <View key={proposal.proposal_id} style={styles.proposal}>
      <Text style={styles.proposalTitle}>{proposal.operation} {proposal.entity_type} · {proposal.status}</Text>
      <Text style={styles.proposalReason}>{proposal.rationale}</Text>
      {seriesSummary(proposal) ? (
        <Text style={styles.proposalSeries}>↻ {seriesSummary(proposal)}</Text>
      ) : null}
      <View style={styles.changeList}>
        {changeLines(proposal).map(line => (
          <View key={line.label} style={styles.changeRow}>
            <Text style={styles.changeLabel}>{line.label}</Text>
            {line.from !== undefined && <Text style={styles.changeFrom}>{line.from}</Text>}
            {line.from !== undefined && <Text style={styles.changeArrow}>→</Text>}
            <Text style={styles.changeTo}>{line.to}</Text>
          </View>
        ))}
      </View>
      {proposal.status === 'pending' && (
        <View style={styles.actions}>
          <TouchableOpacity style={styles.reject} onPress={() => actOnProposal(proposal, 'reject')}><Text style={styles.rejectText}>Reject</Text></TouchableOpacity>
          <TouchableOpacity style={styles.confirm} onPress={() => actOnProposal(proposal, 'confirm')}><Text style={styles.confirmText}>Confirm change</Text></TouchableOpacity>
        </View>
      )}
    </View>
  );

  // Several changes get one decision, the way the web sidebar does. Thirteen
  // separate Confirm buttons on a phone is worse than on a desktop, not better.
  const renderProposals = (message: Message) => {
    const proposals = message.proposals || [];
    if (!proposals.length) return null;
    if (proposals.length === 1) return proposalCard(proposals[0]);
    const pending = proposals.filter(item => item.status === 'pending');
    const open = expanded.has(message.id);
    return (
      <View style={styles.proposalGroup}>
        <View style={styles.proposalGroupHead}>
          <Text style={styles.proposalTitle}>{proposals.length} changes</Text>
          <TouchableOpacity onPress={() => setExpanded(previous => {
            const next = new Set(previous);
            if (next.has(message.id)) next.delete(message.id); else next.add(message.id);
            return next;
          })}>
            <Text style={styles.proposalToggle}>{open ? 'Hide' : 'Review each'}</Text>
          </TouchableOpacity>
        </View>
        {proposals.map(item => (
          <Text key={item.proposal_id} style={styles.proposalSummaryLine} numberOfLines={1}>
            {item.operation} · {changeSummary(item)}
            {item.status !== 'pending' ? ` · ${item.status}` : ''}
          </Text>
        ))}
        {pending.length > 0 && (
          <View style={styles.actions}>
            <TouchableOpacity style={styles.reject} onPress={() => actOnEvery(pending, 'reject')}>
              <Text style={styles.rejectText}>Reject all {pending.length}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.confirm} onPress={() => actOnEvery(pending, 'confirm')}>
              <Text style={styles.confirmText}>Confirm all {pending.length}</Text>
            </TouchableOpacity>
          </View>
        )}
        {open ? proposals.map(proposalCard) : null}
      </View>
    );
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {apiConfigured() && (
        <View style={styles.threadBar}>
          <TouchableOpacity style={styles.threadBarBtn} onPress={() => setShowThreads(true)}
            accessibilityLabel="Conversations">
            <Ionicons name="chatbubbles-outline" size={16} color={accent.primary} />
            <Text style={styles.threadBarText} numberOfLines={1}>
              {conversations.find(t => t.conversation_id === conversationId)?.title || 'New conversation'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={newConversation} accessibilityLabel="New conversation">
            <Ionicons name="add" size={20} color={accent.primary} />
          </TouchableOpacity>
        </View>
      )}

      <Modal visible={showThreads} animationType="slide" transparent
        onRequestClose={() => setShowThreads(false)}>
        <View style={styles.threadSheet}>
          <View style={styles.threadSheetHead}>
            <Text style={styles.threadSheetTitle}>Conversations</Text>
            <TouchableOpacity onPress={() => setShowThreads(false)} accessibilityLabel="Close">
              <Ionicons name="close" size={20} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
          <ScrollView>
            {!conversations.length && (
              <Text style={styles.disclosure}>Nothing yet. Whatever you ask starts one.</Text>
            )}
            {conversations.map(thread => (
              <View key={thread.conversation_id} style={[
                styles.threadRow,
                thread.conversation_id === conversationId && styles.threadRowCurrent,
              ]}>
                <TouchableOpacity style={styles.threadRowOpen}
                  onPress={() => openConversation(thread.conversation_id)}>
                  <Text style={styles.threadRowTitle} numberOfLines={1}>{thread.title}</Text>
                  <Text style={styles.disclosure}>{thread.message_count} messages</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => renameConversation(thread)}
                  accessibilityLabel={`Rename ${thread.title}`}>
                  <Ionicons name="pencil-outline" size={15} color={colors.textMuted} />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => removeConversation(thread)}
                  accessibilityLabel={`Delete ${thread.title}`}>
                  <Ionicons name="trash-outline" size={16} color={colors.error} />
                </TouchableOpacity>
              </View>
            ))}
          </ScrollView>
        </View>
      </Modal>

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
            {message.steps?.map((step, index) => (
              <View key={`${step.tool}-${index}`} style={styles.step}>
                <Ionicons name="search-outline" size={11} color={accent.primary} />
                <Text style={styles.stepText}>{step.label}</Text>
              </View>
            ))}
            {(message.text.length > 0 || !message.streaming) && (
              <Text style={message.role === 'user' ? styles.userText : styles.assistantText}>{message.text}</Text>
            )}
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
            {renderProposals(message)}
          </View>
        ))}
        {loading && !messages.some(message => message.streaming) && (
          <View style={styles.loading}><ActivityIndicator color={accent.primary} /><Text style={styles.disclosure}>Reading your planner…</Text></View>
        )}
      </ScrollView>
      {!apiConfigured() && (
        <View style={styles.offline}>
          <Ionicons name="cloud-offline-outline" size={15} color={colors.textMuted} />
          <Text style={styles.offlineText}>
            This build was not given the planner backend, so the assistant cannot answer.
            Your tasks, reminders and notes still work; they are stored encrypted on this device.
          </Text>
        </View>
      )}

      <View style={[styles.inputRow, { paddingBottom: 12 + tabBarSpace }]}>
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
    threadBar: {
      flexDirection: 'row', alignItems: 'center', gap: 10,
      paddingHorizontal: 14, paddingVertical: 8,
      borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.card,
    },
    threadBarBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
    offline: {
      flexDirection: 'row', alignItems: 'flex-start', gap: 8,
      padding: 12, backgroundColor: colors.surfaceVariant,
    },
    offlineText: { flex: 1, color: colors.textMuted, fontSize: 12, lineHeight: 17 },
    threadBarText: { flex: 1, color: colors.text, fontSize: 13, fontWeight: '600' },
    threadSheet: {
      marginTop: 'auto', maxHeight: '70%', backgroundColor: colors.card,
      borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, gap: 8,
    },
    threadSheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    threadSheetTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
    threadRow: {
      flexDirection: 'row', alignItems: 'center', gap: 10,
      paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border,
    },
    threadRowCurrent: { backgroundColor: colors.surfaceVariant, borderRadius: 8, paddingHorizontal: 8 },
    threadRowOpen: { flex: 1, gap: 2 },
    threadRowTitle: { color: colors.text, fontSize: 13, fontWeight: '600' },
    step: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    stepText: { color: colors.textMuted, fontSize: 11, flexShrink: 1 },
    proposal: { borderWidth: 1, borderColor: accent.primary, borderRadius: 10, padding: 10, gap: 8 },
    proposalTitle: { color: accent.primary, fontWeight: '700', textTransform: 'capitalize' },
    proposalReason: { color: colors.textSecondary, fontSize: 12 },
    proposalSeries: { color: accent.primary, fontSize: 11, fontWeight: '700' },
    proposalGroup: {
      borderWidth: 1, borderColor: accent.primary, borderRadius: 10, padding: 10, gap: 6,
    },
    proposalGroupHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    proposalToggle: { color: accent.primary, fontSize: 11, fontWeight: '700' },
    proposalSummaryLine: { color: colors.textSecondary, fontSize: 11 },
    changeList: { gap: 4 },
    changeRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' },
    changeLabel: { color: colors.textMuted, fontSize: 9, fontWeight: '700', letterSpacing: 0.4, minWidth: 52, textTransform: 'uppercase' },
    changeFrom: { color: colors.textMuted, fontSize: 12, textDecorationLine: 'line-through' },
    changeArrow: { color: accent.primary, fontSize: 12 },
    changeTo: { color: colors.text, fontSize: 12, fontWeight: '600', flexShrink: 1 },
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
