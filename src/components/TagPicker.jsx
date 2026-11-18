import { useEffect, useState } from 'react'
import { getTags } from '../api/tags'

export default function TagPicker({ value = [], onChange }) {
  const [tags, setTags] = useState(null)

  useEffect(() => {
    let active = true
    getTags().then(result => { if (active) setTags(result) })
      .catch(() => { if (active) setTags([]) })
    return () => { active = false }
  }, [])

  if (!tags?.length) return null
  const selected = new Set(value.map(String))
  return (
    <fieldset className="form-group" style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <legend className="form-label">Tags</legend>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px' }}>
        {tags.map(tag => {
          const id = String(tag.id)
          return (
            <label key={id} className="form-checkbox">
              <input type="checkbox" checked={selected.has(id)} onChange={event => {
                onChange(event.target.checked ? [...value, tag.id] : value.filter(item => String(item) !== id))
              }} />
              <span>{tag.name}</span>
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}
