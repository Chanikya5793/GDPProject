import { getSecureCollection, setSecureCollection } from './secureCollections'

const NAMESPACE = 'metadata:categories'
const BUILT_IN = [
    { id: 'homework', name: 'Homework', color: '#3B82F6', builtin: true },
    { id: 'exam', name: 'Exam', color: '#DC2626', builtin: true },
    { id: 'project', name: 'Project', color: '#7C3AED', builtin: true },
    { id: 'reading', name: 'Reading', color: '#D97706', builtin: true },
    { id: 'lab', name: 'Lab', color: '#16A34A', builtin: true },
    { id: 'appointment', name: 'Appointment', color: '#ebf304', builtin: true},
    { id: 'other', name: 'Other', color: '#6B7280', builtin: true },
]

export async function getCategories() {
  return [...BUILT_IN, ...await getSecureCollection(NAMESPACE, [])]
}

export async function createCategory(category) {
  const custom = await getSecureCollection(NAMESPACE, [])
  const created = {
    ...category, id: `custom_${crypto.randomUUID()}`, builtin: false,
  }
  await setSecureCollection(NAMESPACE, [...custom, created])
  return created
}

export async function deleteCategory(id) {
  const custom = await getSecureCollection(NAMESPACE, [])
  await setSecureCollection(NAMESPACE, custom.filter(category => category.id !== id))
  return { success: true }
}

