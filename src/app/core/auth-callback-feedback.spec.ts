import { describeAuthCallbackError } from './auth-callback-feedback';

describe('describeAuthCallbackError', () => {
  it('describes a cancelled hosted sign-in without exposing Cognito details', () => {
    expect(describeAuthCallbackError('access_denied')).toBe('Sign-in was cancelled.');
  });

  it.each([null, '', 'invalid_request', 'server_error'])('maps %s to a safe message', (code) => {
    expect(describeAuthCallbackError(code)).toBe(
      'Sign-in could not be completed. Please try again.',
    );
  });
});
