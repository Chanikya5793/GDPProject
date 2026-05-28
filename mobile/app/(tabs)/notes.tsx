import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, TextInput,
  Modal, RefreshControl, Alert, Platform, KeyboardAvoidingView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/contexts/AuthContext';
import { useAppTheme } from '@/theme/useAppTheme';
import { getNotes, createNote, updateNote, deleteNote, getTags } from '@/api/notes';
import { Note, Tag } from '@/types';

export default function NotesScreen() {
  const { user } = useAuth();
  const { colors, accent } = useAppTheme();
  const [notes, setNotes] = useState<Note[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedNote, setSelectedNote] = useState<Note | null>(null);
  const [editorVisible, setEditorVisible] = useState(false);

  const loadData = useCallback(async () => {
    if (!user) return;
    const [n, t] = await Promise.all([getNotes(user.id), getTags()]);
    setNotes(n);
    setTags(t);
    setLoading(false);
  }, [user]);

  useEffect(() => { loadData(); }, [loadData]);

  const onRefresh = async () => { setRefreshing(true); await loadData(); setRefreshing(false); };

  const handleNewNote = async () => {
    const created = await createNote({ userId: user!.id, title: 'Untitled Note', body: '', tagIds: [] });
    setNotes(prev => [created, ...prev]);
    setSelectedNote(created);
    setEditorVisible(true);
  };

  const handleSaveNote = async (id: number, updates: Partial<Note>) => {
    const updated = await updateNote(id, updates);
    setNotes(prev => prev.map(n => n.id === id ? updated : n));
    setSelectedNote(updated);
  };

  const handleDeleteNote = (id: number) => {
    Alert.alert('Delete Note', 'This note will be moved to trash.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        await deleteNote(id);
        setNotes(prev => prev.filter(n => n.id !== id));
        setEditorVisible(false);
        setSelectedNote(null);
      }},
    ]);
  };

  const filtered = search
    ? notes.filter(n => n.title.toLowerCase().includes(search.toLowerCase()) || n.body.toLowerCase().includes(search.toLowerCase()))
    : notes;

  const s = makeStyles(colors, accent);

  return (
    <View style={s.container}>
      {/* Search + New */}
      <View style={s.headerBar}>
        <View style={s.searchWrap}>
          <Ionicons name="search" size={16} color={colors.textMuted} />
          <TextInput
            style={s.searchInput}
            value={search}
            onChangeText={setSearch}
            placeholder="Search notes..."
            placeholderTextColor={colors.textMuted}
          />
        </View>
        <TouchableOpacity style={[s.addBtn, { backgroundColor: accent.primary }]} onPress={handleNewNote}>
          <Ionicons name="add" size={20} color="#FFF" />
        </TouchableOpacity>
      </View>

      <FlatList
        data={filtered}
        keyExtractor={n => String(n.id)}
        contentContainerStyle={s.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={accent.primary} />}
        ListEmptyComponent={
          <View style={s.empty}>
            <Ionicons name="document-text-outline" size={48} color={colors.textMuted} />
            <Text style={[s.emptyTitle, { color: colors.text }]}>
              {search ? 'No matching notes' : 'No notes yet'}
            </Text>
            <Text style={s.emptyText}>Tap + to create your first note.</Text>
          </View>
        }
        renderItem={({ item: note }) => {
          const preview = note.body.replace(/[#*_`>\-\[\]]/g, '').slice(0, 80);
          const noteTags = tags.filter(t => note.tagIds.includes(t.id));
          return (
            <TouchableOpacity
              style={[s.noteCard, { backgroundColor: colors.card, borderColor: colors.border }]}
              onPress={() => { setSelectedNote(note); setEditorVisible(true); }}
              activeOpacity={0.7}
            >
              <Text style={[s.noteTitle, { color: colors.text }]} numberOfLines={1}>
                {note.title || 'Untitled'}
              </Text>
              {preview ? <Text style={[s.notePreview, { color: colors.textSecondary }]} numberOfLines={2}>{preview}</Text> : null}
              <View style={s.noteBottom}>
                <Text style={[s.noteDate, { color: colors.textMuted }]}>
                  {new Date(note.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </Text>
                <View style={s.noteTags}>
                  {noteTags.map(t => (
                    <View key={t.id} style={[s.noteTag, { backgroundColor: t.color }]}>
                      <Text style={s.noteTagText}>#{t.name}</Text>
                    </View>
                  ))}
                </View>
              </View>
            </TouchableOpacity>
          );
        }}
      />

      {/* Editor Modal */}
      <NoteEditor
        visible={editorVisible}
        note={selectedNote}
        tags={tags}
        colors={colors}
        accent={accent}
        onSave={handleSaveNote}
        onDelete={handleDeleteNote}
        onClose={() => setEditorVisible(false)}
      />
    </View>
  );
}

function NoteEditor({ visible, note, tags, colors, accent, onSave, onDelete, onClose }: {
  visible: boolean;
  note: Note | null;
  tags: Tag[];
  colors: ReturnType<typeof useAppTheme>['colors'];
  accent: ReturnType<typeof useAppTheme>['accent'];
  onSave: (id: number, updates: Partial<Note>) => void;
  onDelete: (id: number) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (visible && note) {
      setTitle(note.title);
      setBody(note.body);
      setDirty(false);
    }
  }, [visible, note?.id]);

  const handleSave = () => {
    if (!note) return;
    onSave(note.id, { title, body });
    setDirty(false);
  };

  const handleClose = () => {
    if (dirty && note) {
      onSave(note.id, { title, body });
    }
    onClose();
  };

  const es = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: colors.border },
    headerActions: { flexDirection: 'row', gap: 16, alignItems: 'center' },
    titleInput: { fontSize: 22, fontWeight: '700', color: colors.text, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8 },
    bodyInput: { flex: 1, fontSize: 16, color: colors.text, paddingHorizontal: 20, textAlignVertical: 'top', lineHeight: 24 },
    tagsRow: { flexDirection: 'row', paddingHorizontal: 20, gap: 6, paddingBottom: 8 },
    tag: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
    tagText: { fontSize: 12, fontWeight: '600', color: '#374151' },
  });

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleClose}>
      <KeyboardAvoidingView style={es.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={es.header}>
          <TouchableOpacity onPress={handleClose}>
            <Ionicons name="chevron-back" size={24} color={accent.primary} />
          </TouchableOpacity>
          <View style={es.headerActions}>
            {dirty && (
              <TouchableOpacity onPress={handleSave}>
                <Text style={{ fontSize: 16, fontWeight: '600', color: accent.primary }}>Save</Text>
              </TouchableOpacity>
            )}
            {note && (
              <TouchableOpacity onPress={() => onDelete(note.id)}>
                <Ionicons name="trash-outline" size={20} color={colors.error} />
              </TouchableOpacity>
            )}
          </View>
        </View>

        <TextInput
          style={es.titleInput}
          value={title}
          onChangeText={t => { setTitle(t); setDirty(true); }}
          placeholder="Note title..."
          placeholderTextColor={colors.textMuted}
        />

        {note && tags.filter(t => note.tagIds.includes(t.id)).length > 0 && (
          <View style={es.tagsRow}>
            {tags.filter(t => note.tagIds.includes(t.id)).map(t => (
              <View key={t.id} style={[es.tag, { backgroundColor: t.color }]}>
                <Text style={es.tagText}>#{t.name}</Text>
              </View>
            ))}
          </View>
        )}

        <TextInput
          style={es.bodyInput}
          value={body}
          onChangeText={b => { setBody(b); setDirty(true); }}
          placeholder="Start writing your note..."
          placeholderTextColor={colors.textMuted}
          multiline
          autoFocus={!note?.body}
        />
      </KeyboardAvoidingView>
    </Modal>
  );
}

