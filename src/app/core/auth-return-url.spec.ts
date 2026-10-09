import { safeReturnUrl } from './auth-return-url';

describe('safeReturnUrl', () => {
  const origin = 'https://onestage.example';

  it.each([
    ['/my-events', '/my-events'],
    ['/checkin/7?mode=manual#scanner', '/checkin/7?mode=manual#scanner'],
    ['/events/42', '/events/42'],
  ])('accepts the same-origin route %s', (value, expected) => {
    expect(safeReturnUrl(value, origin)).toBe(expected);
  });

  it.each([
    null,
    '',
    'my-events',
    'https://evil.example',
    '//evil.example',
    '/\\evil.example',
    'javascript:alert(1)',
  ])('rejects an unsafe destination: %s', (value) => {
    expect(safeReturnUrl(value, origin)).toBeNull();
  });
});
