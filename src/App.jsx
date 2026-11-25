import { t, useLanguage } from './i18n';
// 牛油果短剧 7.9：纯 Go + Wails 架构，原生桌面 UI/UX 规范重构版
import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import {
  Film, Download, Settings, Play, Home, Search, Clock, User,
  Sun, Moon, Flame, Bookmark, ArrowLeft, ArrowRight, ChevronDown,
  RefreshCw, ExternalLink, Globe, X, Zap
} from './components/icons';
import HongguoDownload from './components/HongguoDownload';
import DownloadManager from './components/DownloadManager';
import SettingsPage from './components/Settings';
import Player from './components/Player';
import Browse from './components/Browse';
import PageMenu from './components/PageMenu';
import WatchHistory from './components/WatchHistory';
import { initializeTheme, toggleThemePreference } from './theme';
import useStealthWindow from './components/useStealthWindow';
import './components/StealthWindow.css';
import AppUpdateNotice from './components/AppUpdateNotice';
import AnnouncementNotice from './components/AnnouncementNotice';
import DramaFeed from './components/DramaFeed';
import ReleaseCalendar from './components/ReleaseCalendar';
import AccountManagement from './components/AccountManagement';
import useMediaSources from './components/useMediaSources';
import { mediaSourceLabel } from './components/mediaSourcesModel.mjs';

const EXPLORE_MENU = [
  { id: 'browse', label: '发现短剧', icon: Home },
  { id: 'feed', label: '热播榜单', icon: Flame },
  { id: 'download', label: '搜索与下载', icon: Search },
];

const MY_MENU = [
  { id: 'player', label: '我的剧库', icon: Play },
  { id: 'history', label: '观看记录', icon: Clock },
  { id: 'calendar', label: '收藏与上新', icon: Bookmark },
  { id: 'manager', label: '下载管理', icon: Download },
];

const ALL_PAGES = [
  ...EXPLORE_MENU,
  ...MY_MENU,
  { id: 'settings', label: '设置', icon: Settings },
];

const CATALOG_CHANNEL_KEY = 'hongguo.catalog.channel.v1';

