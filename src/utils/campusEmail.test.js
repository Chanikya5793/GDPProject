import { describe, expect, it } from 'vitest'

import { campusEmail } from './campusEmail'

describe('campusEmail', () => {
  it('turns an S number into the student address', () => {
    expect(campusEmail('S123456')).toBe('s123456@nwmissouri.edu')
    expect(campusEmail(' s123456 ')).toBe('s123456@nwmissouri.edu')
  })

  it('adds the S to a bare student ID', () => {
    expect(campusEmail('123456')).toBe('s123456@nwmissouri.edu')
  })

  it('turns an employee username into the staff address', () => {
    expect(campusEmail('JDoe')).toBe('jdoe@nwmissouri.edu')
    expect(campusEmail('jane.doe')).toBe('jane.doe@nwmissouri.edu')
  })

  it('completes an address that stops at the @', () => {
    expect(campusEmail('s123456@')).toBe('s123456@nwmissouri.edu')
  })

  it('leaves a full address alone so the policy can judge it', () => {
    expect(campusEmail('S123456@NWMissouri.edu')).toBe('s123456@nwmissouri.edu')
    expect(campusEmail('someone@gmail.com')).toBe('someone@gmail.com')
  })

  it('returns nothing for a blank field', () => {
    for (const blank of ['', '   ', null, undefined]) expect(campusEmail(blank)).toBe('')
  })
})
