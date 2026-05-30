import { Category } from '@/types';
import { getItem, setItem } from './storage';

const KEY = 'nw_categories';

const BUILT_IN: Category[] = [
  { id: 'homework', name: 'Homework', color: '#3B82F6', builtin: true },
  { id: 'exam', name: 'Exam', color: '#DC2626', builtin: true },
  { id: 'project', name: 'Project', color: '#7C3AED', builtin: true },
  { id: 'reading', name: 'Reading', color: '#D97706', builtin: true },
  { id: 'lab', name: 'Lab', color: '#16A34A', builtin: true },
  { id: 'other', name: 'Other', color: '#6B7280', builtin: true },
];

export async function getCategories(userId: number): Promise<Category[]> {
  const custom = await getItem<Category[]>(KEY, []);
  return [...BUILT_IN, ...custom.filter(c => c.userId === userId)];
}

export async function createCategory(category: Partial<Category> & { userId: number; name: string }): Promise<Category> {
  const custom = await getItem<Category[]>(KEY, []);
  const newCat: Category = {
    id: `custom_${Date.now()}`,
    name: category.name,
    color: category.color || '#6B7280',
    builtin: false,
    userId: category.userId,
  };
  await setItem(KEY, [...custom, newCat]);
  return newCat;
}
