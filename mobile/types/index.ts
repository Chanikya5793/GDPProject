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
  _revision?: number;
  _approvedForAi?: boolean;
  _pending?: boolean;
}

export interface Reminder {
  id: PlannerRecordId;
  userId: string;
  title: string;
  date: string;
  time: string;
  notes: string;
  createdAt: string;
  _revision?: number;
  _approvedForAi?: boolean;
  _pending?: boolean;
}

export interface Note {
  id: PlannerRecordId;
  userId: string;
  title: string;
  body: string;
  tagIds: number[];
  updatedAt: string;
  createdAt: string;
  _revision?: number;
  _approvedForAi?: boolean;
  _pending?: boolean;
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
  autoBalance: boolean;
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
