import { TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

import { useAppTheme } from '@/theme/useAppTheme';

interface Props {
  /** The record to hand over. Its id is what the assistant will act on. */
  record: { id: string | number; title: string; _approvedForAi?: boolean };
  kind: 'task' | 'reminder' | 'note';
  size?: number;
}

/**
 * Hand one record to the assistant.
 *
 * Its own component because the interesting part is not the icon, it is that
 * all three screens have to agree about a record the student kept out of the
 * assistant — and three copies of that rule would drift apart.
 *
 * A record with assistant visibility turned off is still attachable, and the
 * chip on the copilot screen says it is being shared for that question only.
 * That flag keeps records out of what the assistant reaches for by itself: the
 * index, the search, the briefing. Pointing at one record and asking about it
 * is not that. What this never does is change the setting.
 *
 * Routing rather than calling into the copilot directly means the same entry
 * point works from a widget, a Siri shortcut or a pasted link.
 */
export default function AskAiButton({ record, kind, size = 18 }: Props) {
  const { colors, accent } = useAppTheme();

  return (
    <TouchableOpacity
      onPress={() => router.push({
        pathname: '/(tabs)/copilot',
        params: {
          about: String(record.id),
          kind,
          title: record.title,
          approved: record._approvedForAi === false ? 'false' : 'true',
        },
      })}
      accessibilityRole="button"
      accessibilityLabel={`Ask the assistant about ${record.title}`}
    >
      <Ionicons
        name="sparkles-outline"
        size={size}
        color={record._approvedForAi === false ? colors.textMuted : accent.primary}
      />
    </TouchableOpacity>
  );
}
