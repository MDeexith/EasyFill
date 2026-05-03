import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Animated,
  Keyboard,
  ScrollView,
  unstable_batchedUpdates,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from '../components/Icon';
import { Eyebrow } from '../components/ui';
import { theme } from '../theme/tokens';
import { fetchJobFeed } from '../api/jobsApi';
import { saveFeedJobs, loadFeedJobs, getFeedAge } from '../profile/store';

const SOURCES = [
  { key: 'all', label: 'All Sources', icon: 'layers' },
  { key: 'greenhouse', label: 'Greenhouse', icon: 'leaf', bg: '#ecfdf5', fg: '#065f46' },
  { key: 'lever', label: 'Lever', icon: 'arrow-up-right', bg: '#eff6ff', fg: '#1e40af' },
  { key: 'remotive', label: 'Remotive', icon: 'globe', bg: '#f0fdf4', fg: '#166534' },
  { key: 'arbeitnow', label: 'Arbeitnow', icon: 'briefcase', bg: '#fef3c7', fg: '#92400e' },
  { key: 'linkedin', label: 'LinkedIn', icon: 'briefcase', bg: '#eff6ff', fg: '#1e40af' },
  { key: 'indeed', label: 'Indeed', icon: 'search', bg: '#fef3c7', fg: '#92400e' },
  { key: 'zip_recruiter', label: 'ZipRecruiter', icon: 'zap', bg: '#f0fdf4', fg: '#166534' },
  { key: 'google', label: 'Google Jobs', icon: 'globe', bg: '#fdf4ff', fg: '#7e22ce' },
];

const CATEGORIES = [
  'All', 'Engineering', 'Design', 'Product', 'Marketing',
  'Sales', 'Data', 'Operations', 'Support', 'Other',
];

const SOURCE_BADGE = {
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

// ─── Skeleton loader ────────────────────────────────────────────────
function SkeletonCard() {
  const shimmer = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(shimmer, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(shimmer, { toValue: 0, duration: 900, useNativeDriver: true }),
      ])
    ).start();
  }, [shimmer]);
  const opacity = shimmer.interpolate({ inputRange: [0, 1], outputRange: [0.15, 0.3] });
  return (
    <View style={styles.skeletonCard}>
      <View style={styles.skeletonTop}>
        <Animated.View style={[styles.skeletonIcon, { opacity }]} />
        <View style={{ flex: 1, gap: 8 }}>
          <Animated.View style={[styles.skeletonLine, { width: '72%', opacity }]} />
          <Animated.View style={[styles.skeletonLine, { width: '45%', opacity }]} />
        </View>
      </View>
      <View style={styles.skeletonBottom}>
        <Animated.View style={[styles.skeletonPill, { width: 80, opacity }]} />
        <Animated.View style={[styles.skeletonPill, { width: 60, opacity }]} />
      </View>
    </View>
  );
}

