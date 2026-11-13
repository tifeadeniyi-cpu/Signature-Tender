import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { CalendarClock, ChevronRight } from 'lucide-react-native';
import type { BoardCardDTO } from '@/lib/types';
import { colors, fonts } from '@/lib/theme';
import { Pill, T } from './ui';

/** One document in a list. Tapping opens its details. Mirrors the website's Kanban card. */
export function DocumentCard({ card }: { card: BoardCardDTO }) {
  const pct = card.requiredCount ? card.requiredDone / card.requiredCount : 0;
  const showStatus = card.column !== 'sent' && card.column !== 'in_progress';
  const label = [
    card.title,
    card.statusLabel,
    card.column === 'in_progress' && card.requiredCount
      ? `${card.requiredDone} of ${card.requiredCount} signed`
      : null,
    card.dateLabel,
    card.dueLabel,
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="Opens the document details"
      onPress={() => router.push({ pathname: '/document/[id]', params: { id: card.id } })}
      style={({ pressed }) => [s.card, pressed && { backgroundColor: '#FBF8F3' }]}
    >
      <View style={s.top}>
        <View style={s.pdf} importantForAccessibility="no-hide-descendants">
          <T style={s.pdfText}>PDF</T>
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <T variant="heading" numberOfLines={2}>
            {card.title}
          </T>
          <T variant="small" numberOfLines={1}>
            {card.typeLabel} · {card.reference}
          </T>
        </View>
        <ChevronRight size={20} color={colors.text} />
      </View>
      <View style={s.row}>
        {showStatus ? <Pill label={card.statusLabel} tone={card.statusTone} /> : null}
        {card.isTest ? <Pill label="Test" tone="warning" /> : null}
        {card.column === 'in_progress' && card.requiredCount ? (
          <Pill label={`${card.requiredDone} of ${card.requiredCount} signed`} tone="info" />
        ) : null}
        <T variant="small">{card.dateLabel}</T>
      </View>
      {card.column === 'in_progress' && card.requiredCount ? (
        <View style={s.track}>
          <View style={[s.bar, { width: `${Math.round(pct * 100)}%` }]} />
        </View>
      ) : null}
      <View style={s.bottom}>
        <View style={s.avatars}>
          {card.people.slice(0, 4).map((p, i) => (
            <View
              key={i}
              style={[
                s.avatar,
                { marginLeft: i ? -8 : 0 },
                p.state === 'Signed' || p.state === 'Approved'
                  ? { backgroundColor: '#D6EFDD' }
                  : p.state === 'Declined'
                    ? { backgroundColor: '#FBDCDC' }
                    : null,
              ]}
            >
              <T style={s.initials}>{p.initials}</T>
            </View>
          ))}
          {card.people.length === 0 ? <T variant="small">No recipients yet</T> : null}
          {card.people.length > 4 ? <T variant="small">  +{card.people.length - 4}</T> : null}
        </View>
        {card.dueLabel ? (
          <View style={s.due}>
            <CalendarClock size={14} color={card.dueSoon ? colors.warning : colors.text} />
            <T variant="small" style={card.dueSoon ? { color: colors.warning, fontFamily: fonts.semibold } : null}>
              {card.dueLabel}
            </T>
          </View>
        ) : (
          <T variant="small">{card.ownerLabel}</T>
        )}
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: colors.white,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    gap: 10,
  },
  top: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  pdf: {
    width: 26,
    height: 32,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#F1C9C9',
    backgroundColor: '#FDF1F1',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: 3,
  },
  pdfText: { fontFamily: fonts.bold, fontSize: 8, color: '#C42B2B', lineHeight: 10 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  track: { height: 6, borderRadius: 3, backgroundColor: '#E7E5FB', overflow: 'hidden' },
  bar: { height: 6, borderRadius: 3, backgroundColor: '#5B4FD6' },
  bottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  avatars: { flexDirection: 'row', alignItems: 'center' },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: colors.white,
    backgroundColor: '#DFE5EF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: { fontFamily: fonts.bold, fontSize: 10, color: colors.navy, lineHeight: 12 },
  due: { flexDirection: 'row', alignItems: 'center', gap: 4 },
});
