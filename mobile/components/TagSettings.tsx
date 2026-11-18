import { useEffect, useState } from 'react';
import { Alert, Pressable, Text, TextInput, View } from 'react-native';
import { createTag, deleteTag, getTags, updateTag } from '@/api/tags';
import { useAppTheme } from '@/theme/useAppTheme';
import { PlannerRecordId, Tag } from '@/types';

const COLORS = ['#DBEAFE', '#DCFCE7', '#FEF3C7', '#F3E8FF', '#FEE2E2', '#E0E7FF', '#CCFBF1'];

export default function TagSettings() {
  const { colors, accent } = useAppTheme();
  const [tags, setTags] = useState<Tag[] | null>(null);
  const [editing, setEditing] = useState<PlannerRecordId | null>(null);
  const [name, setName] = useState('');
  const [color, setColor] = useState(COLORS[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    getTags().then(value => { if (active) setTags(value); })
      .catch(() => { if (active) setError('Could not load tags.'); });
    return () => { active = false; };
  }, []);

  function clearForm() {
    setEditing(null);
    setName('');
    setColor(COLORS[0]);
  }

  async function changeTag(action: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await action();
      clearForm();
      setTags(await getTags());
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not save tags.');
    } finally {
      setBusy(false);
    }
  }

  const actionStyle = { padding: 10 };
  return (
    <View style={{ padding: 16, gap: 8, backgroundColor: colors.surface, borderRadius: 12 }}>
      <Text accessibilityRole="header" style={{ fontSize: 17, fontWeight: '600', color: colors.text }}>Tags</Text>
      {!tags && !error && <Text style={{ color: colors.textMuted }}>Loading tags…</Text>}
      {tags?.map(tag => (
        <View key={tag.id} style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text style={{ color: colors.text, flex: 1 }}>{tag.name}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${tag.name}`} disabled={busy}
            style={actionStyle} onPress={() => { setEditing(tag.id); setName(tag.name); setColor(tag.color); }}>
            <Text style={{ color: accent.primary }}>Edit</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={`Delete ${tag.name}`} disabled={busy}
            style={actionStyle} onPress={() => Alert.alert('Delete tag?', tag.name, [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Delete', style: 'destructive', onPress: () => { void changeTag(() => deleteTag(tag.id)); } },
            ])}>
            <Text style={{ color: colors.error }}>Delete</Text>
          </Pressable>
        </View>
      ))}
      <TextInput value={name} onChangeText={setName} maxLength={80} editable={!busy}
        placeholder={editing === null ? 'New tag name' : 'Tag name'} placeholderTextColor={colors.textMuted}
        accessibilityLabel="Tag name"
        style={{ color: colors.text, borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 10 }} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {COLORS.map((option, index) => (
          <Pressable key={option} accessibilityRole="radio" accessibilityState={{ checked: color === option }}
            accessibilityLabel={['Blue', 'Green', 'Yellow', 'Purple', 'Red', 'Indigo', 'Teal'][index]}
            disabled={busy} onPress={() => setColor(option)}
            style={{ backgroundColor: option, width: 44, height: 44, borderRadius: 8,
              borderWidth: color === option ? 3 : 1, borderColor: color === option ? accent.primary : colors.border }} />
        ))}
      </View>
      {error ? <Text accessibilityRole="alert" style={{ color: colors.error }}>{error}</Text> : null}
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
        {editing !== null && <Pressable accessibilityRole="button" disabled={busy} onPress={clearForm} style={actionStyle}>
          <Text style={{ color: colors.text }}>Cancel</Text>
        </Pressable>}
        <Pressable accessibilityRole="button" disabled={busy || !name.trim()} style={actionStyle} onPress={() => {
          const data = { name: name.trim(), color };
          void changeTag(() => editing === null ? createTag(data) : updateTag(editing, data));
        }}>
          <Text style={{ color: accent.primary }}>{editing === null ? 'Add tag' : 'Save tag'}</Text>
        </Pressable>
      </View>
    </View>
  );
}