// ─── Job Card ───────────────────────────────────────────────────────
function JobCard({ job, onPress }) {
  const badge = SOURCE_BADGE[job.source] || SOURCE_BADGE.greenhouse;
  const roleIcon = ROLE_ICONS[job.category] || 'briefcase';
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.72} style={styles.jobCard}>
      <View style={styles.jobTop}>
        <View style={[styles.roleIcon, { backgroundColor: badge.bg }]}>
          <Icon name={roleIcon} size={14} color={badge.fg} strokeWidth={1.8} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.jobTitle} numberOfLines={2}>{job.title}</Text>
          <View style={styles.jobMeta}>
            <Icon name="building" size={11} color={theme.colors.muted} strokeWidth={1.5} />
            <Text style={styles.jobMetaText} numberOfLines={1}>{job.company}</Text>
          </View>
        </View>
      </View>
      <View style={styles.jobBottom}>
        <View style={styles.jobPills}>
          {job.location ? (
            <View style={styles.locPill}>
              <Icon name="map-pin" size={10} color={theme.colors.muted} strokeWidth={1.8} />
              <Text style={styles.locPillText} numberOfLines={1}>{job.location}</Text>
            </View>
          ) : null}
          {job.department ? (
            <View style={styles.deptPill}>
              <Text style={styles.deptPillText} numberOfLines={1}>{job.department}</Text>
            </View>
          ) : null}
        </View>
        <View style={styles.jobRight}>
          <View style={[styles.sourceBadge, { backgroundColor: badge.bg }]}>
            <Text style={[styles.sourceBadgeText, { color: badge.fg }]}>{badge.label}</Text>
          </View>
          {job.postedDate ? (
            <Text style={styles.jobTime}>{relativeTime(job.postedDate)}</Text>
          ) : null}
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ─── Main Screen ────────────────────────────────────────────────────
export default function JobFeedScreen({ navigation }) {
  const [jobs, setJobs] = useState(() => loadFeedJobs());
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedSource, setSelectedSource] = useState('all');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [locationFilter, setLocationFilter] = useState('');
  const [locationChip, setLocationChip] = useState('India');
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [totalCount, setTotalCount] = useState(0);
  const [error, setError] = useState(null);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 400);
    return () => clearTimeout(timer);
  }, [search]);

  const activeLocation = locationChip !== 'Any' ? locationChip : locationFilter.trim();
  const loadingRef = useRef(false);

  const loadJobs = useCallback(async (opts = {}) => {
    const { isRefresh = false, isLoadMore = false, pageNum = 1 } = opts;
    if (loadingRef.current && !isRefresh) return;

    loadingRef.current = true;
    unstable_batchedUpdates(() => {
      if (isRefresh) setRefreshing(true);
      else if (!isLoadMore) setLoading(true);
      setError(null);
    });

    try {
      const sources = selectedSource === 'all' ? undefined : [selectedSource];
      const loc = locationChip !== 'Any' ? locationChip : locationFilter.trim();
      const isRemote = locationChip === 'Remote';
      const result = await fetchJobFeed({
        search: debouncedSearch,
        category: selectedCategory,
        location: loc || undefined,
        page: pageNum,
        sources,
        isRemote,
      });

      const newJobs = result.jobs || [];
      unstable_batchedUpdates(() => {
        if (isLoadMore) {
          setJobs(prev => [...prev, ...newJobs]);
        } else {
          setJobs(newJobs);
          saveFeedJobs(newJobs);
        }
        setHasMore(result.hasMore || false);
        setTotalCount(result.total || 0);
        setPage(pageNum);
        setLoading(false);
        setRefreshing(false);
      });
    } catch (e) {
      unstable_batchedUpdates(() => {
        setError('Failed to load jobs. Check your connection.');
        setLoading(false);
        setRefreshing(false);
      });
    } finally {
      loadingRef.current = false;
    }
  }, [debouncedSearch, selectedSource, selectedCategory, locationChip, locationFilter]);

  // Initial load and on filter change
  useEffect(() => {
    loadJobs({ isRefresh: false });
  }, [debouncedSearch, selectedSource, selectedCategory, locationChip, locationFilter]);

  const handleRefresh = useCallback(() => {
    loadJobs({ isRefresh: true });
  }, [loadJobs]);

  const handleLoadMore = useCallback(() => {
    if (!hasMore || loading) return;
    loadJobs({ isLoadMore: true, pageNum: page + 1 });
  }, [hasMore, loading, page, loadJobs]);

  const filteredJobs = useMemo(() => {
    const loc = activeLocation.toLowerCase();
    if (!loc) return jobs;
    return jobs.filter(j => {
      const jloc = (j.location || '').toLowerCase();
      if (loc === 'remote') return jloc.includes('remote') || jloc === '';
      return jloc.includes(loc);
    });
  }, [jobs, activeLocation]);

  const renderJobCard = useCallback(({ item }) => (
    <JobCard
      job={item}
      onPress={() => navigation.navigate('Browser', { url: item.applyUrl })}
    />
  ), [navigation]);

  const ListHeader = (
    <>
      {/* Search bar */}
      <View style={styles.searchWrap}>
        <View style={styles.searchBar}>
          <Icon name="search" size={16} color={theme.colors.muted} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search jobs, companies, locations…"
            placeholderTextColor={theme.colors.faint}
            value={search}
            onChangeText={setSearch}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            onSubmitEditing={() => Keyboard.dismiss()}
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')} activeOpacity={0.7}>
              <Icon name="close" size={16} color={theme.colors.muted} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Location filter */}
      <View style={styles.locationWrap}>
        <View style={styles.locationBar}>
          <Icon name="map-pin" size={14} color={theme.colors.muted} />
          <TextInput
            style={styles.locationInput}
            placeholder="Location…"
            placeholderTextColor={theme.colors.faint}
            value={locationFilter}
            onChangeText={v => { setLocationFilter(v); setLocationChip('Any'); }}
            autoCapitalize="words"
            autoCorrect={false}
            returnKeyType="search"
            onSubmitEditing={() => Keyboard.dismiss()}
          />
          {locationFilter.length > 0 && (
            <TouchableOpacity onPress={() => setLocationFilter('')} activeOpacity={0.7}>
              <Icon name="close" size={14} color={theme.colors.muted} />
            </TouchableOpacity>
          )}
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.locChipRow}>
          {['Any', 'Remote', 'USA', 'India', 'UK', 'Canada', 'Europe', 'Australia'].map(chip => {
            const isActive = locationChip === chip && !locationFilter;
            return (
              <TouchableOpacity
                key={chip}
                onPress={() => { setLocationChip(chip); setLocationFilter(''); }}
                activeOpacity={0.7}
                style={[styles.locChip, isActive && styles.locChipActive]}
              >
                {chip === 'Remote' && (
                  <Icon name="wifi" size={11} color={isActive ? theme.colors.accentInk : theme.colors.muted} strokeWidth={2} />
                )}
                <Text style={[styles.locChipText, isActive && styles.locChipTextActive]}>{chip}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* Source filter */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.sourceRow}
      >
        {SOURCES.map(src => {
          const isActive = selectedSource === src.key;
          return (
            <TouchableOpacity
              key={src.key}
              onPress={() => setSelectedSource(src.key)}
              activeOpacity={0.7}
              style={[
                styles.sourcePill,
                isActive && styles.sourcePillActive,
                isActive && src.key !== 'all' && { backgroundColor: src.bg, borderColor: src.bg },
              ]}
            >
              <Icon
                name={src.icon}
                size={13}
                color={isActive ? (src.key === 'all' ? '#fff' : src.fg) : theme.colors.muted}
                strokeWidth={isActive ? 2 : 1.6}
              />
              <Text style={[
                styles.sourcePillText,
                isActive && styles.sourcePillTextActive,
                isActive && src.key !== 'all' && { color: src.fg },
              ]}>{src.label}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Category filter */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.catRow}
      >
        {CATEGORIES.map(cat => {
          const isActive = selectedCategory === cat;
          return (
            <TouchableOpacity
              key={cat}
              onPress={() => setSelectedCategory(cat)}
              activeOpacity={0.7}
              style={[styles.catPill, isActive && styles.catPillActive]}
            >
              <Text style={[
                styles.catPillText,
                isActive && styles.catPillTextActive,
              ]}>{cat}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Stats bar */}
      <View style={styles.statsBar}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Eyebrow>JOBS</Eyebrow>
          <View style={styles.countBadge}>
            <Text style={styles.countBadgeText}>{totalCount}</Text>
          </View>
        </View>
        {loading && !refreshing && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <ActivityIndicator size="small" color={theme.colors.accent} />
            <Text style={styles.loadingLabel}>Fetching…</Text>
          </View>
        )}
      </View>

      {/* Error banner */}
      {error && (
        <View style={styles.errorBanner}>
          <Icon name="alert-triangle" size={14} color="#dc2626" strokeWidth={2} />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity onPress={handleRefresh} activeOpacity={0.7}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}
    </>
  );

  const EmptyState = () => {
    if (loading) {
      return (
        <View style={{ gap: 2 }}>
          {[1, 2, 3, 4, 5].map(i => <SkeletonCard key={i} />)}
        </View>
      );
    }
    return (
      <View style={styles.emptyWrap}>
        <View style={styles.emptyIcon}>
          <Icon name="briefcase" size={28} color={theme.colors.faint} />
        </View>
        <Text style={styles.emptyTitle}>No jobs found</Text>
        <Text style={styles.emptyBody}>
          {search || activeLocation
            ? 'Try adjusting search, location, or category filters.'
            : 'Pull down to refresh or try a different source.'}
        </Text>
      </View>
    );
  };

  const ListFooter = () => {
    if (!hasMore || filteredJobs.length === 0) return null;
    return (
      <View style={styles.footer}>
        <ActivityIndicator size="small" color={theme.colors.muted} />
        <Text style={styles.footerText}>Loading more…</Text>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Discover Jobs</Text>
          <Text style={styles.headerSub}>Official listings from top companies</Text>
        </View>
        <TouchableOpacity
          onPress={handleRefresh}
          activeOpacity={0.7}
          style={styles.refreshBtn}
        >
          <Icon name="refresh" size={16} color={theme.colors.ink2} strokeWidth={2} />
        </TouchableOpacity>
      </View>

      <FlatList
        data={filteredJobs}
        keyExtractor={item => item.id}
        renderItem={renderJobCard}
        ListHeaderComponent={ListHeader}
        ListEmptyComponent={EmptyState}
        ListFooterComponent={ListFooter}
        contentContainerStyle={{ paddingBottom: 24 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        onEndReached={handleLoadMore}
        onEndReachedThreshold={0.4}
        ItemSeparatorComponent={() => (
          <View style={{ height: 1, marginHorizontal: 16, backgroundColor: theme.colors.border }} />
        )}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={theme.colors.accent}
            colors={[theme.colors.accent]}
          />
        }
      />
    </SafeAreaView>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 8,
  },
  headerTitle: {
    fontSize: 22,
    fontFamily: theme.font.sans,
    fontWeight: '800',
    letterSpacing: -0.5,
    color: theme.colors.ink,
  },
  headerSub: {
    fontSize: 12,
    fontFamily: theme.font.sans,
    color: theme.colors.muted,
    marginTop: 2,
  },
  refreshBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Search
  searchWrap: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 6 },
  searchBar: {
    height: 44,
    borderRadius: 12,
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    fontFamily: theme.font.sans,
    color: theme.colors.ink,
    padding: 0,
  },

  // Location filter
  locationWrap: { paddingHorizontal: 16, paddingBottom: 4, gap: 6 },
  locationBar: {
    height: 38,
    borderRadius: 10,
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  locationInput: {
    flex: 1,
    fontSize: 13,
    fontFamily: theme.font.sans,
    color: theme.colors.ink,
    padding: 0,
  },
  locChipRow: { gap: 6, paddingBottom: 2 },
  locChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 28,
    paddingHorizontal: 11,
    borderRadius: 14,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  locChipActive: {
    backgroundColor: theme.colors.accentSoft,
    borderColor: theme.colors.accent,
  },
  locChipText: {
    fontSize: 11,
    fontFamily: theme.font.sans,
    fontWeight: '600',
    color: theme.colors.muted,
  },
  locChipTextActive: {
    color: theme.colors.accentInk,
  },

  // Source filter
  sourceRow: { paddingHorizontal: 16, paddingVertical: 6, gap: 6 },
  sourcePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 34,
    paddingHorizontal: 14,
    borderRadius: 17,
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  sourcePillActive: {
    backgroundColor: theme.colors.ink,
    borderColor: theme.colors.ink,
  },
  sourcePillText: {
    fontSize: 12,
    fontFamily: theme.font.sans,
    fontWeight: '600',
    color: theme.colors.ink2,
  },
  sourcePillTextActive: { color: '#fff' },

  // Category filter
  catRow: { paddingHorizontal: 16, paddingBottom: 8, gap: 6 },
  catPill: {
    height: 30,
    paddingHorizontal: 12,
    borderRadius: 15,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  catPillActive: {
    backgroundColor: theme.colors.accentSoft,
    borderColor: theme.colors.accent,
  },
  catPillText: {
    fontSize: 11.5,
    fontFamily: theme.font.sans,
    fontWeight: '600',
    color: theme.colors.muted,
  },
  catPillTextActive: {
    color: theme.colors.accentInk,
    fontWeight: '700',
  },

  // Stats
  statsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 8,
  },
  countBadge: {
    backgroundColor: theme.colors.accentSoft,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 8,
  },
  countBadgeText: {
    fontSize: 10,
    fontFamily: theme.font.monoExtraBold,
    color: theme.colors.accentInk,
    letterSpacing: -0.3,
  },
  loadingLabel: {
    fontSize: 11,
    fontFamily: theme.font.sans,
    color: theme.colors.muted,
  },

  // Error
  errorBanner: {
    marginHorizontal: 16,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  errorText: {
    flex: 1,
    fontSize: 12,
    fontFamily: theme.font.sans,
    color: '#991b1b',
  },
  retryText: {
    fontSize: 12,
    fontFamily: theme.font.sans,
    fontWeight: '700',
    color: '#dc2626',
  },

  // Job cards
  jobCard: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#fff',
  },
  jobTop: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
  },
  roleIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  jobTitle: {
    fontSize: 14,
    fontFamily: theme.font.sans,
    fontWeight: '700',
    color: theme.colors.ink,
    letterSpacing: -0.2,
    lineHeight: 19,
  },
  jobMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 3,
  },
  jobMetaText: {
    fontSize: 12,
    fontFamily: theme.font.sans,
    color: theme.colors.muted,
  },
  jobBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
    paddingLeft: 48,
  },
  jobPills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
    flex: 1,
  },
  locPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 22,
    paddingHorizontal: 8,
    borderRadius: 11,
    backgroundColor: theme.colors.surface2,
    maxWidth: 140,
  },
  locPillText: {
    fontSize: 10.5,
    fontFamily: theme.font.sans,
    fontWeight: '500',
    color: theme.colors.ink2,
  },
  deptPill: {
    height: 22,
    paddingHorizontal: 8,
    borderRadius: 11,
    backgroundColor: theme.colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
    maxWidth: 120,
  },
  deptPillText: {
    fontSize: 10.5,
    fontFamily: theme.font.sans,
    fontWeight: '500',
    color: theme.colors.muted,
  },
  jobRight: {
    alignItems: 'flex-end',
    gap: 4,
  },
  sourceBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  sourceBadgeText: {
    fontSize: 9,
    fontFamily: theme.font.sans,
    fontWeight: '700',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  jobTime: {
    fontSize: 10,
    fontFamily: theme.font.mono,
    color: theme.colors.faint,
    letterSpacing: -0.3,
  },

  // Skeleton
  skeletonCard: {
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  skeletonTop: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
  },
  skeletonIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: theme.colors.ink,
  },
  skeletonLine: {
    height: 12,
    borderRadius: 6,
    backgroundColor: theme.colors.ink,
  },
  skeletonBottom: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
    paddingLeft: 48,
  },
  skeletonPill: {
    height: 22,
    borderRadius: 11,
    backgroundColor: theme.colors.ink,
  },

  // Empty
  emptyWrap: {
    alignItems: 'center',
    paddingVertical: 56,
    paddingHorizontal: 40,
  },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: theme.colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 17,
    fontFamily: theme.font.sans,
    fontWeight: '700',
    color: theme.colors.ink,
    marginBottom: 6,
  },
  emptyBody: {
    fontSize: 13,
    fontFamily: theme.font.sans,
    color: theme.colors.muted,
    textAlign: 'center',
    lineHeight: 19,
  },

  // Footer
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 20,
  },
  footerText: {
    fontSize: 12,
    fontFamily: theme.font.sans,
    color: theme.colors.muted,
  },
});
