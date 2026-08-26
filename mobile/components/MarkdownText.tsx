import { StyleSheet, Text, View } from 'react-native';

import { Block, InlineToken, parseMarkdown } from '@/utils/markdown';
import { useAppTheme } from '@/theme/useAppTheme';

// Renders the note markdown subset as native text. The web app builds an HTML
// string for this; here the parser hands back blocks and they map onto <Text>,
// which keeps user content away from anything HTML-shaped.

function Inline({ spans, style }: { spans: InlineToken[]; style?: object }) {
  const { colors } = useAppTheme();
  return (
    <>
      {spans.map((span, index) => {
        const key = `${span.type}-${index}`;
        if (span.type === 'bold') {
          return <Text key={key} style={[style, { fontWeight: '700' }]}>{span.value}</Text>;
        }
        if (span.type === 'italic') {
          return <Text key={key} style={[style, { fontStyle: 'italic' }]}>{span.value}</Text>;
        }
        if (span.type === 'code') {
          return (
            <Text
              key={key}
              style={[style, {
                fontFamily: 'Courier',
                backgroundColor: colors.surfaceVariant,
                color: colors.text,
              }]}
            >
              {span.value}
            </Text>
          );
        }
        return <Text key={key} style={style}>{span.value}</Text>;
      })}
    </>
  );
}

const HEADING_SIZE: Record<number, number> = { 1: 24, 2: 20, 3: 17 };

export default function MarkdownText({ body }: { body: string }) {
  const { colors, accent } = useAppTheme();
  const s = makeStyles(colors, accent);
  const blocks = parseMarkdown(body);

  if (blocks.length === 0) {
    return <Text style={s.empty}>Nothing to preview.</Text>;
  }

  return (
    <View>
      {blocks.map((block: Block, index) => {
        const key = `${block.type}-${index}`;
        switch (block.type) {
          case 'blank':
            return <View key={key} style={s.blank} />;
          case 'heading':
            return (
              <Text key={key} style={[s.heading, { fontSize: HEADING_SIZE[block.level] }]}>
                <Inline spans={block.spans} />
              </Text>
            );
          case 'quote':
            return (
              <View key={key} style={s.quote}>
                <Text style={s.quoteText}><Inline spans={block.spans} /></Text>
              </View>
            );
          case 'bullet':
            return (
              <View key={key} style={s.listRow}>
                <Text style={s.marker}>•</Text>
                <Text style={s.body}><Inline spans={block.spans} /></Text>
              </View>
            );
          case 'numbered':
            return (
              <View key={key} style={s.listRow}>
                <Text style={s.marker}>{block.index}.</Text>
                <Text style={s.body}><Inline spans={block.spans} /></Text>
              </View>
            );
          default:
            return (
              <Text key={key} style={s.body}><Inline spans={block.spans} /></Text>
            );
        }
      })}
    </View>
  );
}

function makeStyles(
  colors: ReturnType<typeof useAppTheme>['colors'],
  accent: ReturnType<typeof useAppTheme>['accent'],
) {
  return StyleSheet.create({
    empty: { color: colors.textMuted, fontSize: 15, fontStyle: 'italic' },
    blank: { height: 10 },
    heading: { color: colors.text, fontWeight: '700', marginBottom: 6, marginTop: 4 },
    body: { color: colors.text, fontSize: 16, lineHeight: 24, flex: 1 },
    quote: {
      borderLeftWidth: 3,
      borderLeftColor: accent.primary,
      paddingLeft: 12,
      marginVertical: 4,
    },
    quoteText: { color: colors.textMuted, fontSize: 16, lineHeight: 24 },
    listRow: { flexDirection: 'row', gap: 8, marginBottom: 2 },
    marker: { color: colors.textMuted, fontSize: 16, lineHeight: 24, minWidth: 18 },
  });
}
