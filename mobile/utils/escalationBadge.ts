// The short label on a task whose priority was raised because its due date is near.

/**
 * Days until due (negative once past) → badge text. Only a past due date is
 * OVERDUE; a task due today used to be labelled OVERDUE too, which read as
 * the app saying it was already late.
 */
export function escalationBadgeLabel(daysUntilDue: number): string {
  if (daysUntilDue < 0) return 'OVERDUE';
  if (daysUntilDue === 0) return 'TODAY';
  if (daysUntilDue === 1) return 'TMR';
  return `${daysUntilDue}D`;
}
