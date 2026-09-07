import { Chart, HStack, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import {
  containerBackground, font, foregroundStyle, frame, padding, widgetURL,
} from '@expo/ui/swift-ui/modifiers';
import { createWidget, type WidgetEnvironment } from 'expo-widgets';
import type { WidgetProps } from '@/utils/widgetSnapshot';
import type { ThisWeekConfig } from './config';

// How the week is loaded, as a bar per day.
//
// See widgets/DueToday.tsx for why everything here is written out inline.
//
// This is the one widget worth a medium or large tile: seven bars answer
// "when am I actually free?", which no count can. Today's bar is drawn in the
// accent and the rest in grey, so the eye lands on the right column without a
// legend. No titles appear here at any setting — a bar chart of counts is
// already the whole point, and it is the safest thing on the home screen.

const ThisWeek = (props: WidgetProps, environment: WidgetEnvironment<ThisWeekConfig>) => {
  'widget';

  const config = environment.configuration || {};
  const accentName = config.accent || 'green';
  const accent =
    accentName === 'blue' ? '#1D4ED8'
      : accentName === 'plum' ? '#7C3AED'
        : accentName === 'amber' ? '#B45309'
          : '#006A4E';

  const days = props.days || [];
  const busiest = days.reduce((most, day) => (day.count > most ? day.count : most), 0);
  const total = days.reduce((sum, day) => sum + day.count, 0);
  const lightest = days.reduce(
    (best, day) => (!day.isToday && day.count < best.count ? day : best),
    days.length > 0 ? days[days.length - 1] : { label: '', count: 0, isToday: false, weekday: 0 },
  );

  // Repeated weekday letters would collapse into one bar, so each x carries its
  // offset. The label the student reads is drawn underneath instead.
  const data = days.map((day, index) => ({
    x: day.label + '​'.repeat(index),
    y: day.count,
    color: day.isToday ? accent : '#C7CFD4',
  }));

  return (
    <VStack
      alignment="leading"
      spacing={5}
      modifiers={[
        containerBackground('#FFFFFF', 'widget'),
        padding({ all: 2 }),
        widgetURL('nwplanner://calendar'),
      ]}
    >
      <HStack spacing={6}>
        <Text modifiers={[font({ weight: 'semibold', size: 13 })]}>This week</Text>
        <Spacer />
        <Text modifiers={[font({ weight: 'semibold', size: 12 }), foregroundStyle(accent)]}>
          {total === 0 ? 'Clear' : total + ' items'}
        </Text>
      </HStack>

      {total === 0 ? (
        <VStack alignment="leading" spacing={2}>
          <Text modifiers={[font({ size: 12 }), foregroundStyle('#6B7280')]}>
            Nothing scheduled in the next seven days.
          </Text>
          <Spacer />
        </VStack>
      ) : (
        <Chart
          type="bar"
          data={data}
          animate={false}
          modifiers={[frame({ maxWidth: 10000, minHeight: 62 })]}
        />
      )}

      <HStack spacing={0}>
        {days.map((day, index) => (
          <Text
            key={String(index)}
            modifiers={[
              font({ weight: day.isToday ? 'semibold' : 'regular', size: 10 }),
              foregroundStyle(day.isToday ? accent : '#9AA5AC'),
              frame({ maxWidth: 10000 }),
            ]}
          >
            {day.label}
          </Text>
        ))}
      </HStack>

      {total > 0 ? (
        <Text modifiers={[font({ size: 10 }), foregroundStyle('#6B7280')]}>
          {busiest > 0 && lightest.count === 0 && lightest.label
            ? 'Lightest day is ' + lightest.label + '. Busiest has ' + busiest + '.'
            : 'Busiest day has ' + busiest + '.'}
        </Text>
      ) : null}

      <Spacer />
    </VStack>
  );
};

export default createWidget<WidgetProps, ThisWeekConfig>('ThisWeek', ThisWeek);
