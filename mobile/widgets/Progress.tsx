import { AccessoryWidgetBackground, Gauge, Text, VStack, ZStack } from '@expo/ui/swift-ui';
import { font, gaugeStyle, widgetURL } from '@expo/ui/swift-ui/modifiers';
import { createWidget, type WidgetEnvironment } from 'expo-widgets';
import type { WidgetProps } from '@/utils/widgetSnapshot';

// Today's progress as a Lock Screen ring.
//
// See widgets/DueToday.tsx for why everything here is written out inline.
//
// The one widget with no configuration, on purpose: a configured widget is
// generated as an iOS 17 AppIntentConfiguration and simply does not appear in
// the gallery below that, so this is what a student on the 16.4 floor can
// still add. It also has nothing worth configuring — it is a fraction.
//
// Gauge's own labels are dropped by the widget renderer, so the number is
// stacked over a bare gauge instead of passed to it as a child.

const Progress = (props: WidgetProps, environment: WidgetEnvironment) => {
  'widget';

  const done = props.doneToday || 0;
  const total = props.totalToday || 0;
  const fraction = total > 0 ? done / total : 0;
  const family = environment.widgetFamily;
  const link = widgetURL('nwplanner://tasks');

  if (family === 'accessoryInline') {
    return (
      <Text modifiers={[link]}>
        {total === 0 ? 'Nothing due today' : done + ' of ' + total + ' done'}
      </Text>
    );
  }

  if (family === 'accessoryRectangular') {
    return (
      <VStack alignment="leading" spacing={1} modifiers={[link]}>
        <Text modifiers={[font({ weight: 'semibold', size: 15 })]}>
          {total === 0 ? 'Nothing due' : done + ' of ' + total + ' done'}
        </Text>
        <Text modifiers={[font({ size: 12 })]}>
          {total === 0
            ? 'Enjoy it'
            : done >= total ? 'Day finished' : (total - done) + ' left today'}
        </Text>
      </VStack>
    );
  }

  // accessoryCircular: a ring with the count in the middle.
  return (
    <ZStack modifiers={[link]}>
      <AccessoryWidgetBackground />
      <Gauge value={fraction} min={0} max={1} modifiers={[gaugeStyle('circularCapacity')]} />
      <Text modifiers={[font({ weight: 'semibold', size: 13 })]}>
        {total === 0 ? '—' : String(done)}
      </Text>
    </ZStack>
  );
};

export default createWidget<WidgetProps>('Progress', Progress);
