import { useEffect, useState } from 'react';
import { Text, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';
import { apiConfigured } from '@/api/client';
import { getPlannerSyncState, onPlannerSyncChanged, refreshPlannerData } from '@/api/plannerClient';
import { useAuth } from '@/contexts/AuthContext';
import { useAppTheme } from '@/theme/useAppTheme';

/** Keep a cached planner usable without making it look like a live cloud copy. */
export default function PlannerSyncStatus() {
  const { user } = useAuth();
  const { colors, accent } = useAppTheme();
  const [state, setState] = useState(getPlannerSyncState);
  useEffect(() => {
    const read = () => setState(getPlannerSyncState());
    read();
    return onPlannerSyncChanged(read);
  }, [user?.id]);
  if (!user || !apiConfigured()) return null;
  const label = state.syncing ? 'Updating from your account…'
    : state.error ?? (state.lastSyncedAt ? `Account updated at ${new Date(state.lastSyncedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
        : 'Showing saved data. Pull down to update.');
  return (
    <TouchableOpacity onPress={() => {
      if (state.error?.includes('review')) router.push('/settings');
      else void refreshPlannerData(true).catch(() => {});
    }}
      disabled={state.syncing} accessibilityRole="button" accessibilityLabel={label}
      accessibilityHint="Refresh your planner from your account"
      style={{ paddingVertical: 10, minHeight: 44 }}>
      <Text style={{ color: state.error ? colors.textSecondary : accent.primary, fontSize: 12 }}
        accessibilityLiveRegion="polite">{label}</Text>
    </TouchableOpacity>
  );
}
