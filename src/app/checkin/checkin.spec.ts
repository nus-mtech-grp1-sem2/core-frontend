import { outcomeDescription, outcomeIcon } from './checkin';

describe('event helper outcomes', () => {
  it('maps every server outcome to explicit helper-facing text', () => {
    expect(outcomeDescription('VALID')).toContain('Valid ticket');
    expect(outcomeDescription('ALREADY_USED')).toContain('Already used');
    expect(outcomeDescription('INVALID')).toContain('Invalid ticket');
    expect(outcomeDescription('WRONG_EVENT')).toContain('Wrong event');
  });

  it('provides non-color indicators for every outcome', () => {
    const outcomes = ['VALID', 'ALREADY_USED', 'INVALID', 'WRONG_EVENT'] as const;
    expect(new Set(outcomes.map((outcome) => outcomeIcon(outcome))).size).toBe(4);
  });
});
