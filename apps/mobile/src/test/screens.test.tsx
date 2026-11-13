import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { board, card, summary } from './fixtures';
import { DocumentCard } from '@/components/document-card';
import { SignLinkForm } from '@/components/sign-link';
import Documents from '@/app/(app)/(tabs)/documents';
import Screen from '@/app/(app)/document/[id]';

const mockPush = jest.fn();
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  router: { push: (...a: unknown[]) => mockPush(...a), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => mockParams,
  Stack: { Screen: () => null },
  Link: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { SafeAreaView: View, SafeAreaProvider: View };
});
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn() }));
jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));

const mockApi = jest.fn();
jest.mock('@/lib/api', () => ({
  api: (...a: unknown[]) => mockApi(...a),
  qs: jest.requireActual('@/lib/api').qs,
  authHeaders: async () => ({}),
}));
jest.mock('@/lib/auth', () => ({ authClient: {} }));
const mockShare = jest.fn();
jest.mock('@/lib/files', () => ({ downloadAndShare: (...a: unknown[]) => mockShare(...a) }));

beforeEach(() => {
  jest.useFakeTimers();
  mockApi.mockReset();
  mockPush.mockReset();
  mockShare.mockReset();
  mockParams = {};
});
afterEach(() => jest.useRealTimers());

describe('DocumentCard', () => {
  it('shows signing progress and opens the document', async () => {
    await render(<DocumentCard card={card()} />);
    expect(screen.getByText('Consulting Proposal')).toBeTruthy();
    expect(screen.getByText('1 of 2 signed')).toBeTruthy();
    expect(screen.getByText('Due Nov 20, 2026')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: /Consulting Proposal, In progress, 1 of 2 signed/ }));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/document/[id]', params: { id: card().id } });
  });
});

describe('Documents tab', () => {
  it('loads one status at a time from the board API and switches status', async () => {
    mockParams = { status: 'in_progress' };
    mockApi.mockResolvedValue(board([card()]));
    await render(<Documents />);
    await act(async () => {
      jest.runOnlyPendingTimers();
    });
    expect(await screen.findByText('Consulting Proposal')).toBeTruthy();
    expect(mockApi.mock.calls[0][0]).toContain('column=in_progress');

    mockApi.mockResolvedValue(board([], { counts: { drafts: 0, sent: 0, in_progress: 1, completed: 0, declined_expired: 0, cancelled: 0 } }));
    await fireEvent.press(screen.getByRole('tab', { name: /^Completed/ }));
    await act(async () => {
      jest.runOnlyPendingTimers();
    });
    expect(await screen.findByText('No completed agreements yet.')).toBeTruthy();
    expect(mockApi.mock.calls.at(-1)[0]).toContain('column=completed');
  });
});

describe('Document screen', () => {
  it('offers only the actions the server allows, reminds and cancels with a reason', async () => {
    mockParams = { id: summary().id };
    mockApi.mockImplementation(async (path: string) => {
      if (path.endsWith('/summary')) return summary();
      if (path.endsWith('/remind')) return { message: 'Reminder sent to Jo Dale.' };
      if (path.endsWith('/cancel')) return { message: 'Request cancelled. The signing links no longer work.' };
      throw new Error(path);
    });
    jest.spyOn(Alert, 'alert').mockImplementation((...args: Parameters<typeof Alert.alert>) => {
      const buttons = args[2] as { onPress?: () => void }[] | undefined;
      buttons?.[1]?.onPress?.();
    });
    await render(<Screen />);
    await act(async () => {
      jest.runOnlyPendingTimers();
    });
    expect(await screen.findByText('1 of 2 signed')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Download complete package' })).toBeNull();

    await fireEvent.press(screen.getByRole('button', { name: 'Send reminder' }));
    expect(await screen.findByText('Reminder sent to Jo Dale.')).toBeTruthy();
    expect(mockApi).toHaveBeenCalledWith('/api/mobile/requests/22222222-2222-4222-8222-222222222222/remind', { method: 'POST', body: {} });

    await fireEvent.press(screen.getByRole('button', { name: 'Cancel request' }));
    await fireEvent.changeText(screen.getByLabelText('Reason (optional)'), ' Wrong version ');
    const buttons = screen.getAllByRole('button', { name: 'Cancel request' });
    await fireEvent.press(buttons[buttons.length - 1]);
    await waitFor(() =>
      expect(mockApi).toHaveBeenCalledWith('/api/mobile/requests/22222222-2222-4222-8222-222222222222/cancel', {
        method: 'POST',
        body: { reason: 'Wrong version' },
      }),
    );
  });

  it('downloads and shares the complete package of a completed agreement', async () => {
    mockParams = { id: summary().id };
    const done = summary({
      status: 'completed',
      statusLabel: 'Completed',
      actionableDone: 2,
      actions: ['download_signed', 'view_document', 'view_certificate'],
      urls: { ...summary().urls, packageDownload: '/api/requests/r/file?kind=package', signedDownload: '/api/requests/r/file?kind=signed' },
    });
    mockApi.mockResolvedValue(done);
    await render(<Screen />);
    await act(async () => {
      jest.runOnlyPendingTimers();
    });
    expect(await screen.findByText('2 of 2 signed')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Send reminder' })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Download complete package' }));
    await waitFor(() => expect(mockShare).toHaveBeenCalledWith('/api/requests/r/file?kind=package', 'Consulting Proposal', ''));
  });
});

describe('Sign link form', () => {
  it('only opens Signature Tender signing links', async () => {
    await render(<SignLinkForm />);
    await fireEvent.changeText(screen.getByLabelText('Signing link'), 'https://evil.example/sign/abcdefghijklmnopqrstuvwxyz');
    await fireEvent.press(screen.getByRole('button', { name: 'Open document' }));
    expect(screen.getByText(/Paste the signing link from your email/)).toBeTruthy();
    expect(mockPush).not.toHaveBeenCalled();
    const token = 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG';
    await fireEvent.changeText(screen.getByLabelText('Signing link'), `https://signaturetender.com/sign/${token}`);
    await fireEvent.press(screen.getByRole('button', { name: 'Open document' }));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/sign/[token]', params: { token } });
  });
});
