import { HStack, Image, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import {
  font, foregroundStyle, lineLimit, minimumScaleFactor, monospacedDigit,
  opacity, padding, privacySensitive,
} from '@expo/ui/swift-ui/modifiers';
import { createLiveActivity, type LiveActivityEnvironment } from 'expo-widgets';
import type { StudySessionProps } from '@/utils/studySession';

// The focus session, on the Lock Screen and in the Dynamic Island.
//
// Same sandbox rule as widgets/DueToday.tsx — read the note at the top of that
// file. This body is stringified at build time and evaluated in a bare
// JavaScriptCore context, so it may reference nothing outside itself.
//
// Three things differ from a home screen widget, and all three are easy to get
// wrong:
//
//   1. This returns an OBJECT of named regions, not a single element. `banner`
//      is the only required one; every other key is a slot the system fills
//      when it has somewhere to put it.
//   2. No widgetURL anywhere. The deep link is handed to start() and applied
//      once to the whole hierarchy natively; a second one is undefined.
//   3. There is no timeline and no environment.date. Nothing of ours will run
//      again after start() — which is why the countdown is a SwiftUI timer
//      bound to two timestamps rather than a number we recompute. It ticks in
//      the system's own process, correct to the second, with the app closed.
//
// `isStale` flips on its own at the session's end time, again without the app
// running, so the card can go quiet at the right moment by itself.

const StudySession = (props: StudySessionProps, environment: LiveActivityEnvironment) => {
  'widget';

  const accent = '#006A4E';
  const muted = '#6B7280';
  const done = environment.isStale === true;
  const paused = props.pausedAt > 0;

  const showLabel = props.titlesAllowed === true && props.label !== '';
  const heading = showLabel ? props.label : (props.category || 'Focus');

  const status = done ? 'SESSION OVER' : paused ? 'PAUSED' : 'FOCUS';
  const tint = done ? '#9CA3AF' : paused ? muted : accent;

  // Bound to the interval rather than a rendered number: SwiftUI counts it down
  // itself. pauseTime is what freezes it where it stands.
  const timer = (size: number, weight: 'bold' | 'semibold') => (
    <Text
      timerInterval={{ lower: new Date(props.startedAt), upper: new Date(props.endsAt) }}
      countsDown
      pauseTime={paused ? new Date(props.pausedAt) : undefined}
      modifiers={[
        font({ weight, size }),
        monospacedDigit(),
        foregroundStyle(tint),
        minimumScaleFactor(0.6),
        lineLimit(1),
      ]}
    />
  );

  return {
    banner: (
      <VStack alignment="leading" spacing={4} modifiers={[padding({ all: 14 })]}>
        <HStack spacing={6}>
          <Image systemName="book.closed.fill" color={tint} size={13} />
          <Text modifiers={[font({ weight: 'semibold', size: 11 }), foregroundStyle(muted)]}>
            {status}
          </Text>
          <Spacer />
          {props.dueToday > 0 ? (
            <Text modifiers={[font({ size: 11 }), foregroundStyle(muted)]}>
              {props.dueToday + ' due today'}
            </Text>
          ) : null}
        </HStack>

        <Text
          modifiers={[
            font({ weight: 'semibold', size: 17 }),
            lineLimit(1),
            minimumScaleFactor(0.8),
            privacySensitive(showLabel),
          ]}
        >
          {heading}
        </Text>

        <HStack spacing={8}>
          {timer(30, 'bold')}
          <Spacer />
          <Text modifiers={[font({ size: 11 }), foregroundStyle(muted), opacity(done ? 0.7 : 1)]}>
            {done ? 'Nice work' : paused ? 'Resume in the app' : 'left'}
          </Text>
        </HStack>
      </VStack>
    ),

    // Watch and CarPlay, iOS 18 and later. Says less on purpose: a wrist is a
    // more public surface than a phone on a desk, and the library mirrors this
    // activity to a paired watch whether or not anyone asked it to.
    bannerSmall: (
      <HStack spacing={6} modifiers={[padding({ all: 8 })]}>
        <Image systemName="book.closed.fill" color={tint} size={12} />
        {timer(17, 'semibold')}
      </HStack>
    ),

    compactLeading: <Image systemName="book.closed.fill" color={tint} size={12} />,
    compactTrailing: timer(13, 'semibold'),
    minimal: <Image systemName="book.closed.fill" color={tint} size={12} />,

    expandedLeading: (
      <VStack alignment="leading" spacing={2} modifiers={[padding({ leading: 6 })]}>
        <Image systemName="book.closed.fill" color={tint} size={16} />
        <Text modifiers={[font({ size: 10 }), foregroundStyle(muted)]}>
          {done ? 'Over' : paused ? 'Paused' : 'Focus'}
        </Text>
      </VStack>
    ),

    expandedTrailing: (
      <VStack alignment="trailing" spacing={2} modifiers={[padding({ trailing: 6 })]}>
        {timer(20, 'bold')}
        <Text modifiers={[font({ size: 10 }), foregroundStyle(muted)]}>
          {done ? 'done' : 'left'}
        </Text>
      </VStack>
    ),

    expandedBottom: (
      <VStack alignment="leading" spacing={2} modifiers={[padding({ all: 6 })]}>
        <Text
          modifiers={[
            font({ weight: 'semibold', size: 14 }),
            lineLimit(1),
            privacySensitive(showLabel),
          ]}
        >
          {heading}
        </Text>
        {props.dueToday > 0 ? (
          <Text modifiers={[font({ size: 11 }), foregroundStyle(muted), opacity(done ? 0.6 : 1)]}>
            {props.dueToday + ' due today'}
          </Text>
        ) : null}
      </VStack>
    ),
  };
};

export default createLiveActivity<StudySessionProps>('StudySession', StudySession);
