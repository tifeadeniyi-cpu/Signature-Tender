import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CheckCircle2, Clock, Pencil, Plus, Send, XCircle, type LucideIcon } from 'lucide-react-native';
import { API_URL } from '@/lib/config';
import { firstName, greeting } from '@/lib/format';
import { useMe } from '@/lib/session';
import { colors, columnStyle, fonts } from '@/lib/theme';
import type { BoardColumnId } from '@/lib/types';
import { useBoard } from '@/lib/use-board';
import { DocumentCard } from '@/components/document-card';
import { Button, Empty, Loading, Notice, T } from '@/components/ui';

const METRICS: [BoardColumnId, LucideIcon][] = [
  ['drafts', Pencil],
  ['sent', Send],
  ['in_progress', Clock],
  ['completed', CheckCircle2],
  ['declined_expired', XCircle],
];

export default function Home() {
  const me = useMe();
  const board = useBoard(null, {}, 5);
  const counts = board.data?.counts;
  const waiting = (board.data?.cards ?? []).filter((c) => c.column === 'sent' || c.column === 'in_progress');
  const recent = (board.data?.cards ?? [])
    .slice()
    .sort((a, b) => b.dateIso.localeCompare(a.dateIso))
    .slice(0, 5);
  return (
    <SafeAreaView edges={['top']} style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={s.page}
        refreshControl={
          <RefreshControl refreshing={board.refreshing} onRefresh={() => void board.refresh()} tintColor={colors.navy} />
        }
      >
        <View style={{ gap: 4 }}>
          <T variant="small">{me.workspace?.name}</T>
          <T variant="display">
            {greeting(new Date().getHours())}, {firstName(me.user.name)}
          </T>
        </View>

        {me.can.create ? (
          <Button
            title="Send a document"
            variant="gold"
            icon={<Plus size={18} color={colors.navy} />}
            onPress={() => void WebBrowser.openBrowserAsync(`${API_URL}/app/documents/new`)}
            accessibilityHint="Opens document preparation in the browser"
          />
        ) : null}

        {board.error ? <Notice tone="error">{board.error}</Notice> : null}
        {board.loading && !counts ? (
          <Loading />
        ) : counts ? (
          <>
            <View style={s.metrics} accessibilityRole="summary">
              {METRICS.map(([col, Icon]) => (
                <Pressable
                  key={col}
                  accessibilityRole="button"
                  accessibilityLabel={`${columnStyle[col].label}: ${counts[col]}`}
                  onPress={() => router.push({ pathname: '/documents', params: { status: col } })}
                  style={({ pressed }) => [s.metric, pressed && { opacity: 0.8 }]}
                >
                  <View style={[s.metricIcon, { backgroundColor: columnStyle[col].head }]}>
                    <Icon size={18} color={columnStyle[col].icon} />
                  </View>
                  <T variant="small" style={{ fontFamily: fonts.semibold, color: colors.heading }} numberOfLines={2}>
                    {columnStyle[col].label}
                  </T>
                  <T style={s.metricValue}>{counts[col]}</T>
                </Pressable>
              ))}
            </View>

            <View style={{ gap: 10 }}>
              <T variant="heading">Waiting on signers</T>
              {waiting.length ? (
                waiting.map((c) => <DocumentCard key={c.id} card={c} />)
              ) : (
                <Empty title="Nothing waiting">Requests you send appear here until everyone has signed.</Empty>
              )}
            </View>
            <View style={{ gap: 10 }}>
              <T variant="heading">Recent activity</T>
              {recent.length ? (
                recent.map((c) => <DocumentCard key={c.id} card={c} />)
              ) : (
                <Empty title="No documents yet">Send your first document to get started.</Empty>
              )}
            </View>
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  page: { padding: 20, gap: 20, paddingBottom: 40 },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  metric: {
    flexBasis: '47%',
    flexGrow: 1,
    backgroundColor: colors.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    gap: 6,
  },
  metricIcon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  metricValue: { fontFamily: fonts.display, fontSize: 28, lineHeight: 32, color: colors.heading },
});
