import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Search, SlidersHorizontal } from 'lucide-react-native';
import { colors, columnStyle, fonts } from '@/lib/theme';
import type { BoardColumnId } from '@/lib/types';
import { useBoard } from '@/lib/use-board';
import { DocumentCard } from '@/components/document-card';
import { Empty, Loading, Notice, T } from '@/components/ui';

const COLUMNS = Object.keys(columnStyle) as BoardColumnId[];
const SORTS: [string, string][] = [
  ['activity:desc', 'Recently updated'],
  ['activity:asc', 'Oldest updated'],
  ['sent:desc', 'Date sent'],
  ['completed:desc', 'Date completed'],
  ['title:asc', 'Name'],
  ['expires:asc', 'Due date'],
];
const RANGES: [string, string][] = [
  ['any', 'Any time'],
  ['7d', 'Last 7 days'],
  ['30d', 'Last 30 days'],
  ['90d', 'Last 90 days'],
  ['year', 'This year'],
];
const EMPTY: Record<BoardColumnId, string> = {
  drafts: 'No drafts yet.',
  sent: 'No documents sent yet.',
  in_progress: 'No documents currently in progress.',
  completed: 'No completed agreements yet.',
  declined_expired: 'No declined or expired documents.',
  cancelled: 'No cancelled requests.',
};

/**
 * Documents by status: on a phone the website's Kanban board becomes one status at a time, chosen
 * with the chips at the top. Status always comes from the signing workflow.
 */
export default function Documents() {
  const params = useLocalSearchParams<{ status?: string }>();
  const asked = params.status && (COLUMNS as string[]).includes(params.status) ? (params.status as BoardColumnId) : null;
  const [column, setColumn] = useState<BoardColumnId>(asked ?? 'in_progress');
  // A status card on Home opens this tab on that status.
  const [seenAsked, setSeenAsked] = useState(asked);
  if (asked !== seenAsked) {
    setSeenAsked(asked);
    if (asked) setColumn(asked);
  }
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('activity:desc');
  const [range, setRange] = useState('any');
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 350);
    return () => clearTimeout(t);
  }, [text]);

  const [s1, d1] = sort.split(':');
  const board = useBoard(column, { q, sort: s1, dir: d1, range });
  const counts = board.data?.counts;

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1 }}>
      <View style={s.header}>
        <T variant="display">Documents</T>
        <View style={s.searchRow}>
          <View style={s.search}>
            <Search size={18} color={colors.text} />
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder="Search documents, recipients, or reference"
              placeholderTextColor="#94A3B8"
              accessibilityLabel="Search documents, recipients, or reference"
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              style={s.searchInput}
            />
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Sort and date filters"
            accessibilityState={{ expanded: showFilters }}
            onPress={() => setShowFilters((v) => !v)}
            style={[s.filterBtn, showFilters && { backgroundColor: colors.softGold }]}
          >
            <SlidersHorizontal size={20} color={colors.navy} />
          </Pressable>
        </View>
        {showFilters ? (
          <View style={{ gap: 8 }}>
            <Chips label="Sort" items={SORTS} value={sort} onChange={setSort} />
            <Chips label="Updated" items={RANGES} value={range} onChange={setRange} />
          </View>
        ) : null}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} accessibilityRole="tablist">
          {COLUMNS.map((c) => {
            const on = c === column;
            return (
              <Pressable
                key={c}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`${columnStyle[c].label}${counts ? `, ${counts[c]}` : ''}`}
                onPress={() => setColumn(c)}
                style={[s.tab, on ? { backgroundColor: columnStyle[c].head, borderColor: columnStyle[c].icon } : null]}
              >
                <T variant="label">{columnStyle[c].label}</T>
                {counts ? <T variant="small" style={{ fontFamily: fonts.bold }}>{counts[c]}</T> : null}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
      {board.error && !board.cards.length ? (
        <View style={{ padding: 20 }}>
          <Notice tone="error">{board.error}</Notice>
        </View>
      ) : board.loading ? (
        <Loading />
      ) : (
        <FlatList
          data={board.cards}
          keyExtractor={(c) => c.id}
          renderItem={({ item }) => <DocumentCard card={item} />}
          contentContainerStyle={{ padding: 20, gap: 12, paddingBottom: 40 }}
          onEndReachedThreshold={0.4}
          onEndReached={() => void board.loadMore()}
          refreshControl={
            <RefreshControl refreshing={board.refreshing} onRefresh={() => void board.refresh()} tintColor={colors.navy} />
          }
          ListEmptyComponent={
            <Empty title={q ? 'No documents match' : EMPTY[column]}>
              {q ? 'Try a different search.' : 'Documents move here on their own as recipients view, sign or decline.'}
            </Empty>
          }
          ListFooterComponent={board.loadingMore ? <ActivityIndicator color={colors.navy} /> : undefined}
        />
      )}
    </SafeAreaView>
  );
}

function Chips({
  label,
  items,
  value,
  onChange,
}: {
  label: string;
  items: [string, string][];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <View style={{ gap: 6 }}>
      <T variant="small">{label}</T>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
        {items.map(([v, l]) => (
          <Pressable
            key={v}
            accessibilityRole="radio"
            accessibilityState={{ checked: v === value }}
            onPress={() => onChange(v)}
            style={[s.chip, v === value && { backgroundColor: colors.navy, borderColor: colors.navy }]}
          >
            <T variant="small" style={[{ fontFamily: fonts.semibold, color: colors.heading }, v === value && { color: colors.white }]}>
              {l}
            </T>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  header: { paddingHorizontal: 20, paddingTop: 12, gap: 12 },
  searchRow: { flexDirection: 'row', gap: 8 },
  search: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    minHeight: 46,
  },
  searchInput: { flex: 1, fontFamily: fonts.regular, fontSize: 15, color: colors.heading },
  filterBtn: {
    width: 46,
    height: 46,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    paddingHorizontal: 14,
    minHeight: 40,
  },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
});
