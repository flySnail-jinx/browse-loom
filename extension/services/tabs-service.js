/* BrowseLoom tabs service.
   Isolates chrome.tabs/chrome.windows/tabGroups calls and pure tab rules. */
(function (global) {
  'use strict';

  const BROWSER_NEWTAB_URLS = [
    'chrome://newtab/',
    'edge://newtab/',
    'brave://newtab/',
    'about:newtab',
  ];

  const CHROME_GROUP_COLORS = new Set([
    'grey',
    'blue',
    'red',
    'yellow',
    'green',
    'pink',
    'purple',
    'cyan',
    'orange',
  ]);

  const QUICK_RETURN_ROUTE_KEY = 'quickReturnRoute';

  const DOMAIN_SORT_MODES = new Set(['stable', 'chrome', 'count', 'name']);

  function getChromeApi() {
    return global.chrome || null;
  }

  function extensionNewTabUrl(extensionId) {
    return extensionId ? `chrome-extension://${extensionId}/index.html` : '';
  }

  function isBrowserNewTabUrl(url) {
    return BROWSER_NEWTAB_URLS.includes(url || '');
  }

  function isExtensionPageUrl(url, extensionId) {
    if (!url || !extensionId) return false;
    return url.startsWith(`chrome-extension://${extensionId}/`);
  }

  function isDashboardTab(tab, extensionId) {
    if (!tab?.url || !extensionId) return false;
    const dashboardUrl = extensionNewTabUrl(extensionId);
    return (
      isBrowserNewTabUrl(tab.url) ||
      tab.url === dashboardUrl ||
      tab.url.startsWith(`${dashboardUrl}?`) ||
      tab.url.startsWith(`${dashboardUrl}#`)
    );
  }

  function isInternalUrl(url, extensionId) {
    if (!url) return true;
    return (
      url.startsWith('chrome://') ||
      url.startsWith('chrome-extension://') ||
      url.startsWith('about:') ||
      url.startsWith('edge://') ||
      url.startsWith('brave://') ||
      isExtensionPageUrl(url, extensionId)
    );
  }

  function isRealTab(tab, extensionId) {
    return !!tab && tab.pinned !== true && !isInternalUrl(tab.url || '', extensionId);
  }

  function normalizeDomainSortMode(value) {
    return DOMAIN_SORT_MODES.has(value) ? value : 'stable';
  }

  function reconcileDomainCardOrder(order, domainKeys) {
    const current = Array.isArray(order)
      ? order.filter((key, index, items) => typeof key === 'string' && key && items.indexOf(key) === index)
      : [];
    const seen = new Set(current);
    for (const key of domainKeys || []) {
      if (typeof key !== 'string' || !key || seen.has(key)) continue;
      current.push(key);
      seen.add(key);
    }
    return current;
  }

  function reorderDomainCardOrder(order, visibleDomainKeys, draggedKey, targetKey, position = 'before') {
    const visible = reconcileDomainCardOrder([], visibleDomainKeys);
    if (!visible.includes(draggedKey) || !visible.includes(targetKey) || draggedKey === targetKey) {
      return reconcileDomainCardOrder(order, visible);
    }

    const reordered = visible.filter(key => key !== draggedKey);
    const targetIndex = reordered.indexOf(targetKey);
    const insertIndex = targetIndex + (position === 'after' ? 1 : 0);
    reordered.splice(insertIndex, 0, draggedKey);

    const current = reconcileDomainCardOrder(order, visible);
    const visibleSet = new Set(visible);
    let visibleIndex = 0;
    return current.map(key => visibleSet.has(key) ? reordered[visibleIndex++] : key);
  }

  function sortDomainGroups(groups, preferences = {}, options = {}) {
    const sortMode = normalizeDomainSortMode(preferences.sortMode);
    const order = reconcileDomainCardOrder(preferences.order, (groups || []).map(group => group.domain));
    const orderMap = new Map(order.map((key, index) => [key, index]));
    const pinned = new Set(Array.isArray(preferences.pinned) ? preferences.pinned : []);
    const locale = options.locale || 'en';
    const getLabel = typeof options.getLabel === 'function'
      ? options.getLabel
      : group => group.label || group.domain || '';

    function stableRank(group) {
      return orderMap.get(group.domain) ?? Number.MAX_SAFE_INTEGER;
    }

    function compareChromePosition(a, b) {
      const aPosition = Number.isFinite(a.firstTabPosition) ? a.firstTabPosition : Number.MAX_SAFE_INTEGER;
      const bPosition = Number.isFinite(b.firstTabPosition) ? b.firstTabPosition : Number.MAX_SAFE_INTEGER;
      return aPosition - bPosition;
    }

    return [...(groups || [])].sort((a, b) => {
      const aPinned = pinned.has(a.domain);
      const bPinned = pinned.has(b.domain);
      if (aPinned !== bPinned) return aPinned ? -1 : 1;

      let result = 0;
      if (sortMode === 'chrome') {
        result = compareChromePosition(a, b);
      } else if (sortMode === 'count') {
        result = (b.tabs?.length || 0) - (a.tabs?.length || 0);
      } else if (sortMode === 'name') {
        result = String(getLabel(a)).localeCompare(String(getLabel(b)), locale, { sensitivity: 'base' });
      }

      return result || stableRank(a) - stableRank(b);
    });
  }

  function normalizeRestorableUrl(url) {
    if (global.SuperTabOutUrls?.normalizeRestorableUrl) {
      return global.SuperTabOutUrls.normalizeRestorableUrl(url);
    }
    return '';
  }

  function normalizeTab(tab, extensionId) {
    const url = tab.url || '';
    const newtabUrl = extensionNewTabUrl(extensionId);
    return {
      id: tab.id,
      url,
      title: tab.title,
      windowId: tab.windowId,
      active: tab.active,
      pinned: tab.pinned,
      groupId: typeof tab.groupId === 'number' ? tab.groupId : -1,
      index: tab.index,
      isTabOut: url === newtabUrl || isBrowserNewTabUrl(url),
    };
  }

  async function fetchOpenTabs() {
    const chromeApi = getChromeApi();
    if (!chromeApi?.tabs) return [];
    const extensionId = chromeApi.runtime?.id || '';
    const tabs = await chromeApi.tabs.query({});
    return tabs.map(tab => normalizeTab(tab, extensionId));
  }

  async function fetchTabGroups() {
    const chromeApi = getChromeApi();
    if (!chromeApi?.tabGroups) return [];
    try {
      return await chromeApi.tabGroups.query({});
    } catch {
      return [];
    }
  }

  function exactUnpinnedIdsForUrls(tabs, urls) {
    const urlSet = new Set(urls || []);
    return (tabs || [])
      .filter(tab => !tab.pinned && urlSet.has(tab.url))
      .map(tab => tab.id);
  }

  async function closeTabsByUrls(urls) {
    const chromeApi = getChromeApi();
    if (!chromeApi?.tabs || !urls || urls.length === 0) return [];
    const tabs = await chromeApi.tabs.query({});
    const toClose = exactUnpinnedIdsForUrls(tabs, urls);
    if (toClose.length > 0) await chromeApi.tabs.remove(toClose);
    return toClose;
  }

  async function closeTabsByIds(ids) {
    const chromeApi = getChromeApi();
    if (!chromeApi?.tabs || !ids || ids.length === 0) return [];
    const idSet = new Set(ids);
    const tabs = await chromeApi.tabs.query({});
    const toClose = tabs
      .filter(tab => idSet.has(tab.id) && !tab.pinned)
      .map(tab => tab.id);
    if (toClose.length > 0) await chromeApi.tabs.remove(toClose);
    return toClose;
  }

  async function prepareBulkClose(tabIds, options = {}) {
    const chromeApi = getChromeApi();
    if (!chromeApi?.tabs || !Array.isArray(tabIds) || tabIds.length === 0) {
      return { requestedCount: 0, count: 0, protectedPinned: 0, protectedInternal: 0, snapshot: { version: 1, tabs: [] } };
    }

    const requestedIds = new Set(tabIds.map(Number).filter(Number.isFinite));
    const extensionId = chromeApi.runtime?.id || '';
    const allTabs = await chromeApi.tabs.query({});
    const selectedTabs = allTabs.filter(tab => requestedIds.has(Number(tab.id)));
    const groupMap = new Map();
    if (chromeApi.tabGroups) {
      try {
        const groups = await chromeApi.tabGroups.query({});
        groups.forEach(group => groupMap.set(group.id, group));
      } catch {}
    }

    const protectedPinned = selectedTabs.filter(tab => tab.pinned === true).length;
    const allowDashboard = options.allowDashboard === true;
    const isAllowedInternal = tab => allowDashboard && isDashboardTab(tab, extensionId);
    const protectedInternal = selectedTabs.filter(tab => tab.pinned !== true && isInternalUrl(tab.url || '', extensionId) && !isAllowedInternal(tab)).length;
    const tabs = selectedTabs
      .filter(tab => tab.pinned !== true && (!isInternalUrl(tab.url || '', extensionId) || isAllowedInternal(tab)))
      .map(tab => {
        const url = isAllowedInternal(tab) ? (tab.url || '') : normalizeRestorableUrl(tab.url || '');
        if (!url) return null;
        const group = Number.isFinite(tab.groupId) && tab.groupId >= 0 ? groupMap.get(tab.groupId) : null;
        return {
          id: tab.id,
          url,
          title: typeof tab.title === 'string' ? tab.title : url,
          windowId: tab.windowId,
          index: Number.isFinite(Number(tab.index)) ? Number(tab.index) : 0,
          active: tab.active === true,
          pinned: false,
          incognito: tab.incognito === true,
          groupId: group?.id ?? -1,
          groupKey: group ? `${tab.windowId}:${group.id}` : '',
          groupTitle: typeof group?.title === 'string' ? group.title : '',
          groupColor: CHROME_GROUP_COLORS.has(group?.color) ? group.color : '',
          groupCollapsed: group?.collapsed === true,
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.windowId - b.windowId || a.index - b.index);

    return {
      requestedCount: requestedIds.size,
      count: tabs.length,
      protectedPinned,
      protectedInternal,
      snapshot: { version: 1, createdAt: new Date().toISOString(), tabs },
    };
  }

  async function closeTabsWithSnapshot(tabIds, options = {}) {
    const chromeApi = getChromeApi();
    const plan = await prepareBulkClose(tabIds, options);
    if (!chromeApi?.tabs || plan.count === 0) {
      return { ...plan, closedCount: 0, failedCount: plan.count };
    }

    const closedIds = new Set();
    for (const tab of plan.snapshot.tabs) {
      try {
        await chromeApi.tabs.remove(tab.id);
        closedIds.add(tab.id);
      } catch {
        // A tab may disappear after confirmation. Keep closing the rest.
      }
    }

    const closedTabs = plan.snapshot.tabs.filter(tab => closedIds.has(tab.id));
    return {
      ...plan,
      count: closedTabs.length,
      closedCount: closedTabs.length,
      failedCount: plan.snapshot.tabs.length - closedTabs.length,
      snapshot: { ...plan.snapshot, tabs: closedTabs },
    };
  }

  async function restoreClosedTabs(snapshot) {
    const chromeApi = getChromeApi();
    const sourceTabs = Array.isArray(snapshot?.tabs) ? snapshot.tabs : [];
    if (!chromeApi?.tabs || !chromeApi?.windows || sourceTabs.length === 0) {
      return { restoredCount: 0, failedCount: sourceTabs.length, groupCount: 0, groupFailedCount: 0, windowCount: 0 };
    }

    const windows = new Map();
    sourceTabs.forEach(tab => {
      if (!windows.has(tab.windowId)) windows.set(tab.windowId, []);
      windows.get(tab.windowId).push(tab);
    });

    const restoredPairs = [];
    let failedCount = 0;
    let windowCount = 0;

    for (const [originalWindowId, windowTabs] of windows) {
      const orderedTabs = [...windowTabs].sort((a, b) => a.index - b.index);
      let targetWindowId = originalWindowId;
      let windowExists = false;
      try {
        if (chromeApi.windows.get) {
          const existingWindow = await chromeApi.windows.get(originalWindowId);
          windowExists = existingWindow?.id != null;
        } else {
          await chromeApi.tabs.query({ windowId: originalWindowId });
          windowExists = true;
        }
      } catch {}

      if (!windowExists) {
        const first = orderedTabs.shift();
        try {
          const createdWindow = await chromeApi.windows.create({
            ...(!isBrowserNewTabUrl(first.url) ? { url: first.url } : {}),
            focused: false,
            ...(first.incognito ? { incognito: true } : {}),
          });
          targetWindowId = createdWindow?.id;
          const createdTab = createdWindow?.tabs?.find(tab => tab?.id != null)
            || (Number.isFinite(Number(targetWindowId)) ? (await chromeApi.tabs.query({ windowId: targetWindowId }))[0] : null);
          if (!createdTab?.id || !Number.isFinite(Number(targetWindowId))) throw new Error('restore-window-failed');
          restoredPairs.push({ source: first, restored: createdTab, windowId: targetWindowId });
          windowCount += 1;
        } catch {
          failedCount += orderedTabs.length + 1;
          continue;
        }
      }

      for (const source of orderedTabs) {
        try {
          const restored = await chromeApi.tabs.create({
            ...(!isBrowserNewTabUrl(source.url) ? { url: source.url } : {}),
            windowId: targetWindowId,
            active: false,
            index: Math.max(0, source.index),
            pinned: source.pinned === true,
          });
          restoredPairs.push({ source, restored, windowId: targetWindowId });
        } catch {
          failedCount += 1;
        }
      }
    }

    const groups = new Map();
    restoredPairs.forEach(pair => {
      if (!pair.source.groupKey || !pair.restored?.id) return;
      const key = `${pair.windowId}:${pair.source.groupKey}`;
      if (!groups.has(key)) groups.set(key, { source: pair.source, tabIds: [] });
      groups.get(key).tabIds.push(pair.restored.id);
    });

    let groupCount = 0;
    let groupFailedCount = 0;
    for (const group of groups.values()) {
      try {
        const groupId = await chromeApi.tabs.group({ tabIds: group.tabIds });
        const update = {};
        if (group.source.groupTitle) update.title = group.source.groupTitle;
        if (CHROME_GROUP_COLORS.has(group.source.groupColor)) update.color = group.source.groupColor;
        update.collapsed = group.source.groupCollapsed === true;
        if (chromeApi.tabGroups && Object.keys(update).length > 0) await chromeApi.tabGroups.update(groupId, update);
        groupCount += 1;
      } catch {
        // Tabs are still restored even if Chrome refuses to rebuild a group.
        groupFailedCount += 1;
      }
    }

    for (const pair of restoredPairs.filter(item => item.source.active)) {
      try { await chromeApi.tabs.update(pair.restored.id, { active: true }); } catch {}
    }

    return {
      restoredCount: restoredPairs.length,
      failedCount,
      groupCount,
      groupFailedCount,
      windowCount,
    };
  }

  async function focusTab(url) {
    const chromeApi = getChromeApi();
    if (!chromeApi?.tabs || !chromeApi?.windows || !url) return null;
    const allTabs = await chromeApi.tabs.query({});
    const currentWindow = await chromeApi.windows.getCurrent();

    let matches = allTabs.filter(tab => tab.url === url);
    if (matches.length === 0) {
      try {
        const targetHost = new URL(url).hostname;
        matches = allTabs.filter(tab => {
          try { return new URL(tab.url).hostname === targetHost; }
          catch { return false; }
        });
      } catch {}
    }

    if (matches.length === 0) return null;

    const match = matches.find(tab => tab.windowId !== currentWindow.id) || matches[0];
    await chromeApi.tabs.update(match.id, { active: true });
    await chromeApi.windows.update(match.windowId, { focused: true });
    return match;
  }

  async function focusTabById(tabId) {
    const chromeApi = getChromeApi();
    if (tabId == null || tabId === '') return null;
    const numericTabId = Number(tabId);
    if (!chromeApi?.tabs || !chromeApi?.windows || !Number.isFinite(numericTabId)) return null;

    try {
      const tab = await chromeApi.tabs.get(numericTabId);
      if (!tab?.id || tab.windowId == null) return null;
      await chromeApi.tabs.update(tab.id, { active: true });
      await chromeApi.windows.update(tab.windowId, { focused: true });
      return tab;
    } catch {
      return null;
    }
  }

  function normalizeQuickReturnRoute(route) {
    const dashboardTabId = Number(route?.dashboardTabId);
    const targetTabId = Number(route?.targetTabId);
    if (!Number.isFinite(dashboardTabId) || !Number.isFinite(targetTabId)) return null;
    return {
      dashboardTabId,
      targetTabId,
      dashboardWindowId: Number.isFinite(Number(route?.dashboardWindowId)) ? Number(route.dashboardWindowId) : null,
      targetWindowId: Number.isFinite(Number(route?.targetWindowId)) ? Number(route.targetWindowId) : null,
    };
  }

  async function getQuickReturnRoute() {
    const area = getChromeApi()?.storage?.session;
    if (!area) return null;
    try {
      const data = await area.get(QUICK_RETURN_ROUTE_KEY);
      return normalizeQuickReturnRoute(data?.[QUICK_RETURN_ROUTE_KEY]);
    } catch {
      return null;
    }
  }

  async function rememberQuickReturnRoute(dashboardTab, targetTab) {
    const chromeApi = getChromeApi();
    const area = chromeApi?.storage?.session;
    const extensionId = chromeApi?.runtime?.id || '';
    if (!area || !isDashboardTab(dashboardTab, extensionId) || dashboardTab?.id == null || targetTab?.id == null) {
      return null;
    }

    const route = {
      dashboardTabId: dashboardTab.id,
      dashboardWindowId: dashboardTab.windowId ?? null,
      targetTabId: targetTab.id,
      targetWindowId: targetTab.windowId ?? null,
    };
    try {
      await area.set({ [QUICK_RETURN_ROUTE_KEY]: route });
      return route;
    } catch {
      return null;
    }
  }

  async function focusTabWithQuickReturn(tabId) {
    const chromeApi = getChromeApi();
    const numericTabId = Number(tabId);
    if (!chromeApi?.tabs || !Number.isFinite(numericTabId)) return null;

    try {
      const [dashboardTab, targetTab] = await Promise.all([
        chromeApi.tabs.getCurrent?.(),
        chromeApi.tabs.get(numericTabId),
      ]);
      if (dashboardTab && targetTab) await rememberQuickReturnRoute(dashboardTab, targetTab);
    } catch {
      // The target may have disappeared. focusTabById handles that race.
    }

    return await focusTabById(numericTabId);
  }

  async function toggleQuickReturn(sourceTab) {
    const chromeApi = getChromeApi();
    if (!chromeApi?.tabs || !chromeApi?.windows) return { direction: 'none', tab: null };

    const extensionId = chromeApi.runtime?.id || '';
    const allTabs = await chromeApi.tabs.query({});
    const currentTab = sourceTab?.id != null
      ? (allTabs.find(tab => tab.id === sourceTab.id) || sourceTab)
      : (await chromeApi.tabs.query({ active: true, lastFocusedWindow: true }))[0];
    if (!currentTab?.id) return { direction: 'none', tab: null };

    const route = await getQuickReturnRoute();
    if (isDashboardTab(currentTab, extensionId)) {
      const targetTab = route
        ? allTabs.find(tab => tab.id === route.targetTabId && !isDashboardTab(tab, extensionId))
        : null;
      if (!targetTab) return { direction: 'none', tab: null };

      await rememberQuickReturnRoute(currentTab, targetTab);
      const focused = await focusTabById(targetTab.id);
      return { direction: focused ? 'target' : 'none', tab: focused };
    }

    const dashboards = allTabs.filter(tab => isDashboardTab(tab, extensionId));
    let dashboardTab = route
      ? dashboards.find(tab => tab.id === route.dashboardTabId)
      : null;
    if (!dashboardTab) dashboardTab = dashboards.find(tab => tab.windowId === currentTab.windowId) || dashboards[0];
    if (!dashboardTab) {
      dashboardTab = await chromeApi.tabs.create({
        url: extensionNewTabUrl(extensionId),
        active: false,
        ...(currentTab.windowId != null ? { windowId: currentTab.windowId } : {}),
      });
    }

    await rememberQuickReturnRoute(dashboardTab, currentTab);
    const focused = await focusTabById(dashboardTab.id);
    return { direction: focused ? 'dashboard' : 'none', tab: focused };
  }

  async function closeDuplicateTabs(urls, keepOne = true) {
    const chromeApi = getChromeApi();
    if (!chromeApi?.tabs) return [];
    const allTabs = await chromeApi.tabs.query({});
    const toClose = [];

    for (const url of urls || []) {
      const matching = allTabs.filter(tab => tab.url === url && !tab.pinned);
      if (keepOne) {
        const keep = matching.find(tab => tab.active) || matching[0];
        for (const tab of matching) {
          if (keep && tab.id !== keep.id) toClose.push(tab.id);
        }
      } else {
        for (const tab of matching) {
          toClose.push(tab.id);
        }
      }
    }

    if (toClose.length > 0) await chromeApi.tabs.remove(toClose);
    return toClose;
  }

  async function closeTabOutDupes() {
    const chromeApi = getChromeApi();
    if (!chromeApi?.tabs || !chromeApi?.windows) return [];
    const extensionId = chromeApi.runtime?.id || '';
    const newtabUrl = extensionNewTabUrl(extensionId);
    const allTabs = await chromeApi.tabs.query({});
    const currentWindow = await chromeApi.windows.getCurrent();
    const tabOutTabs = allTabs.filter(tab =>
      tab.url === newtabUrl || isBrowserNewTabUrl(tab.url)
    );

    if (tabOutTabs.length <= 1) return [];

    const keep =
      tabOutTabs.find(tab => tab.active && tab.windowId === currentWindow.id) ||
      tabOutTabs.find(tab => tab.active) ||
      tabOutTabs[0];
    const toClose = tabOutTabs.filter(tab => tab.id !== keep.id).map(tab => tab.id);
    if (toClose.length > 0) await chromeApi.tabs.remove(toClose);
    return toClose;
  }

  async function groupTabs(tabIds, options = {}) {
    const chromeApi = getChromeApi();
    if (!chromeApi?.tabs || !chromeApi?.tabGroups || !tabIds?.length) return null;
    const groupId = await chromeApi.tabs.group({ tabIds });
    await chromeApi.tabGroups.update(groupId, {
      ...(options.title ? { title: options.title } : {}),
      ...(options.color ? { color: options.color } : {}),
      ...(typeof options.collapsed === 'boolean' ? { collapsed: options.collapsed } : {}),
    });
    return groupId;
  }

  async function updateGroup(groupId, options = {}) {
    const chromeApi = getChromeApi();
    if (!chromeApi?.tabGroups || !Number.isFinite(groupId)) return null;
    return await chromeApi.tabGroups.update(groupId, options);
  }

  async function ungroupTabs(tabIds) {
    const chromeApi = getChromeApi();
    if (!chromeApi?.tabs || !tabIds?.length) return;
    await chromeApi.tabs.ungroup(tabIds);
  }

  async function getRecentlyClosed(maxResults = 10) {
    const chromeApi = getChromeApi();
    if (!chromeApi?.sessions) return [];
    return await chromeApi.sessions.getRecentlyClosed({ maxResults });
  }

  async function restoreSession(sessionId) {
    const chromeApi = getChromeApi();
    if (!chromeApi?.sessions) return null;
    return await chromeApi.sessions.restore(sessionId);
  }

  function normalizeSessionTab(tab, index) {
    if (!tab || tab.pinned === true || typeof tab.url !== 'string') return null;
    const url = normalizeRestorableUrl(tab.url);
    if (!url || isInternalUrl(url, getChromeApi()?.runtime?.id || '')) return null;
    return {
      url,
      title: typeof tab.title === 'string' ? tab.title : url,
      index: Number.isFinite(Number(tab.index)) ? Number(tab.index) : index,
      groupKey: typeof tab.groupKey === 'string' ? tab.groupKey : '',
      groupTitle: typeof tab.groupTitle === 'string' ? tab.groupTitle : '',
      groupColor: typeof tab.groupColor === 'string' ? tab.groupColor : '',
    };
  }

  function normalizeSessionWindows(session) {
    let sourceWindows = Array.isArray(session?.windows) ? session.windows : [];
    if (sourceWindows.length === 0) {
      const legacyTabs = Array.isArray(session?.tabs) && session.tabs.length > 0
        ? session.tabs
        : (Array.isArray(session?.urls) ? session.urls.map(url => ({ url })) : []);
      const byWindow = new Map();
      legacyTabs.forEach(tab => {
        if (!tab || tab.pinned === true) return;
        const key = Number.isFinite(Number(tab.windowId)) ? Number(tab.windowId) : 0;
        if (!byWindow.has(key)) byWindow.set(key, []);
        byWindow.get(key).push(tab);
      });
      sourceWindows = Array.from(byWindow.values()).map(tabs => ({ tabs }));
    }

    return sourceWindows
      .map((window, windowIndex) => ({
        index: windowIndex,
        tabs: (Array.isArray(window?.tabs) ? window.tabs : [])
          .map((tab, tabIndex) => normalizeSessionTab({
            ...tab,
            groupTitle: tab?.groupTitle || session?.group || '',
            groupColor: tab?.groupColor || session?.groupColor || '',
            groupKey: tab?.groupKey || ((tab?.groupTitle || session?.group || tab?.groupColor || session?.groupColor)
              ? `${tab?.groupTitle || session?.group || ''}\n${tab?.groupColor || session?.groupColor || ''}`
              : ''),
          }, tabIndex))
          .filter(Boolean)
          .sort((a, b) => a.index - b.index)
          .map((tab, tabIndex) => ({ ...tab, index: tabIndex })),
      }))
      .filter(window => window.tabs.length > 0);
  }

  function normalizeSessionRestoreTabs(session) {
    return normalizeSessionWindows(session).flatMap((window, windowIndex) =>
      window.tabs.map(tab => ({ ...tab, windowIndex }))
    );
  }

  async function restoreGroups(sourceTabs, restoredTabs, groupPrefix = '') {
    const chromeApi = getChromeApi();
    if (!chromeApi?.tabGroups) return [];
    const groups = new Map();
    sourceTabs.forEach((sourceTab, index) => {
      const restoredTab = restoredTabs[index];
      if (!restoredTab?.id) return;
      const title = sourceTab.groupTitle || '';
      const color = sourceTab.groupColor || '';
      const groupKey = sourceTab.groupKey || (title || color ? `${title}\n${color}` : '');
      if (!groupKey) return;
      const key = `${groupPrefix}${groupKey}`;
      if (!groups.has(key)) groups.set(key, { title, color, tabIds: [] });
      groups.get(key).tabIds.push(restoredTab.id);
    });

    const groupIds = [];
    for (const group of groups.values()) {
      if (group.tabIds.length === 0) continue;
      const groupId = await chromeApi.tabs.group({ tabIds: group.tabIds });
      const update = {};
      if (group.title) update.title = group.title;
      if (CHROME_GROUP_COLORS.has(group.color)) update.color = group.color;
      if (Object.keys(update).length > 0) await chromeApi.tabGroups.update(groupId, update);
      groupIds.push(groupId);
    }
    return groupIds;
  }

  async function restoreSavedSession(session, options = {}) {
    const chromeApi = getChromeApi();
    if (!chromeApi?.windows || !chromeApi?.tabs) return null;

    const sessionWindows = normalizeSessionWindows(session);
    if (sessionWindows.length === 0) return null;
    const mode = options.mode === 'originalWindows' ? 'originalWindows' : 'currentWindow';
    const restoredWindows = [];

    if (mode === 'originalWindows') {
      for (const [windowIndex, sourceWindow] of sessionWindows.entries()) {
        const restoredWindow = await chromeApi.windows.create({
          url: sourceWindow.tabs.map(tab => tab.url),
          focused: windowIndex === 0 && options.focused !== false,
        });
        let restoredTabs = Array.isArray(restoredWindow?.tabs) ? restoredWindow.tabs : [];
        if (restoredWindow?.id != null && restoredTabs.length < sourceWindow.tabs.length) {
          restoredTabs = await chromeApi.tabs.query({ windowId: restoredWindow.id });
        }
        restoredTabs = restoredTabs.filter(tab => tab?.id != null).sort((a, b) => (a.index || 0) - (b.index || 0));
        const groupIds = await restoreGroups(sourceWindow.tabs, restoredTabs);
        restoredWindows.push({
          windowId: restoredWindow?.id,
          tabIds: restoredTabs.map(tab => tab.id).filter(Boolean),
          groupIds,
        });
      }
    } else {
      let targetWindowId = Number(options.windowId);
      if (!Number.isFinite(targetWindowId)) targetWindowId = Number((await chromeApi.windows.getCurrent()).id);
      if (!Number.isFinite(targetWindowId)) return null;
      const existingTabs = await chromeApi.tabs.query({ windowId: targetWindowId });
      const activeTab = existingTabs.find(tab => tab.active) || existingTabs[existingTabs.length - 1];
      let insertIndex = Number.isFinite(Number(activeTab?.index)) ? Number(activeTab.index) + 1 : existingTabs.length;
      const restoredTabs = [];
      const sourceTabs = [];
      for (const [windowIndex, sourceWindow] of sessionWindows.entries()) {
        for (const sourceTab of sourceWindow.tabs) {
          const created = await chromeApi.tabs.create({
            url: sourceTab.url,
            windowId: targetWindowId,
            active: options.active === true,
            index: insertIndex++,
          });
          restoredTabs.push(created);
          sourceTabs.push({ ...sourceTab, groupKey: sourceTab.groupKey ? `${windowIndex}:${sourceTab.groupKey}` : '' });
        }
      }
      const groupIds = await restoreGroups(sourceTabs, restoredTabs);
      if (options.focused === true) await chromeApi.windows.update(targetWindowId, { focused: true });
      restoredWindows.push({ windowId: targetWindowId, tabIds: restoredTabs.map(tab => tab.id).filter(Boolean), groupIds });
    }

    return {
      mode,
      windows: restoredWindows,
      windowId: restoredWindows[0]?.windowId,
      tabIds: restoredWindows.flatMap(window => window.tabIds),
      groupIds: restoredWindows.flatMap(window => window.groupIds),
    };
  }

  const api = {
    BROWSER_NEWTAB_URLS,
    extensionNewTabUrl,
    isBrowserNewTabUrl,
    isExtensionPageUrl,
    isDashboardTab,
    isInternalUrl,
    isRealTab,
    normalizeDomainSortMode,
    reconcileDomainCardOrder,
    reorderDomainCardOrder,
    sortDomainGroups,
    normalizeTab,
    fetchOpenTabs,
    fetchTabGroups,
    exactUnpinnedIdsForUrls,
    closeTabsByUrls,
    closeTabsByIds,
    prepareBulkClose,
    closeTabsWithSnapshot,
    restoreClosedTabs,
    focusTab,
    focusTabById,
    focusTabWithQuickReturn,
    getQuickReturnRoute,
    rememberQuickReturnRoute,
    toggleQuickReturn,
    closeDuplicateTabs,
    closeTabOutDupes,
    groupTabs,
    updateGroup,
    ungroupTabs,
    getRecentlyClosed,
    restoreSession,
    normalizeSessionWindows,
    normalizeSessionRestoreTabs,
    restoreSavedSession,
  };

  global.SuperTabOutTabs = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
