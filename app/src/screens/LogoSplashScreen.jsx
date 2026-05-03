import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  Animated,
  StyleSheet,
  Dimensions,
  StatusBar,
} from 'react-native';
import Svg, { Path, Circle } from 'react-native-svg';
import { isOnboarded } from '../profile/store';

const { width: SW } = Dimensions.get('screen');

// Icon occupies ~52 % of screen width — mirrors the SVG's proportions
const ICON_SIZE = Math.round(SW * 0.52);

// "e" glyph path extracted from JetBrains Mono ExtraBold, centred in a
// 108 × 108 coordinate space (matches the adaptive icon canvas).
const E_PATH =
  'M54.0720 79.9200Q48.8160 79.9200 44.8920 77.9400Q40.9680 75.9600 ' +
  '38.8440 72.3960Q36.7200 68.8320 36.7200 64.0800L36.7200 54.7200Q' +
  '36.7200 49.9680 38.8440 46.4040Q40.9680 42.8400 44.8920 40.8600Q' +
  '48.8160 38.8800 54.0720 38.8800Q59.3280 38.8800 63.1800 40.8600Q' +
  '67.0320 42.8400 69.1560 46.4040Q71.2800 49.9680 71.2800 54.7200L' +
  '71.2800 62.0640L47.0160 62.0640L47.0160 64.0800Q47.0160 67.8240 ' +
  '48.7800 69.5520Q50.5440 71.2800 54.0720 71.2800Q56.3760 71.2800 ' +
  '58.1040 70.5600Q59.8320 69.8400 60.1200 68.4000L70.7040 68.4000Q' +
  '69.5520 73.5840 65.0160 76.7520Q60.4800 79.9200 54.0720 79.9200M' +
  '47.0160 54.7200L47.0160 55.6560L60.9840 55.5120L60.9840 54.5760Q' +
  '60.9840 50.9040 59.2920 48.8880Q57.6000 46.8720 54.0720 46.8720Q' +
  '50.5440 46.8720 48.7800 48.9600Q47.0160 51.0480 47.0160 54.7200';

// Green accent dot position (same 108 × 108 coordinate space)
const DOT_CX = 82.3;
const DOT_CY = 29.5;
const DOT_R = 4.6;

// Timing constants (ms)
const FADE_IN_MS = 600;
const HOLD_MS = 1200;
const FADE_OUT_MS = 500;

export default function LogoSplashScreen({ navigation }) {
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.timing(opacity, {
        toValue: 1,
        duration: FADE_IN_MS,
        useNativeDriver: true,
      }),
      Animated.delay(HOLD_MS),
      Animated.timing(opacity, {
        toValue: 0,
        duration: FADE_OUT_MS,
        useNativeDriver: true,
      }),
    ]).start(() => {
      navigation.replace(isOnboarded() ? 'Main' : 'Splash');
    });
  }, [navigation, opacity]);

  return (
    <Animated.View style={[styles.root, { opacity }]}>
      <StatusBar barStyle="light-content" backgroundColor="#0a0a0a" />

      {/* ── Centre lockup ── */}
      <View style={styles.center}>
        <Svg
          viewBox="0 0 108 108"
          width={ICON_SIZE}
          height={ICON_SIZE}
        >
          <Path d={E_PATH} fill="#fafafa" />
          <Circle cx={DOT_CX} cy={DOT_CY} r={DOT_R} fill="#34d399" />
        </Svg>

        <Text style={styles.wordmark}>easyfill</Text>
      </View>

      {/* ── Bottom tagline ── */}
      <Text style={styles.tagline}>FORMS, FILLED.</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0a0a0a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: {
    alignItems: 'center',
    gap: 20,
  },
  wordmark: {
    color: '#fafafa',
    fontFamily: 'JetBrainsMono-Bold',
    fontSize: 22,
    letterSpacing: -1,
  },
  tagline: {
    position: 'absolute',
    bottom: 56,
    color: '#737373',
    fontFamily: 'JetBrainsMono-Regular',
    fontSize: 12,
    letterSpacing: 3,
  },
});
