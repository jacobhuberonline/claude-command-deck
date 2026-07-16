import { parseAwsCallerIdentity } from '../src/main/auth/AuthParsers';

describe('phase 6 authentication parsing', () => {
  it('extracts only safe AWS identity metadata', () => {
    const result = parseAwsCallerIdentity(
      JSON.stringify({
        Account: '123456789012',
        Arn: 'arn:aws:sts::123456789012:assumed-role/example/user',
        UserId: 'AIDATEST',
        SecretAccessKey: 'must-not-appear',
      }),
    );

    expect(result).toEqual({
      accountId: '123456789012',
      arn: 'arn:aws:sts::123456789012:assumed-role/example/user',
      userId: 'AIDATEST',
    });
  });

  it('returns null for non-json output', () => {
    expect(parseAwsCallerIdentity('not json')).toBeNull();
  });
});
