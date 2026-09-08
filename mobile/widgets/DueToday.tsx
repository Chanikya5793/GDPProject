import { HStack, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import {
  containerBackground, font, foregroundStyle, lineLimit, minimumScaleFactor,
  monospacedDigit, padding, privacySensitive, widgetURL,
} from '@expo/ui/swift-ui/modifiers';
import { createWidget, type WidgetEnvironment } from 'expo-widgets';
import type { WidgetProps } from '@/utils/widgetSnapshot';
import type { DueTodayConfig } from './config';

// ─────────────────────────────────────────────────────────────────────────────
// READ THIS BEFORE EDITING ANY FILE IN THIS FOLDER.
//
// A function marked 'widget' is not called — it is turned into a *string* of
// its own source at build time and evaluated later, in the widget process, in a
// bare JavaScriptCore runtime. The only things in scope there are the @expo/ui
// components and modifiers. Nothing else: no imports, no module-scope constants
// or helpers of ours, no hooks, no async, no closures over anything outside.
//
// A reference to something outside the function body compiles fine and throws
// ReferenceError at render — and in Release that is not a red box, it is a
// silently blank widget. So every colour, label and helper below is written out
// inline, repetitively, on purpose. Type-only imports are safe: they vanish.
//
// Configuration arrives as `environment.configuration`, filled in from what the
// student chose in Edit Widget. The timeline provider does not see it, so props
// carry the superset and each layout narrows it here.
// ─────────────────────────────────────────────────────────────────────────────

const DueToday = (props: WidgetProps, environment: WidgetEnvironment<DueTodayConfig>) => {
  'widget';

  const config = environment.configuration || {};
  const accentName = config.accent || 'green';
  const accent =
    accentName === 'blue' ? '#1D4ED8'
      : accentName === 'plum' ? '#7C3AED'
        : accentName === 'amber' ? '#B45309'
          : '#006A4E';
  const showTitles = config.showTitles === true && props.titlesAllowed;
  const compact = config.density === 'compact';
  const family = environment.widgetFamily;

  const now = environment.date ? environment.date.getTime() : Date.now();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const dayStart = startOfToday.getTime();

  const horizon = config.horizon || 'today';
  const spanDays = horizon === 'week' ? 7 : horizon === 'next3' ? 3 : 1;
  const spanEnd = dayStart + spanDays * 86400000;

  const wanted = (props.items || []).filter(item => {
    if (item.done) return false;
    if (config.include === 'tasks' && item.kind !== 'task') return false;
    if (config.include === 'reminders' && item.kind !== 'reminder') return false;
    if (config.onlyHigh === true && item.kind === 'task' && item.priority !== 'high') return false;
    return item.at < spanEnd;
  });

  const count = horizon === 'today' ? props.dueToday : wanted.filter(i => i.at >= dayStart).length;
  const headline = horizon === 'week' ? 'this week' : horizon === 'next3' ? 'in 3 days' : 'due today';

  const clock = (at: number) => {
    const d = new Date(at);
    const h = d.getHours();
    const m = d.getMinutes() < 10 ? '0' + d.getMinutes() : String(d.getMinutes());
    return (((h + 11) % 12) + 1) + ':' + m + ' ' + (h < 12 ? 'AM' : 'PM');
  };

  const link = widgetURL('nwplanner://tasks');

  // One line on the Lock Screen. Vibrant rendering strips colour, so none is set.
  if (family === 'accessoryInline') {
    return (
      <Text modifiers={[link]}>
        {props.empty
          ? 'Nothing scheduled'
          : count + ' ' + headline + (props.nextAt ? ' · ' + clock(props.nextAt) : '')}
      </Text>
    );
  }

  if (family === 'accessoryRectangular') {
    const lead = wanted.length > 0 ? wanted[0] : null;
    return (
      <VStack alignment="leading" spacing={1} modifiers={[link]}>
        <Text modifiers={[font({ weight: 'semibold', size: 15 })]}>
          {props.empty ? 'Nothing scheduled' : count + ' ' + headline}
        </Text>
        {props.nextAt ? (
          <Text modifiers={[font({ size: 12 }), lineLimit(1)]}>
            {'Next at ' + clock(props.nextAt)}
          </Text>
        ) : null}
        {showTitles && lead && lead.title ? (
          <Text modifiers={[font({ size: 12 }), lineLimit(1), privacySensitive(true)]}>
            {lead.title}
          </Text>
        ) : null}
        {props.overdue > 0 ? (
          <Text modifiers={[font({ size: 11 })]}>{props.overdue + ' overdue'}</Text>
        ) : null}
      </VStack>
    );
  }

  const wide = family === 'systemMedium';
  const rowCount = wide ? (compact ? 4 : 3) : (compact ? 3 : 2);
  const rows = wanted.slice(0, rowCount);

  return (
    <VStack
      alignment="leading"
      spacing={compact ? 3 : 6}
      modifiers={[containerBackground('#FFFFFF', 'widget'), padding({ all: 2 }), link]}
    >
      <HStack spacing={6}>
        <Text
          modifiers={[
            font({ weight: 'bold', size: wide ? 34 : 30 }),
            foregroundStyle(accent),
            minimumScaleFactor(0.7),
          ]}
        >
          {props.empty ? '—' : String(count)}
        </Text>
        <Text modifiers={[font({ weight: 'semibold', size: 12 }), foregroundStyle('#4B5563')]}>
          {props.empty ? 'Nothing scheduled' : headline}
        </Text>
        <Spacer />
        {props.overdue > 0 ? (
          <Text modifiers={[font({ weight: 'semibold', size: 11 }), foregroundStyle('#B91C1C')]}>
            {props.overdue + ' late'}
          </Text>
        ) : null}
      </HStack>

      {rows.map(item => (
        <HStack key={item.id} spacing={5}>
          <Text
            modifiers={[
              font({ weight: 'semibold', size: 11 }),
              foregroundStyle(item.at < dayStart ? '#B91C1C' : accent),
              monospacedDigit(),
            ]}
          >
            {clock(item.at)}
          </Text>
          {showTitles && item.title ? (
            <Text
              modifiers={[font({ size: 11 }), lineLimit(1), privacySensitive(true)]}
            >
              {item.title}
            </Text>
          ) : (
            <Text modifiers={[font({ size: 11 }), foregroundStyle('#6B7280')]}>
              {item.kind === 'reminder' ? 'Reminder' : (item.category || 'Task')}
            </Text>
          )}
          <Spacer />
        </HStack>
      ))}

      {rows.length === 0 && !props.empty ? (
        <Text modifiers={[font({ size: 11 }), foregroundStyle('#6B7280')]}>
          {horizon === 'today' ? 'Clear for today' : 'Nothing in range'}
        </Text>
      ) : null}

      <Spacer />
    </VStack>
  );
};

export default createWidget<WidgetProps, DueTodayConfig>('DueToday', DueToday);
