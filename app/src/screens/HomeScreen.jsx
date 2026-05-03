import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  FlatList,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Card, Eyebrow, T } from '../components/ui';
import Icon from '../components/Icon';
import { theme } from '../theme/tokens';
import { loadProfile, loadFeedJobs, saveFeedJobs } from '../profile/store';
import { fetchJobFeed } from '../api/jobsApi';

function getInitials(profile) {
  const first = (profile.firstName || profile.name || '').trim();
  const last = (profile.lastName || '').trim();
  if (first && last) return (first[0] + last[0]).toUpperCase();
  if (first) return first.slice(0, 2).toUpperCase();
  return 'EF';
}

function relativeTime(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

const SOURCE_COLORS = {
  greenhouse:    { bg: '#ecfdf5', fg: '#065f46', label: 'Greenhouse' },
  lever:         { bg: '#eff6ff', fg: '#1e40af', label: 'Lever' },
  remotive:      { bg: '#f0fdf4', fg: '#166534', label: 'Remotive' },
  arbeitnow:     { bg: '#fef3c7', fg: '#92400e', label: 'Arbeitnow' },
  linkedin:      { bg: '#eff6ff', fg: '#1e40af', label: 'LinkedIn' },
  indeed:        { bg: '#fef3c7', fg: '#92400e', label: 'Indeed' },
  zip_recruiter: { bg: '#f0fdf4', fg: '#166534', label: 'ZipRecruiter' },
  google:        { bg: '#fdf4ff', fg: '#7e22ce', label: 'Google Jobs' },
};

const ROLE_ICONS = {
  Engineering: 'zap',
  Design: 'edit',
  Product: 'briefcase',
  Marketing: 'trending-up',
  Sales: 'phone',
  Data: 'search',
  Operations: 'settings',
  Support: 'mail',
  Other: 'briefcase',
};

function LatestJobCard({ job, onPress }) {
  const source = SOURCE_COLORS[job.source] || SOURCE_COLORS.greenhouse;
  const roleIcon = ROLE_ICONS[job.category] || 'briefcase';
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.75} style={styles.trendCard}>
      <View style={styles.trendTop}>
        <View style={[styles.trendIcon, { backgroundColor: source.bg }]}>
          <Icon name={roleIcon} size={13} color={source.fg} strokeWidth={1.8} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.trendTitle} numberOfLines={1}>{job.title}</Text>
          <Text style={styles.trendCompany} numberOfLines={1}>{job.company}</Text>
        </View>
        <View style={[styles.trendBadge, { backgroundColor: source.bg }]}>
          <Text style={[styles.trendBadgeText, { color: source.fg }]}>{source.label}</Text>
        </View>
      </View>
      <View style={styles.trendBottom}>
        {job.location ? (
          <View style={styles.trendLoc}>
            <Icon name="map-pin" size={9} color={theme.colors.muted} strokeWidth={1.8} />
            <Text style={styles.trendLocText} numberOfLines={1}>{job.location}</Text>
          </View>
        ) : null}
        {job.postedDate ? (
          <Text style={styles.trendTime}>{relativeTime(job.postedDate)}</Text>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

const THREE_DAYS_MS = 72 * 60 * 60 * 1000;
function filterLatestJobs(jobs) {
  return jobs.filter(j => j.postedDate && Date.now() - new Date(j.postedDate).getTime() <= THREE_DAYS_MS);
}

export default function HomeScreen({ navigation }) {
  const [url, setUrl] = useState('');
  const [profile, setProfile] = useState(() => loadProfile());
  const [latestJobs, setLatestJobs] = useState(() => filterLatestJobs(loadFeedJobs()).slice(0, 6));
  const [loadingLatest, setLoadingLatest] = useState(false);

  useFocusEffect(
    useCallback(() => {
      setProfile(loadProfile());
      const cached = loadFeedJobs();
      if (cached.length > 0) {
        setLatestJobs(filterLatestJobs(cached).slice(0, 6));
      }
    }, [])
  );

  // Fetch a preview of jobs on mount
  useEffect(() => {
    let cancelled = false;
    async function fetchPreview() {
      setLoadingLatest(true);
      try {
        const result = await fetchJobFeed({ page: 1 });
        if (!cancelled && result.jobs?.length > 0) {
          setLatestJobs(filterLatestJobs(result.jobs).slice(0, 6));
          saveFeedJobs(result.jobs);
        }
      } catch {
        // Use cached data — already loaded in state
      } finally {
        if (!cancelled) setLoadingLatest(false);
      }
    }
    fetchPreview();
    return () => { cancelled = true; };
  }, []);

  const handleOpen = useCallback(() => {
    const trimmed = url.trim();
    if (!trimmed) {
      Alert.alert('Enter a URL', 'Paste a job application URL.');
      return;
    }
    const fullUrl = trimmed.startsWith('http') ? trimmed : `https://${trimmed}`;
    setUrl('');
    navigation.navigate('Browser', { url: fullUrl });
  }, [url, navigation]);

  const firstName = profile.firstName || profile.name || 'there';
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  const TIPS = [
    { icon: 'zap', title: 'Autofill any form', body: 'We read the page and map each field to your profile in one tap.' },
    { icon: 'sparkles', title: 'AI drafts long answers', body: 'Cover letters and "Why this role?" are written in your voice.' },
    { icon: 'lock', title: 'Private by design', body: 'Your profile never leaves the app. Only the matching happens on the server.' },
  ];

  const API_SOURCES = [
    { name: 'LinkedIn', icon: 'briefcase', color: '#1e40af' },
    { name: 'Indeed', icon: 'search', color: '#92400e' },
    { name: 'ZipRecruiter', icon: 'zap', color: '#166534' },
    { name: 'Google Jobs', icon: 'globe', color: '#7e22ce' },
    { name: 'Greenhouse', icon: 'leaf', color: '#065f46' },
    { name: 'Lever', icon: 'arrow-up-right', color: '#1e40af' },
  ];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={T.small}>{greeting}</Text>
          <Text style={styles.name}>{firstName}</Text>
        </View>
        <TouchableOpacity
          onPress={() => navigation.navigate('Profiles')}
          activeOpacity={0.8}
          style={styles.avatar}
        >
          <Text style={styles.avatarText}>{getInitials(profile)}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
        {/* Hero card */}
        <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
          <Card pad={20} style={{ borderColor: theme.colors.ink, backgroundColor: theme.colors.ink }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Icon name="sparkles" size={12} color="rgba(255,255,255,0.6)" />
              <Text style={styles.heroLabel}>AUTOFILL A JOB</Text>
            </View>
            <Text style={styles.heroTitle}>Paste any application URL</Text>
            <View style={styles.urlRow}>
              <View style={styles.urlInputWrap}>
                <Icon name="link" size={14} color={theme.colors.muted} />
                <TextInput
                  style={styles.urlInput}
                  placeholder="jobs.example.com/apply/…"
                  placeholderTextColor={theme.colors.faint}
                  value={url}
                  onChangeText={setUrl}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  returnKeyType="go"
                  onSubmitEditing={handleOpen}
                />
              </View>
              <TouchableOpacity onPress={handleOpen} activeOpacity={0.85} style={styles.openBtn}>
                <Icon name="zap" size={15} color="#052e1f" strokeWidth={2.5} />
              </TouchableOpacity>
            </View>
            <Text style={styles.heroFoot}>
              Works on Greenhouse, Lever, Workday, Ashby, and most career pages.
            </Text>
          </Card>
        </View>

        {/* Latest Jobs Section */}
        <View style={styles.trendingHeader}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Eyebrow>LATEST JOBS</Eyebrow>
            {loadingLatest && (
              <ActivityIndicator size="small" color={theme.colors.accent} />
            )}
          </View>
          <TouchableOpacity
            onPress={() => navigation.navigate('Discover')}
            activeOpacity={0.7}
            style={styles.seeAllBtn}
          >
            <Text style={styles.seeAllText}>See all</Text>
            <Icon name="arrow-right" size={13} color={theme.colors.accent} strokeWidth={2} />
          </TouchableOpacity>
        </View>

        {latestJobs.length > 0 ? (
          <View style={styles.trendingList}>
            {latestJobs.map(job => (
              <LatestJobCard
                key={job.id}
                job={job}
                onPress={() => navigation.navigate('Browser', { url: job.applyUrl })}
              />
            ))}
          </View>
        ) : !loadingLatest ? (
          <View style={styles.trendingEmpty}>
            <Icon name="clock" size={20} color={theme.colors.faint} />
            <Text style={styles.trendingEmptyText}>No recent jobs found</Text>
          </View>
        ) : null}

        {/* API Sources */}
        <View style={{ paddingHorizontal: 18, marginTop: 24 }}>
          <Eyebrow>POWERED BY OFFICIAL APIs</Eyebrow>
          <View style={styles.apiPills}>
            {API_SOURCES.map(src => (
              <View key={src.name} style={styles.apiPill}>
                <Icon name={src.icon} size={12} color={src.color} strokeWidth={1.8} />
                <Text style={styles.apiPillText}>{src.name}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* How it works */}
        <View style={{ paddingHorizontal: 18, marginTop: 28, marginBottom: 10 }}>
          <Eyebrow>HOW IT WORKS</Eyebrow>
        </View>
        <View style={{ paddingHorizontal: 16, gap: 10 }}>
          {TIPS.map(tip => (
            <Card key={tip.title} pad={16} style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
              <View style={styles.tipIcon}>
                <Icon name={tip.icon} size={16} color={theme.colors.accentInk} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.tipTitle}>{tip.title}</Text>
                <Text style={styles.tipBody}>{tip.body}</Text>
              </View>
            </Card>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 12,
  },
  name: {
    fontSize: 18,
    fontFamily: theme.font.sans,
    fontWeight: '800',
    letterSpacing: -0.4,
    color: theme.colors.ink,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: theme.colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: '#fff',
    fontFamily: theme.font.monoExtraBold,
    fontSize: 13,
    letterSpacing: -1,
  },
  // Hero
  heroLabel: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 10,
    fontFamily: theme.font.sans,
    fontWeight: '700',
    letterSpacing: 1.4,
  },
  heroTitle: {
    color: '#fff',
    fontFamily: theme.font.sans,
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.5,
    marginTop: 6,
    marginBottom: 14,
  },
  urlRow: { flexDirection: 'row', gap: 8 },
  urlInputWrap: {
    flex: 1,
    height: 46,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  urlInput: {
    flex: 1,
    color: '#fff',
    fontSize: 14,
    fontFamily: theme.font.sans,
    padding: 0,
  },
  openBtn: {
    width: 46,
    height: 46,
    borderRadius: 12,
    backgroundColor: theme.colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroFoot: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 11,
    fontFamily: theme.font.sans,
    marginTop: 10,
  },

  // Trending
  trendingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    marginTop: 24,
    marginBottom: 10,
  },
  seeAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  seeAllText: {
    fontSize: 12,
    fontFamily: theme.font.sans,
    fontWeight: '700',
    color: theme.colors.accent,
  },
  trendingList: {
    paddingHorizontal: 16,
    gap: 6,
  },
  trendCard: {
    padding: 14,
    borderRadius: 14,
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  trendTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  trendIcon: {
    width: 32,
    height: 32,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trendTitle: {
    fontSize: 13,
    fontFamily: theme.font.sans,
    fontWeight: '700',
    color: theme.colors.ink,
    letterSpacing: -0.2,
  },
  trendCompany: {
    fontSize: 11,
    fontFamily: theme.font.sans,
    color: theme.colors.muted,
    marginTop: 1,
  },
  trendBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
  },
  trendBadgeText: {
    fontSize: 8,
    fontFamily: theme.font.sans,
    fontWeight: '700',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  trendBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
    paddingLeft: 42,
  },
  trendLoc: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  trendLocText: {
    fontSize: 10,
    fontFamily: theme.font.sans,
    color: theme.colors.muted,
  },
  trendTime: {
    fontSize: 10,
    fontFamily: theme.font.mono,
    color: theme.colors.faint,
    letterSpacing: -0.3,
  },
  trendingEmpty: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 24,
    marginHorizontal: 16,
    borderRadius: 14,
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  trendingEmptyText: {
    fontSize: 13,
    fontFamily: theme.font.sans,
    color: theme.colors.muted,
  },

  // API Sources
  apiPills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 10,
  },
  apiPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    height: 28,
    borderRadius: 14,
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  apiPillText: {
    fontSize: 11,
    fontFamily: theme.font.sans,
    fontWeight: '600',
    color: theme.colors.ink2,
  },

  // Tips
  tipIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: theme.colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tipTitle: {
    fontSize: 14,
    fontFamily: theme.font.sans,
    fontWeight: '700',
    letterSpacing: -0.2,
    color: theme.colors.ink,
  },
  tipBody: {
    fontSize: 12.5,
    fontFamily: theme.font.sans,
    color: theme.colors.muted,
    lineHeight: 18,
    marginTop: 4,
  },
});
