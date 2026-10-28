import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import App, { referenceISO } from './App'
import { highlightedSegments } from './api'

describe('Inspector',()=>{
  it('starts with nine stages and disables payload export until ready', async()=>{
    globalThis.fetch=vi.fn(async url=>({ok:true,json:async()=>url.endsWith('/health')?{status:'ok'}:url.endsWith('/configurations')?{active_id:'default',items:[]}:url.endsWith('/models')?{active_id:null,items:[]}:[]}))
    render(<App/> )
    expect(screen.getByRole('heading',{name:'From language to action.'})).toBeInTheDocument()
    expect(screen.getByRole('button',{name:/Export JSON/})).toBeDisabled()
    expect(screen.getByRole('button',{name:/09\s*Validation & payload/})).toBeInTheDocument()
    await waitFor(()=>expect(screen.getByRole('button',{name:/Run pipeline/})).toBeEnabled())
    fireEvent.click(screen.getByRole('button',{name:/Negation/}))
    expect(screen.getByLabelText('Planner request')).toHaveValue("Don't delete the task Pay rent")
  })
  it('converts the reference wall clock using the selected timezone',()=>{
    expect(referenceISO('2026-10-27T12:00','America/Chicago')).toBe('2026-10-27T17:00:00.000Z')
    expect(referenceISO('2026-12-01T12:00','America/Chicago')).toBe('2026-12-01T18:00:00.000Z')
    expect(()=>referenceISO('2026-03-08T02:30','America/Chicago')).toThrow('does not exist')
  })
  it('highlights original spans and ignores overlaps or invalid offsets',()=>{
    const pieces=highlightedSegments('pls create',[{start:4,end:10,field:'action',rule_id:'create'},{start:4,end:8,field:'overlap'},{start:-1,end:3,field:'invalid'}])
    expect(pieces).toEqual([{text:'pls '},{text:'create',field:'action',rule:'create'}])
  })
})
