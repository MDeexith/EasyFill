import React from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import Icon from './Icon';
import { theme } from '../theme/tokens';

export function Btn({ variant = 'primary', onPress, children, disabled, style, size = 'md', leftIcon, rightIcon, loading }) {
  const bg = variant === 'primary' ? theme.colors.ink
    : variant === 'ghost' ? 'transparent'
    : variant === 'accent' ? theme.colors.accent
    : variant === 'surface' ? theme.colors.surface2
    : theme.colors.ink;
  const fg = variant === 'primary' || variant === 'accent' ? '#fff'
    : variant === 'ghost' ? theme.colors.ink
    : theme.colors.ink;
  const border = variant === 'ghost' ? theme.colors.border
    : variant === 'surface' ? theme.colors.border
    : 'transparent';
  const h = size === 'sm' ? 36 : size === 'lg' ? 52 : 48;
  const fs = size === 'sm' ? 13 : 15;
  const radius = size === 'sm' ? 10 : 12;
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.85}
      style={[{
        height: h,
        paddingHorizontal: 18,
        borderRadius: radius,
        backgroundColor: bg,
        borderWidth: 1,
        borderColor: border,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: disabled ? 0.5 : 1,
      }, style]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <>
          {leftIcon && <View style={{ marginRight: 8 }}>{leftIcon}</View>}
          <Text style={{ color: fg, fontSize: fs, fontFamily: theme.font.sans, fontWeight: '600' }}>{children}</Text>
          {rightIcon && <View style={{ marginLeft: 8 }}>{rightIcon}</View>}
        </>
      )}
    </TouchableOpacity>
  );
}

export function IconBtn({ name, onPress, size = 18, color = theme.colors.ink, bg = 'transparent', style }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={[{
        width: 36,
        height: 36,
        borderRadius: 10,
        backgroundColor: bg,
        alignItems: 'center',
        justifyContent: 'center',
      }, style]}
    >
      <Icon name={name} size={size} color={color} />
    </TouchableOpacity>
  );
}

export function Card({ children, style, pad = 16 }) {
  return (
    <View style={[{
      backgroundColor: theme.colors.surface,
      borderColor: theme.colors.border,
      borderWidth: 1,
      borderRadius: 16,
      padding: pad,
    }, style]}>
      {children}
    </View>
  );
}

export function Chip({ children, tone = 'default', leftIcon, style }) {
  const bg = tone === 'accent' ? theme.colors.accentSoft : theme.colors.surface2;
  const fg = tone === 'accent' ? theme.colors.accentInk : theme.colors.ink2;
  const border = tone === 'accent' ? 'transparent' : theme.colors.border;
  return (
    <View style={[{
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      height: 26,
      paddingHorizontal: 10,
      borderRadius: 999,
      backgroundColor: bg,
      borderWidth: 1,
      borderColor: border,
    }, style]}>
      {leftIcon}
      <Text style={{ fontSize: 12, fontFamily: theme.font.sans, fontWeight: '500', color: fg }}>{children}</Text>
    </View>
  );
}

export function Eyebrow({ children, style }) {
  return (
    <Text style={[{
      fontSize: 10,
      fontFamily: theme.font.sans,
      fontWeight: '700',
      letterSpacing: 1.4,
      color: theme.colors.muted,
      textTransform: 'uppercase',
    }, style]}>{children}</Text>
  );
}

export function Divider({ style }) {
  return <View style={[{ height: 1, backgroundColor: theme.colors.border }, style]} />;
}

export function Avatar({ label, bg = theme.colors.ink, fg = '#fff', size = 40, border }) {
  return (
    <View style={{
      width: size,
      height: size,
      borderRadius: Math.round(size * 0.28),
      backgroundColor: bg,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: border ? 1 : 0,
      borderColor: theme.colors.border,
    }}>
      <Text style={{
        fontFamily: theme.font.monoExtraBold,
        color: fg,
        fontSize: Math.round(size * 0.42),
        letterSpacing: -1,
      }}>{label}</Text>
    </View>
  );
}

export const T = StyleSheet.create({
  h1: { fontSize: 28, fontFamily: theme.font.sans, fontWeight: '800', letterSpacing: -0.5, color: theme.colors.ink },
  h2: { fontSize: 24, fontFamily: theme.font.sans, fontWeight: '800', letterSpacing: -0.4, color: theme.colors.ink },
  h3: { fontSize: 18, fontFamily: theme.font.sans, fontWeight: '700', letterSpacing: -0.2, color: theme.colors.ink },
  body: { fontSize: 14, fontFamily: theme.font.sans, color: theme.colors.ink2, lineHeight: 21 },
  small: { fontSize: 12, fontFamily: theme.font.sans, color: theme.colors.muted },
  mono: { fontFamily: theme.font.mono, fontSize: 12, color: theme.colors.muted, letterSpacing: -0.4 },
  label: { fontSize: 11, fontFamily: theme.font.sans, fontWeight: '600', color: theme.colors.muted, letterSpacing: 0.3 },
});
