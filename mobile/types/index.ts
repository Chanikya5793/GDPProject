export interface User {
  id: string;
  uid: string;
  name: string;
  email: string;
  emailVerified: boolean;
}

export type PlannerRecordId = string | number;

export interface Task {
  id: PlannerRecordId;
  userId: string;
  title: string;
  dueDate: string;
  dueTime: string;
  priority: 'high' | 'medium' | 'low';
  category: string;
  notes: string;
  completed: boolean;
  createdAt: string;
  /**
   * "Leave this one where I put it." Auto-balance never moves a pinned task to
   * an earlier day, and its priority is not escalated as the date nears.
   */
  keepScheduled?: boolean;
  _revision?: number;
  _approvedForAi?: boolean;
  _pending?: boolean;
  /** Set on every record of a repeat, tying the series together. */
  seriesId?: string | null;
  recurrence?: { frequency: string; interval: number; count: number } | null;
}

export interface Reminder {
  id: PlannerRecordId;
  userId: string;
  title: string;
  date: string;
  time: string;
  notes: string;
  /** The server has always stored this; the mobile client used to discard it. */
  completed?: boolean;
  createdAt: string;
  _revision?: number;
  _approvedForAi?: boolean;
  _pending?: boolean;
  /** Set on every record of a repeat, tying the series together. */
  seriesId?: string | null;
  recurrence?: { frequency: string; interval: number; count: number } | null;
}

export interface NoteAttachment {
  id: string;
  name: string;
  type: string;
  size: number;
  /** data: URI. Stays on the device — never sent to the planner backend. */
  dataUrl: string;
  approvedForAi: boolean;
}

/** A text attachment as the planner API stores it. Web creates these; the
 * phone has no UI for them and only carries them through untouched. */
export interface ServerAttachment {
  attachment_id: string;
  filename: string;
  text: string;
  approved_for_ai: boolean;
}

export interface Note {
  id: PlannerRecordId;
  userId: string;
  title: string;
  body: string;
  tagIds: number[];
  attachments?: NoteAttachment[];
  updatedAt: string;
  createdAt: string;
  _revision?: number;
  _approvedForAi?: boolean;
  _pending?: boolean;
  /**
   * Fields owned by another client, round-tripped so a save from here does
   * not erase them: the web's text attachments (which feed the assistant's
   * index) and its string tag ids. Both used to be dropped on every write --
   * a phone edit sent `attachments: []` and turned `"chemistry"` into
   * `"NaN"`.
   */
  _serverAttachments?: ServerAttachment[];
  _foreignTagIds?: string[];
}

export interface Tag {
  id: number;
  name: string;
  color: string;
}

export interface Category {
  id: string;
  name: string;
  color: string;
  builtin: boolean;
  userId?: string;
}

export interface Settings {
  theme: 'light' | 'dark' | 'system';
  accentColor: 'green' | 'blue' | 'purple' | 'amber';
  compactMode: boolean;
  fontSize: 'default' | 'large' | 'larger';
  reducedMotion: boolean;
  weekStartsOn: 'sunday' | 'monday';
  defaultPriority: 'high' | 'medium' | 'low';
  defaultCategory: string;
  showCompleted: boolean;
  reminderDefault: number;
  dueDateAlerts: boolean;
  /** Whether the home screen widget may show record titles. On by default. */
  widgetShowTitles: boolean;
  /**
   * True once the student has set widgetShowTitles themselves. Settings are
   * written back whole, so an install that pre-dates the on-by-default change
   * carries a stored `false` it never chose; this is how that is told apart
   * from a deliberate off.
   */
  widgetTitlesDecided?: boolean;
  /** Move lower-priority tasks off overloaded days without asking. Off by default. */
  autoBalance: boolean;
  /** True once the student has set autoBalance themselves; see widgetTitlesDecided. */
  autoBalanceDecided?: boolean;
  dailyTaskLimit: number;
}

export interface TrashItem {
  _trashId: string;
  _trashType: 'task' | 'reminder' | 'note';
  _deletedAt: string;
  [key: string]: unknown;
}

export type LogAction =
  | 'created' | 'updated' | 'deleted' | 'completed' | 'reopened' | 'reverted';

export type LogEntity = 'task' | 'reminder' | 'note' | 'tag';

export interface LogEntry {
  id: string;
  ts: string;
  sessionId: string;
  sessionStart: string;
  action: LogAction;
  entity: LogEntity;
  title: string;
  entityId?: string | number;
  before?: unknown;
  after?: unknown;
  trashId?: number | string;
  revertOf?: string;
  reverted?: boolean;
  revertedAt?: string;
}
