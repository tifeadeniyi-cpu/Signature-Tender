import { useCallback, useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { Bell, Download, ExternalLink, FileCheck2, ShieldCheck, XCircle } from 'lucide-react-native';
import { api } from '@/lib/api';
import { API_URL } from '@/lib/config';
import { downloadAndShare } from '@/lib/files';
import { formatDay, formatDayTime, plural } from '@/lib/format';
import { colors } from '@/lib/theme';
import type { DocumentSummary } from '@/lib/types';
import { Button, Card, Field, Loading, Notice, Pill, T } from '@/components/ui';

type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'error';
const STATUS_TONE: Record<DocumentSummary['status'], Tone> = {
  completed: 'success',
  in_progress: 'info',
  pending: 'info',
  draft: 'neutral',
  declined: 'error',
  expired: 'warning',
  cancelled: 'warning',
  needs_attention: 'error',
};
const SIGNER_TONE: Record<string, Tone> = {
  signed: 'success',
  approved: 'success',
  reviewed: 'success',
  declined: 'error',
  viewed: 'info',
  pending: 'info',
  expired: 'warning',
  cancelled: 'warning',
};

/** One document: status, signers, files and activity, with the actions the server allows. */
export default function DocumentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [doc, setDoc] = useState<DocumentSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');

  const load = useCallback(async () => {
    try {
      setDoc(await api<DocumentSummary>(`/api/documents/${id}/summary`));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [id]);
  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  const has = (a: DocumentSummary['actions'][number]) => Boolean(doc?.actions.includes(a));

  const remind = async () => {
    if (!doc?.requestId) return;
    setBusy('remind');
    try {
      const r = await api<{ message: string }>(`/api/mobile/requests/${doc.requestId}/remind`, { method: 'POST', body: {} });
      setNotice({ tone: 'success', text: r.message });
      await load();
    } catch (err) {
      setNotice({ tone: 'error', text: (err as Error).message });
    } finally {
      setBusy(null);
    }
  };
  const cancel = async () => {
    if (!doc?.requestId) return;
    setBusy('cancel');
    try {
      const r = await api<{ message: string }>(`/api/mobile/requests/${doc.requestId}/cancel`, {
        method: 'POST',
        body: { reason: reason.trim() },
      });
      setCancelOpen(false);
      setReason('');
      setNotice({ tone: 'success', text: r.message });
      await load();
    } catch (err) {
      setNotice({ tone: 'error', text: (err as Error).message });
    } finally {
      setBusy(null);
    }
  };
  const download = async (key: string, path: string | null, suffix: string) => {
    if (!path || !doc) return;
    setBusy(key);
    try {
      await downloadAndShare(path, doc.title, suffix);
    } catch {
      setNotice({ tone: 'error', text: 'We could not download that file. Check your connection and try again.' });
    } finally {
      setBusy(null);
    }
  };

  if (error && !doc)
    return (
      <View style={{ padding: 20, gap: 12 }}>
        <Notice tone="error">{error}</Notice>
        <Button title="Try again" onPress={() => void load()} />
      </View>
    );
  if (!doc) return <Loading />;

  const pct = doc.actionableCount ? doc.actionableDone / doc.actionableCount : 0;
  return (
    <>
      <Stack.Screen options={{ title: doc.reference }} />
      <ScrollView
        contentContainerStyle={s.page}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={colors.navy}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
          />
        }
      >
        <View style={{ gap: 8 }}>
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
            <Pill label={doc.statusLabel} tone={STATUS_TONE[doc.status]} />
            {doc.isTest ? <Pill label="Test" tone="warning" /> : null}
            {doc.archived ? <Pill label="Archived" /> : null}
          </View>
          <T variant="title">{doc.title}</T>
          <T variant="small">
            {doc.typeLabel} · Sent by {doc.createdByYou ? 'you' : (doc.createdBy ?? 'a teammate')}
            {doc.sentAt ? ` · ${formatDay(doc.sentAt)}` : ''}
          </T>
        </View>

        {notice ? <Notice tone={notice.tone}>{notice.text}</Notice> : null}

        {doc.actionableCount ? (
          <Card style={{ gap: 10 }}>
            <View style={s.between}>
              <T variant="heading">Signing progress</T>
              <T variant="label">
                {doc.actionableDone} of {doc.actionableCount} signed
              </T>
            </View>
            <View
              accessibilityRole="progressbar"
              accessibilityLabel="Required signers completed"
              accessibilityValue={{ min: 0, max: doc.actionableCount, now: doc.actionableDone }}
              style={s.track}
            >
              <View style={[s.bar, { width: `${Math.round(pct * 100)}%` }]} />
            </View>
            {doc.expiresAt && (doc.status === 'in_progress' || doc.status === 'pending') ? (
              <T variant="small">Signing closes {formatDay(doc.expiresAt)}</T>
            ) : null}
            {doc.completedAt ? <T variant="small">Completed {formatDayTime(doc.completedAt)}</T> : null}
          </Card>
        ) : null}

        <View style={{ gap: 10 }}>
          {has('send_reminder') ? (
            <Button
              title="Send reminder"
              icon={<Bell size={18} color={colors.white} />}
              loading={busy === 'remind'}
              onPress={() =>
                Alert.alert('Send a reminder?', 'Everyone whose turn it is gets a new email with their link.', [
                  { text: 'Not now', style: 'cancel' },
                  { text: 'Send reminder', onPress: () => void remind() },
                ])
              }
            />
          ) : null}
          {doc.urls.packageDownload ? (
            <Button
              title="Download complete package"
              variant="gold"
              icon={<Download size={18} color={colors.navy} />}
              loading={busy === 'package'}
              onPress={() => void download('package', doc.urls.packageDownload, '')}
            />
          ) : null}
          {doc.urls.signedDownload ? (
            <Button
              title="Signed agreement only"
              variant="secondary"
              icon={<FileCheck2 size={18} color={colors.navy} />}
              loading={busy === 'signed'}
              onPress={() => void download('signed', doc.urls.signedDownload, ' - signed')}
            />
          ) : null}
          {doc.evidence.certificateDownloadUrl ? (
            <Button
              title="Certificate of Completion"
              variant="secondary"
              icon={<ShieldCheck size={18} color={colors.navy} />}
              loading={busy === 'certificate'}
              onPress={() => void download('certificate', doc.evidence.certificateDownloadUrl, ' - certificate')}
            />
          ) : null}
          {has('cancel_request') ? (
            <Button
              title="Cancel request"
              variant="danger"
              icon={<XCircle size={18} color={colors.error} />}
              onPress={() => setCancelOpen(true)}
            />
          ) : null}
        </View>

        {doc.evidence.certificateNumber ? (
          <Card style={{ gap: 4 }}>
            <T variant="heading">Certificate</T>
            <T variant="small">ID {doc.evidence.certificateNumber}</T>
            {doc.evidence.verificationRef ? (
              <T variant="small">Verification reference {doc.evidence.verificationRef}</T>
            ) : null}
          </Card>
        ) : null}

        <View style={{ gap: 10 }}>
          <T variant="heading">
            Recipients ({doc.recipientCount}){doc.signingOrder ? ' · in order' : ''}
          </T>
          {doc.signers.length ? (
            doc.signers.map((p) => (
              <Card key={p.id} style={s.signer}>
                <View style={{ flex: 1, gap: 2 }}>
                  <T variant="heading" numberOfLines={1}>
                    {doc.signingOrder ? `${p.order}. ` : ''}
                    {p.name}
                  </T>
                  <T variant="small" numberOfLines={1}>
                    {p.email}
                  </T>
                  <T variant="small">
                    {p.roleLabel}
                    {p.doneAt ? ` · ${formatDay(p.doneAt)}` : p.viewedAt ? ` · viewed ${formatDay(p.viewedAt)}` : ''}
                    {p.reminders ? ` · ${plural(p.reminders, 'reminder')}` : ''}
                  </T>
                  {p.declineReason ? <T variant="small">Reason: {p.declineReason}</T> : null}
                </View>
                <Pill label={p.statusLabel} tone={SIGNER_TONE[p.status] ?? 'neutral'} />
              </Card>
            ))
          ) : (
            <T variant="small">No recipients added yet.</T>
          )}
        </View>

        <View style={{ gap: 10 }}>
          <T variant="heading">Activity</T>
          <Card style={{ gap: 14 }}>
            {doc.activity.length ? (
              doc.activity.slice(0, 30).map((a) => (
                <View key={a.id} style={{ gap: 2 }}>
                  <T variant="label">{a.title}</T>
                  {a.description ? <T variant="small">{a.description}</T> : null}
                  <T variant="small" style={{ color: '#64748B' }}>
                    {formatDayTime(a.at)} · {a.actor}
                  </T>
                </View>
              ))
            ) : (
              <T variant="small">No activity yet.</T>
            )}
          </Card>
        </View>

        <Button
          title="Open on the website"
          variant="ghost"
          icon={<ExternalLink size={18} color={colors.navy} />}
          onPress={() => void WebBrowser.openBrowserAsync(`${API_URL}${doc.urls.page}`)}
        />
      </ScrollView>

      <Modal visible={cancelOpen} transparent animationType="slide" onRequestClose={() => setCancelOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.sheetWrap}>
          <View style={s.sheet} accessibilityViewIsModal>
            <T variant="title">Cancel this request?</T>
            <T>Signing links stop working straight away. This cannot be undone.</T>
            <Field
              label="Reason (optional)"
              value={reason}
              onChangeText={setReason}
              placeholder="For example: sent the wrong version"
              maxLength={300}
            />
            <Button title="Cancel request" variant="danger" loading={busy === 'cancel'} onPress={() => void cancel()} />
            <Button title="Keep it open" variant="ghost" onPress={() => setCancelOpen(false)} />
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

const s = StyleSheet.create({
  page: { padding: 20, gap: 18, paddingBottom: 48 },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  track: { height: 8, borderRadius: 4, backgroundColor: '#E7E5FB', overflow: 'hidden' },
  bar: { height: 8, borderRadius: 4, backgroundColor: '#5B4FD6' },
  signer: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14 },
  sheetWrap: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(13,27,51,0.4)' },
  sheet: {
    backgroundColor: colors.ivory,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 40,
    gap: 14,
  },
});

