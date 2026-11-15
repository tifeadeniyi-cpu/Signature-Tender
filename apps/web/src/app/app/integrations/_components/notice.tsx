import { getConnector } from '@st/core';
import { Alert } from '@/components/ui/feedback';

const ERRORS: Record<string, string> = {
  cancelled: 'You cancelled the connection. Nothing was connected.',
  state: 'That sign-in link expired or did not match. Please try connecting again.',
  provider: 'The app did not complete the connection. Please try again.',
  forbidden: 'Your role does not allow connecting this app. Ask a workspace owner or admin.',
  unavailable: 'This app cannot be connected right now.',
  secrets_missing:
    'Integrations are not set up on this server yet (the encryption key is missing). Ask the account owner to finish setup.',
};

/** Result of an OAuth round trip, read from the address the app returned to. */
export function ConnectNotice({
  connected,
  error,
  provider,
}: {
  connected?: string;
  error?: string;
  provider?: string;
}) {
  const name = getConnector(connected ?? provider ?? '')?.name ?? 'The app';
  if (connected)
    return (
      <Alert tone="success" className="mb-6">
        {name} is connected.
      </Alert>
    );
  if (error && ERRORS[error])
    return (
      <Alert tone={error === 'cancelled' ? 'info' : 'error'} className="mb-6">
        {ERRORS[error]}
      </Alert>
    );
  return null;
}