export default function App({ platformPages = {} }) {
  useLanguage();
  const mobile = window.electronAPI.platform === 'android';
  const [moreOpen, setMoreOpen] = useState(false);
  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const [activeDownloads, setActiveDownloads] = useState(0);
  const [accountStatus, setAccountStatus] = useState(null);
  const [themeMode, setThemeMode] = useState(() => (typeof document !== 'undefined' ? document.documentElement?.dataset?.theme : null) || 'light');

  // 导航历史栈（用于前进/后退）
  const [historyStack, setHistoryStack] = useState(['browse']);
  const [historyIndex, setHistoryIndex] = useState(0);
  const isNavigatingRef = useRef(false);

  const { stealthMode, toggleStealth, stealthError } = useStealthWindow();
  const [wakeRegionFocus, setWakeRegionFocus] = useState(0);
  const [wakeSettingsOpening, setWakeSettingsOpening] = useState(false);
  useLayoutEffect(() => initializeTheme(), []);

  const [layout, setLayout] = useState('landscape');
  const [layoutBusy, setLayoutBusy] = useState(false);
  const [actionsHidden, setActionsHidden] = useState(false);
  const [borderless, setBorderless] = useState(false);
  const [episodesOpen, setEpisodesOpen] = useState(false);
  const [alwaysOnTop, setAlwaysOnTop] = useState(false);
  const [pinBusy, setPinBusy] = useState(false);
  const layoutLock = useRef(false);

  const [page, setPage] = useState('browse');
  const pageRef = useRef('browse');
  const calendarRequest = useRef(0);
  const calendarOpeningRef = useRef(false);
  const [calendarOpening, setCalendarOpening] = useState('');
  const [visited, setVisited] = useState(['browse']);
  const [storageError, setStorageError] = useState('');
  const [appInfo, setAppInfo] = useState(null);
  const [playerMounted, setPlayerMounted] = useState(false);
  const floatingPlayer = useRef(false);
  const setFloatingPlayer = useCallback(value => { floatingPlayer.current = value; }, []);
  const [playerTarget, setPlayerTarget] = useState(null);

  // 全局片源状态与 Popover
  const { sources: mediaSources, revision: sourceRevision } = typeof useMediaSources === 'function' ? useMediaSources() : { sources: [], revision: 0 };
  const [globalSource, setGlobalSource] = useState('hongguo');
  const [globalChannel, setGlobalChannel] = useState(() => {
    try { return localStorage.getItem(CATALOG_CHANNEL_KEY) === 'web' ? 'web' : 'app'; }
    catch (_) { return 'app'; }
  });
  const [sourcePopoverOpen, setSourcePopoverOpen] = useState(false);
  const sourcePopoverRef = useRef(null);

  // 全局搜索与智能链接解析框
  const [searchQuery, setSearchQuery] = useState('');
  const [smartLink, setSmartLink] = useState(null);
  const [searchPopoverOpen, setSearchPopoverOpen] = useState(false);
  const [searchBusy, setSearchBusy] = useState(false);
  const searchInputRef = useRef(null);

  // 面包屑滚动探测
  const [scrolledPastTitle, setScrolledPastTitle] = useState(false);

  const rememberPlayerSeries = useCallback((seriesId) => {
    setPlayerTarget(target => ({ seriesId, resume: true, autoplay: false, ts: target?.ts }));
  }, []);

  // 监听并同步账号状态
  const refreshAccount = useCallback(async () => {
    try {
      const res = await window.electronAPI.getAccountStatus?.();
      if (res?.success) setAccountStatus(res.account || null);
    } catch (_) {}
  }, []);

  useEffect(() => {
    window.electronAPI.getWindowLayout?.().then(setLayout);
    window.electronAPI.getAlwaysOnTop?.().then(setAlwaysOnTop);
    window.electronAPI.getAppInfo?.().then(setAppInfo);
    refreshAccount();

    const unsubAccount = window.electronAPI.onAccountUpdated?.(refreshAccount);
    const unsubQueue = window.electronAPI.onDownloadQueueChanged?.((tasks) => {
      const count = Array.isArray(tasks) ? tasks.filter(t => ['downloading', 'pending'].includes(t?.status)).length : 0;
      setActiveDownloads(count);
    });
    return () => {
      unsubAccount?.();
      unsubQueue?.();
    };
  }, [refreshAccount]);

  useEffect(() => window.electronAPI.onStorageError?.((data) => {
    setStorageError(data === null ? '' : data?.error || '数据保存失败，请检查磁盘空间和目录权限后重试。');
  }), []);

  // 主进程发来的导航指令
  useEffect(() => {
    if (!window.electronAPI.onNavigate) return undefined;
    return window.electronAPI.onNavigate((data) => {
      if (!data || !data.page) return;
      if (data.payload) setPlayerTarget({ ...data.payload, ts: Date.now() });
      navigate(data.page);
    });
  }, []);

  // 快捷键 Cmd/Ctrl + K 聚焦全局搜索框
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
        setSearchPopoverOpen(true);
      } else if (e.key === 'Escape') {
        setSourcePopoverOpen(false);
        setSearchPopoverOpen(false);
        setAccountModalOpen(false);
      }
    };
    window.addEventListener?.('keydown', handleKeyDown);
    return () => window.removeEventListener?.('keydown', handleKeyDown);
  }, []);

  // 点击外部关闭弹窗
  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (sourcePopoverRef.current && !sourcePopoverRef.current.contains(e.target)) {
        setSourcePopoverOpen(false);
      }
      if (searchInputRef.current && !searchInputRef.current.contains(e.target) && !e.target.closest?.('.global-search-container')) {
        setSearchPopoverOpen(false);
      }
    };
    if (typeof document !== 'undefined') document.addEventListener?.('mousedown', handleOutsideClick);
    return () => { if (typeof document !== 'undefined') document.removeEventListener?.('mousedown', handleOutsideClick); };
  }, []);

  // 监听正文滚动显示面包屑
  useEffect(() => {
    const activeMain = typeof document !== 'undefined' ? document.querySelector?.(`.main-content[data-page="${page}"]`) : null;
    if (!activeMain) return;
    const handleScroll = () => {
      setScrolledPastTitle(activeMain.scrollTop > 50);
    };
    activeMain.addEventListener?.('scroll', handleScroll, { passive: true });
    setScrolledPastTitle(activeMain.scrollTop > 50);
    return () => activeMain.removeEventListener?.('scroll', handleScroll);
  }, [page]);

  const navigate = (nextPage) => {
    setMoreOpen(false);
    if (!isNavigatingRef.current && nextPage !== pageRef.current) {
      setHistoryStack(prev => {
        const sliced = prev.slice(0, historyIndex + 1);
        return [...sliced, nextPage];
      });
      setHistoryIndex(prev => prev + 1);
    }
    if (nextPage !== pageRef.current) {
      calendarRequest.current++;
      calendarOpeningRef.current = false;
      setCalendarOpening('');
      pageRef.current = nextPage;
    }
    if (nextPage === 'player' || (nextPage === 'feed' && !floatingPlayer.current)) {
      setPlayerMounted(nextPage === 'player');
    }
    setVisited((pages) => pages.includes(nextPage) ? pages : [...pages, nextPage]);
    setPage(nextPage);
  };

  const goBack = () => {
    if (historyIndex > 0) {
      isNavigatingRef.current = true;
      const targetPage = historyStack[historyIndex - 1];
      setHistoryIndex(historyIndex - 1);
      navigate(targetPage);
      isNavigatingRef.current = false;
    }
  };

  const goForward = () => {
    if (historyIndex < historyStack.length - 1) {
      isNavigatingRef.current = true;
      const targetPage = historyStack[historyIndex + 1];
      setHistoryIndex(historyIndex + 1);
      navigate(targetPage);
      isNavigatingRef.current = false;
    }
  };

  // 全局搜索与链接解析逻辑
  const handleSearchInputChange = (e) => {
    const val = e.target.value;
    setSearchQuery(val);
    setSearchPopoverOpen(true);
    const trimmed = val.trim();
    // 识别 URL 或 16-30 位纯数字 ID 或分享指令
    const isUrl = /^https?:\/\/[^\s]+/.test(trimmed);
    const isNumberId = /^\d{6,30}$/.test(trimmed);
    const isShareToken = /#[A-Za-z0-9+/=]+/.test(trimmed) || (trimmed.length >= 10 && trimmed.includes('hongguo'));
    if (isUrl || isNumberId || isShareToken) {
      setSmartLink({ raw: trimmed, type: isUrl ? 'url' : isNumberId ? 'id' : 'token' });
    } else {
      setSmartLink(null);
    }
  };

  const handleResolveSmartLink = async (targetValue) => {
    const val = targetValue || smartLink?.raw || searchQuery.trim();
    if (!val) return;
    setSearchBusy(true);
    setSearchPopoverOpen(false);
    try {
      const res = await window.electronAPI.searchResolve(val);
      if (res?.success && res.data) {
        setPlayerTarget({ seriesId: res.data.series_id, resume: true, ts: Date.now() });
        navigate('player');
        setSearchQuery('');
        setSmartLink(null);
      } else {
        throw new Error(res?.error || '无法解析该链接，请确认链接格式。');
      }
    } catch (err) {
      setStorageError(err.message || '链接解析失败');
    } finally {
      setSearchBusy(false);
    }
  };

  const handleSearchSubmit = (e) => {
    if (e) e.preventDefault();
    if (!searchQuery.trim()) return;
    if (smartLink) {
      handleResolveSmartLink();
      return;
    }
    setSearchPopoverOpen(false);
    // 普通文字搜索 -> 打开搜索下载页
    navigate('download');
  };

  const handleSwitchChannel = (channel) => {
    setGlobalChannel(channel);
    try { localStorage.setItem(CATALOG_CHANNEL_KEY, channel); } catch (_) {}
    window.dispatchEvent(new CustomEvent('catalog-channel-changed', { detail: channel }));
  };

  const handleSwitchSource = (sourceId) => {
    setGlobalSource(sourceId);
    window.dispatchEvent(new CustomEvent('media-source-changed', { detail: sourceId }));
  };

  const handleRefreshCatalog = () => {
    setSourcePopoverOpen(false);
    window.dispatchEvent(new Event('refresh-catalog-list'));
  };

  const handleToggleTheme = () => {
    const next = toggleThemePreference();
    setThemeMode(next);
  };

  const renderPage = (id) => {
    switch (id) {
      case 'browse':
        return <Browse active={page === id} onNavigate={navigate} />;
      case 'player':
        return playerMounted ? (
          <Player
            portrait={layout === 'portrait'}
            episodesOpen={episodesOpen}
            setEpisodesOpen={setEpisodesOpen}
            actionsHidden={actionsHidden || (borderless && layout === 'portrait')}
            active={page === id}
            target={playerTarget}
            onSeriesSelected={rememberPlayerSeries}
            onFloatingChange={setFloatingPlayer}
            onNavigate={navigate}
          />
        ) : null;
      case 'feed':
        return page === 'feed' ? <DramaFeed onNavigate={navigate} /> : null;
      case 'calendar':
        return (
          <ReleaseCalendar
            opening={calendarOpening}
            active={page === id}
            onPlay={async ({ seriesId }) => {
              if (pageRef.current !== 'calendar' || calendarOpeningRef.current) return;
              const version = ++calendarRequest.current;
              calendarOpeningRef.current = true;
              setCalendarOpening(seriesId);
              try {
                const payload = { seriesId, resume: true };
                let result = await window.electronAPI.playSeries(payload);
                if (version !== calendarRequest.current) return;
                if (!result?.success && result?.code === 'SERIES_NOT_FOUND') {
                  const resolved = await window.electronAPI.searchResolve(seriesId);
                  if (version !== calendarRequest.current) return;
                  if (!resolved?.success) throw new Error(resolved?.error || '加载剧集失败，请重试');
                  result = await window.electronAPI.playSeries(payload);
                }
                if (!result?.success) throw new Error(result?.error || '打开播放失败，请重试');
              } catch (error) {
                if (version === calendarRequest.current) setStorageError(error.message);
              } finally {
                if (version === calendarRequest.current) {
                  calendarOpeningRef.current = false;
                  setCalendarOpening('');
                }
              }
            }}
          />
        );
      case 'history':
        return <WatchHistory active={page === id} onNavigate={navigate} />;
      case 'account':
        return <AccountManagement active={page === id} inModal={false} onNavigate={navigate} />;
      case 'manager':
        return <DownloadManager active={page === id} onNavigate={navigate} />;
      case 'settings':
        if (platformPages.settings) return React.createElement(platformPages.settings, { active: page === id, appInfo });
        return <SettingsPage active={page === id} preview={appInfo?.preview} appInfo={appInfo} wakeRegionFocus={wakeRegionFocus} />;
      case 'download':
      default:
        return <HongguoDownload active={page === id} onNavigate={navigate} />;
    }
  };

  const toggleLayout = async () => {
    if (layoutLock.current) return;
    layoutLock.current = true;
    setLayoutBusy(true);
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      const mode = layout === 'portrait' ? 'landscape' : 'portrait';
      const result = await window.electronAPI.setWindowLayout(mode);
      if (!result.success) throw new Error(result.error);
      setLayout(result.mode);
    } catch (error) {
      setStorageError(error.message || '切换失败，请重试。');
    } finally {
      layoutLock.current = false;
      setLayoutBusy(false);
    }
  };

  const isMac = appInfo?.platform === 'darwin' || (!appInfo?.platform && /Mac/.test(navigator.platform));
  const currentPageItem = ALL_PAGES.find(item => item.id === page);
  const currentSourceName = mediaSources.find(s => s.id === globalSource)?.label || '短剧官方';

  return (
    <div className={`app-layout ${mobile ? 'platform-android' : ''} ${stealthMode ? 'stealth-mode' : ''} ${isMac ? 'platform-mac' : ''} layout-${layout} ${page === 'player' ? 'player-focused' : ''} ${borderless && page === 'player' && layout === 'portrait' ? 'player-borderless' : ''}`}>
      {/* 3.1 左侧边栏（宽 210px，结构化分组） */}
      <aside className="sidebar" aria-label={t("主导航")}>
        <div className="sidebar-window-drag" aria-hidden="true" />
        <div className="sidebar-brand">
          <div className="logo"><Play size={20} /></div>
          <div>
            <div className="brand-text">{t(appInfo?.appName || '牛油果短剧')}</div>
            <div className="brand-sub">{t('每一集，都值得期待')}</div>
          </div>
        </div>

        <nav className="sidebar-menu">
          {/* 分组 1 · 探索 */}
          <div className="sidebar-group-label">{t("探索")}</div>
          {EXPLORE_MENU.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={`sidebar-item ${page === item.id ? 'active' : ''}`}
                aria-current={page === item.id ? 'page' : undefined}
                onClick={() => navigate(item.id)}
              >
                <Icon size={18} />
                <span>{t(item.label)}</span>
              </button>
            );
          })}

          {/* 分组 2 · 我的 */}
          <div className="sidebar-group-label sidebar-group-mt">{t("我的")}</div>
          {MY_MENU.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={`sidebar-item ${page === item.id ? 'active' : ''}`}
                aria-current={page === item.id ? 'page' : undefined}
                onClick={() => navigate(item.id)}
              >
                <Icon size={18} />
                <span>{t(item.label)}</span>
                {item.id === 'manager' && activeDownloads > 0 && (
                  <span className="sidebar-badge" title={t(`正在下载 ${activeDownloads} 个任务`)}>{activeDownloads}</span>
                )}
              </button>
            );
          })}
        </nav>

        {/* 底部固定区：紧凑账号卡片 + 设置 + 浅/深色切换 + 版本号 */}
        <div className="sidebar-footer">
          <div
            className="sidebar-account-card"
            onClick={() => setAccountModalOpen(true)}
            role="button"
            tabIndex={0}
            title={t(accountStatus ? `已登录：${accountStatus.nickname || '短剧用户'}` : '点击登录官方账号')}
          >
            <div className="account-avatar-mini">
              <User size={15} />
            </div>
            <div className="account-meta-mini">
              <span className="account-name-mini">{accountStatus?.nickname || t('短剧账号')}</span>
              <span className={`account-badge-mini ${accountStatus ? 'signed-in' : ''}`}>
                {accountStatus ? t('已登录') : t('未登录')}
              </span>
            </div>
          </div>

          <div className="sidebar-footer-actions">
            <button
              key="settings"
              className={`sidebar-item sidebar-footer-btn ${page === 'settings' ? 'active' : ''}`}
              aria-current={page === 'settings' ? 'page' : undefined}
              onClick={() => navigate('settings')}
              title={t("设置")}
            >
              <Settings size={18} />
              <span>{t("设置")}</span>
            </button>
            <button
              className="icon-btn theme-quick-toggle"
              onClick={handleToggleTheme}
              title={t(themeMode === 'dark' ? '切换为浅色模式' : '切换为深色模式')}
              aria-label={t("切换主题")}
            >
              {themeMode === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
            </button>
          </div>

          <div className="footer-note">
            <span>{t(appInfo?.appName || '牛油果短剧')}</span>
            <span>{t(appInfo?.version ? `v${appInfo.version}` : 'v7.9.0')}</span>
          </div>
        </div>
      </aside>

      {/* 主界面区域 */}
      <div className="main-wrapper">
        {/* 3.2 顶部标题栏（高 52px，单行整合） */}
        <header className="window-toolbar">
          {/* 左侧：前进/后退历史导航 + 滚动面包屑 */}
          <div className="toolbar-left-group">
            <div className="toolbar-nav-history">
              <button
                className="icon-btn toolbar-history-btn"
                disabled={historyIndex <= 0}
                onClick={goBack}
                title={t("后退")}
                aria-label={t("后退")}
              >
                <ArrowLeft size={16} />
              </button>
              <button
                className="icon-btn toolbar-history-btn"
                disabled={historyIndex >= historyStack.length - 1}
                onClick={goForward}
                title={t("前进")}
                aria-label={t("前进")}
              >
                <ArrowRight size={16} />
              </button>
            </div>
            {scrolledPastTitle && (
              <span className="toolbar-breadcrumb" aria-hidden="true">
                {t(currentPageItem?.label || '')}
              </span>
            )}
          </div>

          {/* 居中：全局搜索与链接智能解析框 */}
          <div className="global-search-container">
            <form onSubmit={handleSearchSubmit} className="global-search-form">
              <Search size={15} className="global-search-icon" />
              <input
                ref={searchInputRef}
                type="text"
                className="global-search-input"
                placeholder={t("搜索短剧，或直接粘贴播放链接 / 口令… (⌘K)")}
                value={searchQuery}
                onChange={handleSearchInputChange}
                onFocus={() => setSearchPopoverOpen(true)}
              />
              {searchQuery && (
                <button
                  type="button"
                  className="icon-btn global-search-clear"
                  onClick={() => { setSearchQuery(''); setSmartLink(null); }}
                  aria-label={t("清除")}
                >
                  <X size={14} />
                </button>
              )}
            </form>

            {/* 智能解析快捷操作浮窗 */}
            {searchPopoverOpen && (smartLink || searchQuery.trim()) && (
              <div className="global-search-popover">
                {smartLink && (
                  <div className="smart-link-action" onClick={() => handleResolveSmartLink()}>
                    <div className="smart-link-icon"><Zap size={16} /></div>
                    <div className="smart-link-content">
                      <div className="smart-link-title">{t("⚡️ 智能识别：检测到短剧分享链接 / 剧集 ID")}</div>
                      <div className="smart-link-desc">{smartLink.raw.length > 55 ? `${smartLink.raw.slice(0, 55)}…` : smartLink.raw}</div>
                    </div>
                    <button className="btn btn-primary btn-sm" disabled={searchBusy}>
                      {t(searchBusy ? '解析中…' : '立即解析播放')}
                    </button>
                  </div>
                )}
                <div className="search-submit-hint" onClick={handleSearchSubmit}>
                  <Search size={14} />
                  <span>{t("按 Enter 键全局搜索短剧库：“")}{searchQuery.trim()}{t("”")}</span>
                </div>
              </div>
            )}
          </div>

          {/* 右侧工具组：全局片源切换 Popover + 置顶 + 竖屏版 */}
          <div className="toolbar-actions">
            {/* 全局片源切换 Popover */}
            <div className="global-source-wrapper" ref={sourcePopoverRef}>
              <button
                className="btn btn-outline btn-sm global-source-btn"
                aria-expanded={sourcePopoverOpen}
                onClick={() => setSourcePopoverOpen(v => !v)}
                title={t("切换片源与目录线路")}
              >
                <Globe size={14} />
                <span className="source-label-text">{t(currentSourceName)}</span>
                <span className="channel-tag">{t(globalChannel === 'web' ? '官网' : 'App')}</span>
                <ChevronDown size={13} className={`chevron-icon ${sourcePopoverOpen ? 'open' : ''}`} />
              </button>

              {sourcePopoverOpen && (
                <div className="global-source-popover">
                  <div className="popover-section-title">{t("短剧片源")}</div>
                  <div className="source-options-grid">
                    {mediaSources.map(s => (
                      <button
                        key={s.id}
                        className={`source-chip-option ${globalSource === s.id ? 'active' : ''}`}
                        onClick={() => { handleSwitchSource(s.id); setSourcePopoverOpen(false); }}
                      >
                        {t(s.label)}
                      </button>
                    ))}
                  </div>

                  {globalSource === 'hongguo' && (
                    <>
                      <div className="popover-section-title popover-mt">{t("目录线路")}</div>
                      <div className="channel-toggle-row">
                        <button
                          className={`channel-chip-btn ${globalChannel === 'app' ? 'active' : ''}`}
                          onClick={() => handleSwitchChannel('app')}
                        >
                          {t("App 线路（快速）")}
                        </button>
                        <button
                          className={`channel-chip-btn ${globalChannel === 'web' ? 'active' : ''}`}
                          onClick={() => handleSwitchChannel('web')}
                        >
                          {t("官网线路（完整）")}
                        </button>
                      </div>
                    </>
                  )}

                  <div className="popover-footer-actions">
                    <button className="btn btn-outline btn-sm" onClick={handleRefreshCatalog}>
                      <RefreshCw size={13} />{t("刷新片单")}
                    </button>
                    <button
                      className="btn btn-outline btn-sm"
                      onClick={() => {
                        window.electronAPI.openExternal?.('https://hongguoduanju.com');
                        setSourcePopoverOpen(false);
                      }}
                    >
                      <ExternalLink size={13} />{t("打开来源官网")}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* 小窗模式 (仅播放页可用) */}
            {!mobile && page === 'player' && (
              <button
                className="btn btn-outline btn-sm"
                onClick={() => { setEpisodesOpen(false); toggleStealth(true); }}
                title={t("小窗置顶播放并在支持的系统上跨虚拟桌面可见；鼠标移开时暂停隐藏，移回继续；Esc 退出")}
              >
                {t("小窗模式")}
              </button>
            )}

            {/* 窗口置顶按钮 */}
            <button
              className="btn btn-outline btn-sm pin-toggle"
              aria-pressed={alwaysOnTop}
              disabled={pinBusy}
              aria-label={t(alwaysOnTop ? '取消置顶' : '置顶')}
              title={t(alwaysOnTop ? '取消窗口置顶' : '窗口置顶')}
              onClick={async () => {
                setPinBusy(true);
                try { setAlwaysOnTop(await window.electronAPI.setAlwaysOnTop(!alwaysOnTop)); }
                catch { setStorageError('置顶切换失败，请重试。'); }
                finally { setPinBusy(false); }
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill={alwaysOnTop ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M8 3h8l-1 6 4 4v2H5v-2l4-4-1-6Z" />
                <path d="M12 15v6" />
              </svg>
            </button>

            {/* 竖屏版切换按钮 */}
            <button
              className="btn btn-outline btn-sm layout-toggle"
              onClick={toggleLayout}
              disabled={layoutBusy}
              aria-pressed={layout === 'portrait'}
              aria-label={t(layout === 'portrait' ? '切换横屏版' : '切换竖屏版')}
              title={t(layout === 'portrait' ? '恢复横屏窗口与布局' : '切换竖屏窗口，放大竖屏视频')}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
                {layout === 'portrait' ? <rect x="3" y="6" width="18" height="12" rx="2" /> : <rect x="6" y="3" width="12" height="18" rx="2" />}
              </svg>
              {t(layoutBusy ? '切换中…' : layout === 'portrait' ? '横屏版' : '竖屏版')}
            </button>
          </div>
        </header>

        {/* 竖屏单行胶囊导航 */}
        <nav className="compact-navigation" aria-label={t("竖屏导航")}>
          {[...EXPLORE_MENU, ...MY_MENU].map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                aria-current={page === item.id ? 'page' : undefined}
                onClick={() => navigate(item.id)}
                title={t(item.label)}
              >
                <Icon size={16} />
                <span>{t(item.label)}</span>
              </button>
            );
          })}
        </nav>

        {!mobile && !appInfo?.preview && <AppUpdateNotice />}
        {!mobile && !appInfo?.preview && <AnnouncementNotice />}

        {stealthMode && (
          <div className="stealth-toolbar">
            <span>{t("移开暂停隐藏 · 移回继续")}</span>
            <div className="stealth-toolbar-actions">
              <button className="btn btn-outline btn-sm" disabled={wakeSettingsOpening} onClick={async () => {
                if (wakeSettingsOpening) return;
                setWakeSettingsOpening(true);
                try {
                  const result = await window.electronAPI.setStealthMode(false);
                  if (!result?.success) throw new Error(result?.error || '小窗切换失败，请重试');
                  setWakeRegionFocus(value => value + 1);
                  navigate('settings');
                } catch (error) { setStorageError(error.message || '小窗切换失败，请重试'); }
                finally { setWakeSettingsOpening(false); }
              }}>{t('设置唤醒区域')}</button>
              <button className="btn btn-outline btn-sm" disabled={wakeSettingsOpening} onClick={() => toggleStealth(false)}>{t("退出小窗")}</button>
            </div>
          </div>
        )}

        {stealthError && <div className="app-storage-error" role="alert">{t(stealthError)}</div>}
        {storageError && (
          <div className="app-storage-error" role="alert">
            <span>{t(storageError)}</span>
            <button className="btn btn-outline btn-sm" onClick={() => setStorageError('')}>{t("关闭提示")}</button>
          </div>
        )}

        {visited.map((id) => (
          <main className="main-content" data-page={id} hidden={page !== id} key={id}>
            {t(renderPage(id))}
          </main>
        ))}
      </div>

      {/* 4.5 账号管理居中弹窗 Modal */}
      {accountModalOpen && (
        <div className="modal-backdrop" onClick={() => setAccountModalOpen(false)}>
          <div className="modal-dialog account-modal-dialog" onClick={e => e.stopPropagation()}>
            <div className="modal-dialog-header">
              <div className="modal-dialog-title">
                <User size={18} />
                <span>{t("短剧账号管理")}</span>
              </div>
              <button className="icon-btn modal-close-btn" onClick={() => setAccountModalOpen(false)} aria-label={t("关闭")}>
                <X size={16} />
              </button>
            </div>
            <div className="modal-dialog-body">
              <AccountManagement
                active={true}
                inModal={true}
                onClose={() => setAccountModalOpen(false)}
                onNavigate={navigate}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
