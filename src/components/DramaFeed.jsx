import { t, useLanguage } from '../i18n';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Film, Play, RefreshCw, Dices, Bookmark, Check, Sparkles } from './icons';
import useMediaSources from './useMediaSources';
import { mediaSourceLabel } from './mediaSourcesModel.mjs';
import { feedCacheKey, readFeedCache, writeFeedCache } from './feedCache.mjs';
import { loadRandomPool, playRecommendedDrama, waitForRequest } from './randomDramaModel.mjs';
import './DramaFeed.css';

const CATALOG_CHANNEL_KEY = 'hongguo.feed.catalog.channel.v1';
const RANKINGS = [
  ['hot-drama', '热播总榜'],
  ['hot-real-drama', '真人短剧'],
  ['hot-comic-drama', '动态漫剧'],
  ['hot-ai-drama', 'AI 短剧'],
];

function DramaFeed({ active = true, onNavigate }) {
  useLanguage();
  const [source, setSource] = useState('hongguo');
  const [catalogChannel, setCatalogChannel] = useState(() => {
    try { return localStorage.getItem(CATALOG_CHANNEL_KEY) === 'web' ? 'web' : 'app'; }
    catch (_) { return 'app'; }
  });
  const { sources: mediaSources, revision, loading: sourcesLoading, error: sourcesError } = useMediaSources();
  const [category, setCategory] = useState('hot-drama');
  const [items, setItems] = useState(() => readFeedCache(feedCacheKey(revision, source, category, catalogChannel))?.items || []);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState('');
  const [playError, setPlayError] = useState('');
  const [favorited, setFavorited] = useState(false);
  const [favToast, setFavToast] = useState('');

  const listController = useRef(null);
  const playController = useRef(null);
  const selectedIdRef = useRef('');
  const itemsRef = useRef([]);
  const listPanelRef = useRef(null);

  const selected = items[index];
  const ranking = source === 'hongguo';
  const sourceLabel = mediaSourceLabel(source, mediaSources);
  itemsRef.current = items;
  selectedIdRef.current = selected ? String(selected.series_id) : '';

  const seedFeed = useCallback((nextSource, nextCategory, nextChannel = catalogChannel) => {
    const cached = readFeedCache(feedCacheKey(revision, nextSource, nextCategory, nextChannel));
    setItems(cached?.items || []);
    setIndex(0);
  }, [revision, catalogChannel]);

  const stopRequests = useCallback(() => {
    listController.current?.abort();
    playController.current?.abort();
    setResolving(false);
    setPlayError('');
  }, []);

  const switchFeed = (nextSource, nextCategory) => {
    if (source === nextSource && category === nextCategory) return;
    stopRequests();
    setError('');
    setLoading(true);
    seedFeed(nextSource, nextCategory);
    setSource(nextSource);
    setCategory(nextCategory);
  };

  const loadList = useCallback(async (forceRefresh = false) => {
    if (!active || sourcesLoading || !source) return;
    if (!mediaSources.some(item => item.id === source)) return;
    const key = feedCacheKey(revision, source, category, catalogChannel);
    const cached = readFeedCache(key);
    if (!itemsRef.current.length && cached?.items?.length) {
      setItems(cached.items);
      setIndex(0);
    }
    listController.current?.abort();
    const controller = new AbortController();
    listController.current = controller;
    setLoading(true);
    setError('');
    try {
      let nextItems;
      if (ranking) {
        const result = await waitForRequest(window.electronAPI.browseList({
          source, category, page: 1, forceRefresh, catalogChannel,
        }), { signal: controller.signal, message: '热播榜加载超时，请重试' });
        if (controller.signal.aborted) return;
        if (!result?.success) throw new Error(result?.error || '热播榜暂时不可用');
        const seen = new Set();
        nextItems = (Array.isArray(result.results) ? result.results : []).filter(item => {
          const id = String(item?.series_id || '');
          if (!/^\d{6,30}$/.test(id) || typeof item.series_title !== 'string' || !item.series_title.trim() || seen.has(id)) return false;
          seen.add(id); return true;
        });
      } else {
        const result = await loadRandomPool(options => window.electronAPI.browseList(options), {
          source, sources: mediaSources, forceRefresh, signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        nextItems = result.items;
      }
      if (!nextItems.length) {
        setError(itemsRef.current.length ? '来源这次没有返回片单，请稍后重试。' : '这个来源暂未返回可用片单，可重试或切换来源。');
        return;
      }
      const savedAt = Date.now();
      writeFeedCache(key, nextItems, savedAt);
      const keepId = selectedIdRef.current;
      setItems(nextItems);
      setIndex(() => {
        const found = keepId ? nextItems.findIndex(item => String(item.series_id) === keepId) : -1;
        return found >= 0 ? found : 0;
      });
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause.message || '片单加载失败，请重试或切换来源');
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [active, sourcesLoading, source, category, catalogChannel, revision, ranking, mediaSources]);

  useEffect(() => {
    if (sourcesLoading) return;
    if (!mediaSources.some(item => item.id === source)) {
      const next = mediaSources[0]?.id || '';
      if (next) {
        seedFeed(next, 'hot-drama');
        setLoading(true);
        setSource(next);
        setCategory('hot-drama');
      } else {
        setItems([]);
        setIndex(0);
        setLoading(false);
        setError('');
      }
      return;
    }
    if (active) loadList();
  }, [active, loadList, seedFeed, sourcesLoading, mediaSources, source]);

  useEffect(() => () => { listController.current?.abort(); playController.current?.abort(); }, []);

  // 监听顶栏切换片源与目录线路事件
  useEffect(() => {
    const onChannelChange = (e) => {
      if (e.detail && ['app', 'web'].includes(e.detail) && e.detail !== catalogChannel) {
        setCatalogChannel(e.detail);
        seedFeed(source, category, e.detail);
      }
    };
    const onSourceChange = (e) => {
      if (e.detail && e.detail !== source) {
        switchFeed(e.detail, 'hot-drama');
      }
    };
    const onRefresh = () => loadList(true);
    window.addEventListener('catalog-channel-changed', onChannelChange);
    window.addEventListener('media-source-changed', onSourceChange);
    window.addEventListener('refresh-catalog-list', onRefresh);
    return () => {
      window.removeEventListener('catalog-channel-changed', onChannelChange);
      window.removeEventListener('media-source-changed', onSourceChange);
      window.removeEventListener('refresh-catalog-list', onRefresh);
    };
  }, [catalogChannel, source, category, seedFeed, loadList]);

  // 键盘方向键 ↑ / ↓ 切换选中项
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!active || items.length === 0) return;
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setIndex(idx => Math.max(0, idx - 1));
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setIndex(idx => Math.min(items.length - 1, idx + 1));
      } else if (e.key === 'Enter' && selected) {
        e.preventDefault();
        startItem();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [active, items.length, selected]);

  const startItem = async (targetItem = selected) => {
    if (!active || !targetItem || resolving || sourcesLoading) return;
    playController.current?.abort();
    const controller = new AbortController();
    playController.current = controller;
    setPlayError('');
    setResolving(true);
    try {
      await playRecommendedDrama(window.electronAPI, targetItem, { signal: controller.signal });
    } catch (cause) {
      if (!controller.signal.aborted) setPlayError(cause.message || '加载失败，请重试本剧');
    } finally {
      if (!controller.signal.aborted) setResolving(false);
    }
  };

  const handlePickRandom = () => {
    if (items.length <= 1) return;
    let nextIdx = Math.floor(Math.random() * items.length);
    if (nextIdx === index) nextIdx = (index + 1) % items.length;
    setIndex(nextIdx);
    // 滚动列表使选中的卡片可见
    const targetElement = listPanelRef.current?.children[nextIdx];
    targetElement?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  const handleToggleFavorite = () => {
    setFavorited(v => !v);
    setFavToast(!favorited ? '已添加到收藏' : '已取消收藏');
    setTimeout(() => setFavToast(''), 2000);
  };

  const introduction = selected?.intro || selected?.series_intro || selected?.description || '暂无剧情简介。';
  const top20Items = items.slice(0, 20);

  return (
    <section className="drama-rank-page" aria-label={t("热播榜单")}>
      {/* 顶部单行分类 Tab + 右侧轻量「随机一部」与「刷新」按钮 */}
      <header className="drama-rank-header">
        <div className="drama-rank-tabs" role="tablist">
          {ranking ? (
            RANKINGS.map(([value, label]) => (
              <button
                key={value}
                role="tab"
                aria-selected={category === value}
                className={`rank-category-tab ${category === value ? 'active' : ''}`}
                onClick={() => switchFeed(source, value)}
              >
                {t(label)}
              </button>
            ))
          ) : (
            <button
              className="rank-category-tab active"
              onClick={() => switchFeed(source, 'hot-drama')}
            >
              {t("来源热播")}
            </button>
          )}
        </div>

        <div className="drama-rank-header-actions">
          {/* 4.2 移至右侧的「随机一部」骰子按钮 */}
          <button
            className="btn btn-outline btn-sm dice-random-btn"
            onClick={handlePickRandom}
            disabled={loading || items.length <= 1}
            title={t("随机挑选一部热播短剧")}
          >
            <Dices size={15} />
            <span>{t("随机一部")}</span>
          </button>
          <button
            className="btn btn-outline btn-sm rank-refresh-btn"
            disabled={loading || sourcesLoading}
            onClick={() => loadList(true)}
            title={t("刷新当前榜单")}
            aria-label={t("刷新片单")}
          >
            <RefreshCw size={13} className={loading ? 'spin' : ''} />
            <span>{t("刷新")}</span>
          </button>
        </div>
      </header>

      {/* 4.2 双栏沉浸布局（左 62% 选中大卡详情 + 右 38% Top20 紧凑榜单） */}
      <div className="drama-rank-dual-layout">
        {/* 左侧（62%）：当前选中剧集的大卡片详情（海报高斯模糊氛围光背景） */}
        <div className="drama-rank-hero-pane">
          {selected ? (
            <div className="drama-hero-card">
              {/* 海报高斯模糊氛围光背景 */}
              {selected.cover && (
                <div
                  className="drama-hero-ambient-glow"
                  style={{ backgroundImage: `url(${selected.cover})` }}
                  aria-hidden="true"
                />
              )}

              <div className="drama-hero-body">
                {/* 榜单排名与热度徽标 */}
                <div className="drama-hero-top-badges">
                  <span className={`hero-rank-badge ${index === 0 ? 'rank-gold' : index === 1 ? 'rank-silver' : index === 2 ? 'rank-bronze' : ''}`}>
                    {index < 3 ? `TOP ${index + 1}` : `#${index + 1}`}
                  </span>
                  {selected.heat && (
                    <span className="hero-heat-badge">
                      <Sparkles size={12} />
                      {selected.heat}
                    </span>
                  )}
                  {selected.episode_count > 0 && (
                    <span className="hero-ep-badge">{t(`全 ${selected.episode_count} 集`)}</span>
                  )}
                </div>

                <div className="drama-hero-content-row">
                  {/* 大海报 */}
                  <div className="drama-hero-poster-wrap">
                    {selected.cover ? (
                      <img src={selected.cover} alt={selected.series_title} className="drama-hero-poster" />
                    ) : (
                      <div className="drama-hero-poster-fallback"><Film size={36} /></div>
                    )}
                  </div>

                  {/* 剧集详情信息 */}
                  <div className="drama-hero-info">
                    <h2 className="drama-hero-title">{selected.series_title}</h2>

                    {selected.tags && selected.tags.length > 0 && (
                      <div className="drama-hero-tags">
                        {selected.tags.slice(0, 4).map((tag, i) => (
                          <span key={i} className="hero-genre-tag">{tag}</span>
                        ))}
                      </div>
                    )}

                    <div className="drama-hero-intro-text">
                      <p>{introduction}</p>
                    </div>

                    {/* 主按钮「立即播放」+ 次按钮「收藏」 */}
                    <div className="drama-hero-actions">
                      <button
                        className="btn btn-primary btn-hero-play"
                        disabled={resolving}
                        onClick={() => startItem()}
                      >
                        <Play size={18} />
                        <span>{t(resolving ? '正在准备播放…' : '立即播放')}</span>
                      </button>
                      <button
                        className={`btn btn-outline btn-hero-fav ${favorited ? 'active' : ''}`}
                        onClick={handleToggleFavorite}
                        title={t("收藏到我的剧库")}
                      >
                        <Bookmark size={16} />
                        <span>{t(favorited ? '已收藏' : '收藏')}</span>
                      </button>
                      {favToast && <span className="hero-fav-toast" role="status">{favToast}</span>}
                    </div>

                    {playError && <div className="alert alert-error mt8">{t(playError)}</div>}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="drama-hero-empty" role="status">
              {loading ? (
                <div className="hero-loading-spinner">
                  <RefreshCw size={28} className="spin" />
                  <p>{t("正在加载热播榜单…")}</p>
                </div>
              ) : (
                <div className="hero-empty-notice">
                  <Film size={36} />
                  <p>{t(error || "暂无榜单数据，请刷新后重试。")}</p>
                  <button className="btn btn-primary btn-sm" onClick={() => loadList(true)}>{t("重新加载")}</button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 右侧（38%）：Top 20 紧凑可滚动榜单列表 */}
        <div className="drama-rank-list-pane">
          <div className="rank-list-header">
            <span className="rank-list-title">{t("榜单 Top 20")}</span>
            <span className="rank-list-sub">{t("↑ ↓ 键盘选择 · 双击播放")}</span>
          </div>

          <div className="rank-list-scrollable" ref={listPanelRef}>
            {top20Items.map((item, idx) => {
              const isSelected = idx === index;
              const isTop3 = idx < 3;
              const rankClass = idx === 0 ? 'rank-1' : idx === 1 ? 'rank-2' : idx === 2 ? 'rank-3' : '';

              return (
                <div
                  key={item.series_id}
                  className={`rank-item-row ${isSelected ? 'active' : ''}`}
                  onClick={() => setIndex(idx)}
                  onDoubleClick={() => startItem(item)}
                  role="button"
                  tabIndex={0}
                  aria-selected={isSelected}
                  title={t(`点击预览《${item.series_title}》，双击播放`)}
                >
                  <span className={`rank-item-number ${isTop3 ? rankClass : ''}`}>
                    {idx + 1}
                  </span>

                  <div className="rank-item-thumb">
                    {item.cover ? (
                      <img src={item.cover} alt="" loading="lazy" />
                    ) : (
                      <div className="thumb-fallback"><Film size={14} /></div>
                    )}
                  </div>

                  <div className="rank-item-meta">
                    <span className="rank-item-title">{item.series_title}</span>
                    <span className="rank-item-sub">
                      {item.episode_count ? t(`${item.episode_count} 集`) : ''}
                      {item.heat ? ` · ${item.heat}` : ''}
                    </span>
                  </div>

                  {isSelected && (
                    <div className="rank-item-active-play" aria-hidden="true">
                      <Play size={13} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

export default DramaFeed;
