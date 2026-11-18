import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { getTags } from '@/api/tags';
import { useAppTheme } from '@/theme/useAppTheme';
import { PlannerRecordId, Tag } from '@/types';
import { hasTag, toggleTagId } from '@/utils/noteTags';

export default function TagPicker({ value, onChange }: {
  value: PlannerRecordId[];
  onChange: (ids: PlannerRecordId[]) => void;
}) {
  const { colors, accent } = useAppTheme();
  const [tags, setTags] = useState<Tag[]>([]);
  useEffect(() => {
    let active = true;
    getTags().then(result => { if (active) setTags(result); }).catch(() => {});
    return () => { active = false; };
  }, []);
  if (!tags.length) return null;

  return (
    <View style={{ gap: 6, marginTop: 16 }}>
      <Text style={{ color: colors.textSecondary }}>Tags</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {tags.map(tag => {
          const selected = hasTag({ tagIds: value }, tag.id);
          return (
            <Pressable key={tag.id} accessibilityRole="checkbox" accessibilityState={{ checked: selected }}
              onPress={() => onChange(toggleTagId(value, tag.id))}
              style={{ paddingVertical: 10, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1,
                borderColor: selected ? accent.primary : colors.border,
                backgroundColor: selected ? accent.surface : colors.surfaceVariant }}>
              <Text style={{ color: colors.text }}>{tag.name}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
