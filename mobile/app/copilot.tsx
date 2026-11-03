import { Redirect, useLocalSearchParams } from 'expo-router';

/**
 * The assistant was called Copilot before it was Bobby.
 *
 * Launcher shortcuts pinned on Android, Shortcuts built on iOS, and links
 * already shared all open nwplanner://copilot. Without this they would land on
 * the not-found screen, so the old route forwards to the new tab with whatever
 * it was given (the Ask AI record context included).
 */
export default function LegacyCopilotRoute() {
  const params = useLocalSearchParams<{
    about?: string; kind?: string; title?: string; approved?: string;
  }>();
  return <Redirect href={{ pathname: '/(tabs)/bobby', params }} />;
}
