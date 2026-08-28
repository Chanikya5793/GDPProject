import { StyleSheet } from 'react-native';

import { Appearance, scaleStyles } from './appearance';

/**
 * Build a style sheet with the user's appearance settings applied.
 *
 * Curried so a style factory only has to change where it opens the call:
 * `StyleSheet.create({…})` becomes `createStyles(appearance)({…})`, and the
 * closing paren and everything between them stay exactly as they were.
 */
export function createStyles(appearance: Appearance) {
  return function build<T extends StyleSheet.NamedStyles<T>>(styles: T): T {
    return StyleSheet.create(scaleStyles(styles as Record<string, unknown>, appearance) as T);
  };
}
