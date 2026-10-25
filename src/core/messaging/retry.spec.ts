import { decideOnFailure, describeError, PermanentError } from './retry';

const delays = [1000, 5000, 30000];

describe('decideOnFailure', () => {
  it('retries with growing backoff', () => {
    const transient = new Error('connection reset');
    expect(decideOnFailure(0, delays, transient)).toEqual({
      action: 'retry',
      attempt: 1,
      delayMs: 1000,
    });
    expect(decideOnFailure(1, delays, transient)).toMatchObject({
      delayMs: 5000,
    });
    expect(decideOnFailure(2, delays, transient)).toMatchObject({
      delayMs: 30000,
    });
  });

  it('dead-letters once the retries are used up', () => {
    expect(decideOnFailure(3, delays, new Error('still down'))).toEqual({
      action: 'dead-letter',
      attempt: 4,
    });
  });

  it('dead-letters a permanent error immediately', () => {
    expect(decideOnFailure(0, delays, new PermanentError('bad json'))).toEqual({
      action: 'dead-letter',
      attempt: 1,
    });
  });
});

describe('describeError', () => {
  it('puts the root cause first', () => {
    const root = new Error('relation "x" does not exist');
    const wrapped = new Error('Failed query: insert into ...', { cause: root });
    expect(describeError(wrapped)).toBe(
      'relation "x" does not exist <- Failed query: insert into ...',
    );
  });

  it('caps the length', () => {
    expect(describeError(new Error('x'.repeat(1000)))).toHaveLength(500);
  });
});
