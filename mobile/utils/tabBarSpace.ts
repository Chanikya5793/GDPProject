import { Platform } from 'react-native';

// The tab bar is position:'absolute' on iOS, so it floats over the screen and
// anything pinned to the bottom sits underneath it unless it allows for the
// bar plus whatever the home indicator takes. This was already learned the hard
// way once, when the assistant's input row rendered behind the bar and the chat
// had no visible box to type in.
export const IOS_TAB_BAR_HEIGHT = 49;

/** How much room to leave at the bottom of a screen for the floating tab bar. */
export function tabBarSpace(bottomInset: number): number {
  return Platform.OS === 'ios' ? IOS_TAB_BAR_HEIGHT + bottomInset : 0;
}

/**
 * Where a floating toast clears the tab bar. Unlike tabBarSpace this is the
 * same on both platforms: Android's bar is in the layout rather than floating,
 * but a toast is drawn over the whole window, bar and gesture area included.
 */
export function toastClearance(bottomInset: number): number {
  return IOS_TAB_BAR_HEIGHT + bottomInset;
}
