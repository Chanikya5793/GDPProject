/** The span a repeat covers, so one preview can stand for the whole series. */
export interface SeriesRecord {
  content?: { due_date?: string; date?: string };
}

export function seriesSummary(proposal?: { series?: SeriesRecord[] } | null): string | null {
  const series = proposal?.series;
  if (!series || series.length < 2) return null;
  const day = (record: SeriesRecord) => record.content?.due_date || record.content?.date || '';
  return `Creates ${series.length} records, ${day(series[0])} to ${day(series[series.length - 1])}`;
}
