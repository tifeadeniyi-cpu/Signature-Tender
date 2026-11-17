import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type PressableProps,
  type StyleProp,
  type TextInputProps,
  type TextProps,
  type ViewStyle,
} from 'react-native';
import { colors, fonts, toneStyle } from '@/lib/theme';

type Variant = 'display' | 'title' | 'heading' | 'body' | 'small' | 'label' | 'mono';

const textStyles = StyleSheet.create({
  display: { fontFamily: fonts.display, fontSize: 32, lineHeight: 38, color: colors.heading },
  title: { fontFamily: fonts.display, fontSize: 24, lineHeight: 30, color: colors.heading },
  heading: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 22, color: colors.heading },
  body: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 22, color: colors.text },
  small: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, color: colors.text },
  label: { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 18, color: colors.heading },
  mono: { fontFamily: 'Courier', fontSize: 12, lineHeight: 16, color: colors.text },
});

export function T({ variant = 'body', style, ...rest }: TextProps & { variant?: Variant }) {
  return <Text {...rest} maxFontSizeMultiplier={1.6} style={[textStyles[variant], style]} />;
}

type ButtonVariant = 'primary' | 'gold' | 'secondary' | 'ghost' | 'danger';
const buttonColors: Record<ButtonVariant, { bg: string; fg: string; border?: string }> = {
  primary: { bg: colors.navy, fg: colors.white },
  gold: { bg: colors.gold, fg: colors.navy },
  secondary: { bg: colors.white, fg: colors.navy, border: colors.border },
  ghost: { bg: 'transparent', fg: colors.navy },
  danger: { bg: colors.white, fg: colors.error, border: '#F1C9C9' },
};

export function Button({
  title,
  icon,
  variant = 'primary',
  loading,
  disabled,
  style,
  ...rest
}: Omit<PressableProps, 'style' | 'children'> & {
  title: string;
  icon?: ReactNode;
  variant?: ButtonVariant;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const c = buttonColors[variant];
  const off = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(off), busy: Boolean(loading) }}
      disabled={off}
      {...rest}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: c.bg, borderColor: c.border ?? c.bg, opacity: off ? 0.55 : pressed ? 0.85 : 1 },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={c.fg} /> : icon}
      <Text maxFontSizeMultiplier={1.4} style={[styles.buttonText, { color: c.fg }]}>
        {title}
      </Text>
    </Pressable>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Pill({
  label,
  tone = 'neutral',
  icon,
}: {
  label: string;
  tone?: keyof typeof toneStyle;
  icon?: ReactNode;
}) {
  const t = toneStyle[tone];
  return (
    <View style={[styles.pill, { backgroundColor: t.bg }]}>
      {icon}
      <Text maxFontSizeMultiplier={1.4} style={[styles.pillText, { color: t.fg }]}>
        {label}
      </Text>
    </View>
  );
}

export function Field({ label, error, ...rest }: TextInputProps & { label: string; error?: string }) {
  return (
    <View style={{ gap: 6 }}>
      <T variant="label">{label}</T>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor="#94A3B8"
        {...rest}
        style={[styles.input, error ? { borderColor: colors.error } : null]}
      />
      {error ? (
        <T variant="small" style={{ color: colors.error }}>
          {error}
        </T>
      ) : null}
    </View>
  );
}

export function Notice({ tone, children }: { tone: 'error' | 'success' | 'info'; children: ReactNode }) {
  const t = toneStyle[tone];
  return (
    <View
      accessibilityRole={tone === 'error' ? 'alert' : 'text'}
      accessibilityLiveRegion="polite"
      style={[styles.notice, { backgroundColor: t.bg }]}
    >
      <T variant="small" style={{ color: t.fg, fontFamily: fonts.medium }}>
        {children}
      </T>
    </View>
  );
}

export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <View style={styles.center} accessibilityLabel={label}>
      <ActivityIndicator color={colors.navy} size="large" />
    </View>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <View style={styles.empty}>
      <T variant="heading" style={{ textAlign: 'center' }}>
        {title}
      </T>
      {children ? <T style={{ textAlign: 'center' }}>{children}</T> : null}
      {action}
    </View>
  );
}

export const styles = StyleSheet.create({
  button: {
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  buttonText: { fontFamily: fonts.semibold, fontSize: 15 },
  card: {
    backgroundColor: colors.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    shadowColor: colors.navy,
    shadowOpacity: 0.05,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  pillText: { fontFamily: fonts.semibold, fontSize: 12 },
  input: {
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    paddingHorizontal: 14,
    fontFamily: fonts.regular,
    fontSize: 16,
    color: colors.heading,
  },
  notice: { borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  empty: {
    alignItems: 'center',
    gap: 8,
    padding: 24,
    borderRadius: 16,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
    backgroundColor: 'rgba(255,255,255,0.6)',
  },
});
