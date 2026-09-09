const awsCredentialOverrideVariables = [
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AWS_SECURITY_TOKEN',
  'AWS_WEB_IDENTITY_TOKEN_FILE',
  'AWS_ROLE_ARN',
  'AWS_ROLE_SESSION_NAME',
  'AWS_CONTAINER_CREDENTIALS_RELATIVE_URI',
  'AWS_CONTAINER_CREDENTIALS_FULL_URI',
  'AWS_CONTAINER_AUTHORIZATION_TOKEN',
  'AWS_BEARER_TOKEN_BEDROCK',
];

export function environmentForAwsProfile(
  profile: string,
  baseEnvironment: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const normalizedProfile = profile.trim() || baseEnvironment.AWS_PROFILE?.trim() || '';
  if (!normalizedProfile) {
    return baseEnvironment;
  }

  const environment: NodeJS.ProcessEnv = {
    ...baseEnvironment,
    AWS_PROFILE: normalizedProfile,
  };
  awsCredentialOverrideVariables.forEach((name) => {
    delete environment[name];
  });
  return environment;
}
