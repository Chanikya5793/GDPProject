import { HStack, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import { font, foregroundStyle, lineLimit, padding } from '@expo/ui/swift-ui/modifiers';
import { createWidget, type WidgetEnvironment } from 'expo-widgets';
import { EMPTY_WIDGET_PROPS, WidgetProps } from '@/utils/widgetSnapshot';

// The home screen and Lock Screen face of the planner.
//
// This file is compiled for WidgetKit rather than for the app: it runs in a
// separate process, in a JavaScriptCore runtime, against SwiftUI primitives.
// React Native components do not exist here, and neither does anything the app
// keeps in memory — the only input is the props pushed out by api/widgets.ts.
//
// What it may say is decided in utils/widgetSnapshot.ts, not here. See that file
// for why titles are absent by default: the props behind this view live in an
// unencrypted shared container, and two of these families render on the Lock
// Screen where nobody has unlocked anything.

const ACCENT = '#006A4E';

function summary(props: WidgetProps): string {
  if (props.empty) return 'Nothing scheduled';
  if (props.dueToday === 0) return props.overdue > 0 ? `${props.overdue} overdue` : 'Clear today';
  return `${props.dueToday} due today`;
}

const DueToday = (props: WidgetProps, environment: WidgetEnvironment) => {
  'widget';

  const family = environment.widgetFamily;
  const headline = summary(props);
  const next = props.nextTitle || props.nextAt;

  // One line, no room for anything but the essentials.
  if (family === 'accessoryInline') {
    return <Text>{next ? `${headline} · ${next}` : headline}</Text>;
  }

  // Lock Screen rectangle: monochrome and vibrant, so no colours are set here.
  if (family === 'accessoryRectangular') {
    return (
      <VStack alignment="leading" spacing={2}>
        <Text modifiers={[font({ weight: 'semibold', size: 15 })]}>{headline}</Text>
        {props.nextAt ? (
          <Text modifiers={[font({ size: 12 }), lineLimit(1)]}>
            {props.nextTitle ? `${props.nextAt} · ${props.nextTitle}` : `Next at ${props.nextAt}`}
          </Text>
        ) : null}
        {props.overdue > 0 && props.dueToday > 0 ? (
          <Text modifiers={[font({ size: 12 })]}>{props.overdue} overdue</Text>
        ) : null}
      </VStack>
    );
  }

  const wide = family === 'systemMedium';

  return (
    <VStack alignment="leading" spacing={wide ? 6 : 4} modifiers={[padding({ all: 4 })]}>
      <Text
        modifiers={[font({ weight: 'bold', size: wide ? 44 : 38 }), foregroundStyle(ACCENT)]}
      >
        {props.empty ? '—' : String(props.dueToday)}
      </Text>
      <Text modifiers={[font({ weight: 'semibold', size: 13 })]}>
        {props.empty ? 'Nothing scheduled' : 'due today'}
      </Text>

      <Spacer />

      {props.nextAt ? (
        <VStack alignment="leading" spacing={1}>
          <Text modifiers={[font({ size: 11 }), foregroundStyle('#6B7280')]}>Next</Text>
          <Text modifiers={[font({ weight: 'semibold', size: 13 }), lineLimit(1)]}>
            {props.nextTitle ? `${props.nextAt} · ${props.nextTitle}` : props.nextAt}
          </Text>
        </VStack>
      ) : null}

      {props.overdue > 0 ? (
        <HStack spacing={4}>
          <Text modifiers={[font({ weight: 'semibold', size: 12 }), foregroundStyle('#B91C1C')]}>
            {props.overdue} overdue
          </Text>
          <Spacer />
        </HStack>
      ) : null}
    </VStack>
  );
};

/** The name must match the widget's `name` in app.json. */
export default createWidget<WidgetProps>('DueToday', DueToday);

export { EMPTY_WIDGET_PROPS };