function makeStyles(colors: ReturnType<typeof useAppTheme>['colors'], accent: ReturnType<typeof useAppTheme>['accent']) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    headerBar: { flexDirection: 'row', paddingHorizontal: 20, paddingVertical: 10, gap: 10 },
    searchWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surfaceVariant, borderRadius: 10, paddingHorizontal: 12, gap: 8 },
    searchInput: { flex: 1, paddingVertical: Platform.OS === 'ios' ? 10 : 8, fontSize: 15, color: colors.text },
    addBtn: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
    list: { paddingHorizontal: 20, paddingBottom: 100 },
    noteCard: { borderWidth: 1, borderRadius: 12, padding: 16, marginBottom: 10 },
    noteTitle: { fontSize: 16, fontWeight: '600', marginBottom: 4 },
    notePreview: { fontSize: 14, lineHeight: 20, marginBottom: 8 },
    noteBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    noteDate: { fontSize: 12 },
    noteTags: { flexDirection: 'row', gap: 4 },
    noteTag: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 },
    noteTagText: { fontSize: 11, fontWeight: '600', color: '#374151' },
    empty: { alignItems: 'center', paddingTop: 60 },
    emptyTitle: { fontSize: 18, fontWeight: '600', marginTop: 12 },
    emptyText: { color: colors.textMuted, fontSize: 14, marginTop: 4 },
  });
}
