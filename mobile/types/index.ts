export interface User {
  id: number;
  name: string;
  email: string;
}

export interface Task {
  id: number;
  userId: number;
  title: string;
  dueDate: string;
  dueTime: string;
  priority: 'high' | 'medium' | 'low';
  category: string;
  notes: string;
  completed: boolean;
  createdAt: string;
}

export interface Reminder {
  id: number;
  userId: number;
  title: string;
  date: string;
  time: string;
  notes: string;
  createdAt: string;
}

export interface Note {
  id: number;
  userId: number;
  title: string;
  body: string;
  tagIds: number[];
  updatedAt: string;
  createdAt: string;
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
  userId?: number;
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
}

export interface TrashItem {
  _trashId: number;
  _trashType: 'task' | 'reminder' | 'note';
  _deletedAt: string;
  [key: string]: unknown;
}
