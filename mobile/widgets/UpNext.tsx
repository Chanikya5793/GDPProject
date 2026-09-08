import { Button, HStack, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import {
  containerBackground, font, foregroundStyle, lineLimit, minimumScaleFactor,
  padding, privacySensitive, widgetURL,
} from '@expo/ui/swift-ui/modifiers';
import { createWidget, type WidgetEnvironment } from 'expo-widgets';
import type { WidgetProps } from '@/utils/widgetSnapshot';
import type { UpNextConfig } from './config';

// The single next thing, and how long is left.
//
// See widgets/DueToday.tsx for why everything here is written out inline.
//
// The countdown is the reason this widget exists. `Text` with a `date` and
// dateStyle "timer" ticks in the widget process on its own, so "in 2h 14m"
// stays right without spending a single timeline entry — and timeline entries
// are the scarce resource, since nothing of ours runs once the app closes.
//
// The tick boxes are real buttons on iOS 17 and above. Tapping one rewrites
// this entry's props in place so the widget responds immediately; the app
// reconciles the actual record when it next comes to the foreground.

const UpNext = (props: WidgetProps, environment: WidgetEnvironment<UpNextConfig>) => {
  'widget';

  const config = environment.configuration || {};
  const accentName = config.accent || 'green';
  const accent =
    accentName === 'blue' ? '#1D4ED8'
      : accentName === 'plum' ? '#7C3AED'
        : accentName === 'amber' ? '#B45309'
          : '#006A4E';
  const showTitles = config.showTitles === true && props.titlesAllowed;
  const countdown = config.countdown !== false;
  const family = environment.widgetFamily;

  const now = environment.date ? environment.date.getTime() : Date.now();

  const queue = (props.items || []).filter(item => {
    if (item.done) return false;
    if (config.include === 'tasks' && item.kind !== 'task') return false;
    if (config.include === 'reminders' && item.kind !== 'reminder') return false;
    return true;
  });
  const lead = queue.length > 0 ? queue[0] : null;

  const clock = (at: number) => {
    const d = new Date(at);
    const h = d.getHours();
    const m = d.getMinutes() < 10 ? '0' + d.getMinutes() : String(d.getMinutes());
    return (((h + 11) % 12) + 1) + ':' + m + ' ' + (h < 12 ? 'AM' : 'PM');
  };

  const label = (item: { title: string; kind: string; category: string }) =>
    showTitles && item.title
      ? item.title
      : item.kind === 'reminder' ? 'Reminder' : (item.category || 'Task');

  const link = widgetURL(lead ? 'nwplanner://tasks?focus=' + lead.id : 'nwplanner://tasks');

  if (family === 'accessoryInline') {
    return (
      <Text modifiers={[link]}>
        {lead ? label(lead) + ' · ' + clock(lead.at) : 'Nothing up next'}
      </Text>
    );
  }

  if (family === 'accessoryRectangular') {
    return (
      <VStack alignment="leading" spacing={1} modifiers={[link]}>
        <Text modifiers={[font({ weight: 'semibold', size: 15 }), lineLimit(1), privacySensitive(showTitles)]}>
          {lead ? label(lead) : 'Nothing up next'}
        </Text>
        {lead && countdown ? (
          <Text date={new Date(lead.at)} dateStyle="relative" modifiers={[font({ size: 12 })]} />
        ) : lead ? (
          <Text modifiers={[font({ size: 12 })]}>{clock(lead.at)}</Text>
        ) : null}
      </VStack>
    );
  }

  const wide = family === 'systemMedium';

  if (!lead) {
    return (
      <VStack
        alignment="leading"
        spacing={4}
        modifiers={[containerBackground('#FFFFFF', 'widget'), padding({ all: 2 }), link]}
      >
        <Text modifiers={[font({ weight: 'semibold', size: 15 }), foregroundStyle(accent)]}>
          All clear
        </Text>
        <Text modifiers={[font({ size: 12 }), foregroundStyle('#6B7280')]}>
          Nothing left on the list.
        </Text>
        <Spacer />
      </VStack>
    );
  }

  const overdue = lead.at < now;

  return (
    <VStack
      alignment="leading"
      spacing={wide ? 5 : 3}
      modifiers={[containerBackground('#FFFFFF', 'widget'), padding({ all: 2 }), link]}
    >
      <Text modifiers={[font({ weight: 'semibold', size: 10 }), foregroundStyle('#6B7280')]}>
        {overdue ? 'OVERDUE' : 'UP NEXT'}
      </Text>

      <Text
        modifiers={[
          font({ weight: 'semibold', size: wide ? 17 : 15 }),
          lineLimit(2),
          minimumScaleFactor(0.8),
          privacySensitive(showTitles),
        ]}
      >
        {label(lead)}
      </Text>

      {countdown ? (
        <Text
          date={new Date(lead.at)}
          dateStyle="relative"
          modifiers={[
            font({ weight: 'bold', size: wide ? 22 : 18 }),
            foregroundStyle(overdue ? '#B91C1C' : accent),
            minimumScaleFactor(0.7),
          ]}
        />
      ) : (
        <Text
          modifiers={[
            font({ weight: 'bold', size: wide ? 22 : 18 }),
            foregroundStyle(overdue ? '#B91C1C' : accent),
          ]}
        >
          {clock(lead.at)}
        </Text>
      )}

      <Spacer />

      {wide ? (
        <HStack spacing={8}>
          {queue.slice(1, 4).map(item => (
            <Text
              key={item.id}
              modifiers={[font({ size: 10 }), foregroundStyle('#6B7280'), lineLimit(1)]}
            >
              {clock(item.at)}
            </Text>
          ))}
          <Spacer />
          {lead.kind === 'task' ? (
            <Button
              target={'done:' + lead.id}
              label="Done"
              systemImage="checkmark.circle"
              onPress={() => ({
                items: (props.items || []).map(i =>
                  (i.id === lead.id ? { ...i, done: true } : i)),
                dueToday: props.dueToday > 0 ? props.dueToday - 1 : 0,
                doneToday: props.doneToday + 1,
              })}
            />
          ) : null}
        </HStack>
      ) : (
        <HStack spacing={6}>
          <Text modifiers={[font({ size: 10 }), foregroundStyle('#6B7280')]}>
            {props.dueToday + ' today'}
          </Text>
          <Spacer />
          {lead.kind === 'task' ? (
            <Button
              target={'done:' + lead.id}
              label=""
              systemImage="checkmark.circle"
              onPress={() => ({
                items: (props.items || []).map(i =>
                  (i.id === lead.id ? { ...i, done: true } : i)),
                dueToday: props.dueToday > 0 ? props.dueToday - 1 : 0,
                doneToday: props.doneToday + 1,
              })}
            />
          ) : null}
        </HStack>
      )}
    </VStack>
  );
};

export default createWidget<WidgetProps, UpNextConfig>('UpNext', UpNext);
