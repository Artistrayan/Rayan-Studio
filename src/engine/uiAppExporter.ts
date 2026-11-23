/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * Rayan Studio - Standalone Visual App Exporter & Starter Templates
 * Generates self-contained offline HTML5 + CSS Grid/Flex/Absolute + IndexedDB CRUD applications.
 */

import JSZip from 'jszip';
import type {
  RayanProject,
  UIDataCollection,
  UIElement,
  UIPage,
} from '../types/studio';
import { retrieveBinaryModel, arrayBufferToDataUrl } from '../storage/projectDb';
import { getMimeTypeForAsset } from './assetManager';

export function escapeHtml(raw: unknown): string {
  return String(raw ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function sanitizeCssColor(raw: string | undefined, fallback: string): string {
  if (!raw) return fallback;
  const trimmed = raw.trim();
  if (/^(transparent|#[0-9a-fA-F]{3,8}|rgba?\([0-9.,\s%]+\)|hsla?\([0-9.,\s%deg]+\)|[a-zA-Z]{3,20})$/.test(trimmed)) {
    return trimmed;
  }
  return fallback;
}

export function createDefaultUiCollections(): UIDataCollection[] {
  return [
    {
      id: 'col_tasks',
      name: 'یادداشت‌ها و امتیازات',
      fields: ['title', 'note', 'score'],
    },
  ];
}

export function createDefaultUiPages(projectName = 'اپلیکیشن رایان'): UIPage[] {
  return [
    {
      id: 'page_home',
      name: 'صفحه اصلی (خانه)',
      isHome: true,
      layoutMode: 'free',
      gap: 12,
      gridCols: 2,
      bgColor: '#0f172a',
      elements: [
        {
          id: 'ui_hero_title',
          type: 'text',
          label: `${projectName}`,
          x: 240,
          y: 48,
          w: 540,
          h: 56,
          zIndex: 2,
          bgColor: 'transparent',
          textColor: '#38bdf8',
          borderColor: 'transparent',
          borderRadius: 8,
          fontSize: 28,
          padding: 8,
        },
        {
          id: 'ui_hero_card',
          type: 'card',
          label: 'خوش آمدید! این یک برنامه واقعی با صفحات متعدد و دیتابیس محلی است.',
          x: 240,
          y: 124,
          w: 540,
          h: 110,
          zIndex: 1,
          bgColor: '#1e293b',
          textColor: '#e2e8f0',
          borderColor: '#334155',
          borderRadius: 14,
          fontSize: 14,
          padding: 16,
        },
        {
          id: 'ui_btn_form',
          type: 'button',
          label: 'ثبت رکورد در دیتابیس',
          x: 240,
          y: 264,
          w: 256,
          h: 50,
          zIndex: 3,
          bgColor: '#f59e0b',
          textColor: '#020617',
          borderColor: '#d97706',
          borderRadius: 12,
          fontSize: 15,
          actionType: 'navigate',
          actionParam: 'page_records',
        },
        {
          id: 'ui_btn_hud',
          type: 'button',
          label: 'نمای وضعیت و امتیاز',
          x: 524,
          y: 264,
          w: 256,
          h: 50,
          zIndex: 3,
          bgColor: '#0284c7',
          textColor: '#ffffff',
          borderColor: '#38bdf8',
          borderRadius: 12,
          fontSize: 15,
          actionType: 'navigate',
          actionParam: 'page_stats',
        },
      ],
    },
    {
      id: 'page_records',
      name: 'ثبت و فهرست داده‌ها (CRUD)',
      isHome: false,
      layoutMode: 'free',
      gap: 12,
      gridCols: 2,
      bgColor: '#0f172a',
      elements: [
        {
          id: 'ui_rec_title',
          type: 'text',
          label: 'مدیریت داده‌های محلی (IndexedDB)',
          x: 60,
          y: 28,
          w: 440,
          h: 44,
          zIndex: 2,
          bgColor: 'transparent',
          textColor: '#f8fafc',
          borderColor: 'transparent',
          borderRadius: 8,
          fontSize: 20,
          padding: 4,
        },
        {
          id: 'ui_input_title',
          type: 'input',
          label: 'عنوان رکورد',
          placeholder: 'عنوان یادداشت یا بازیکن را بنویسید...',
          bindVar: 'title',
          x: 60,
          y: 88,
          w: 360,
          h: 44,
          zIndex: 2,
          bgColor: '#0b1120',
          textColor: '#f8fafc',
          borderColor: '#334155',
          borderRadius: 10,
          fontSize: 13,
          padding: 10,
        },
        {
          id: 'ui_input_note',
          type: 'input',
          label: 'توضیحات',
          placeholder: 'متن یا مقدار مورد نظر...',
          bindVar: 'note',
          x: 60,
          y: 148,
          w: 360,
          h: 44,
          zIndex: 2,
          bgColor: '#0b1120',
          textColor: '#f8fafc',
          borderColor: '#334155',
          borderRadius: 10,
          fontSize: 13,
          padding: 10,
        },
        {
          id: 'ui_btn_save_db',
          type: 'button',
          label: 'ذخیره در پایگاه داده',
          x: 60,
          y: 212,
          w: 175,
          h: 44,
          zIndex: 3,
          bgColor: '#10b981',
          textColor: '#022c22',
          borderColor: '#34d399',
          borderRadius: 10,
          fontSize: 13,
          actionType: 'db-save',
          actionParam: 'col_tasks',
        },
        {
          id: 'ui_btn_clear_db',
          type: 'button',
          label: 'پاک‌سازی لیست',
          x: 245,
          y: 212,
          w: 175,
          h: 44,
          zIndex: 3,
          bgColor: '#1e293b',
          textColor: '#fda4af',
          borderColor: '#475569',
          borderRadius: 10,
          fontSize: 13,
          actionType: 'db-clear',
          actionParam: 'col_tasks',
        },
        {
          id: 'ui_rec_list',
          type: 'list',
          label: 'رکوردهای ذخیره‌شده',
          collectionId: 'col_tasks',
          x: 460,
          y: 88,
          w: 500,
          h: 400,
          zIndex: 2,
          bgColor: '#111827',
          textColor: '#e2e8f0',
          borderColor: '#334155',
          borderRadius: 12,
          fontSize: 13,
          padding: 12,
        },
        {
          id: 'ui_rec_back',
          type: 'button',
          label: 'بازگشت به خانه',
          x: 60,
          y: 444,
          w: 160,
          h: 44,
          zIndex: 3,
          bgColor: '#334155',
          textColor: '#f8fafc',
          borderColor: '#475569',
          borderRadius: 10,
          fontSize: 13,
          actionType: 'navigate',
          actionParam: 'page_home',
        },
      ],
    },
    {
      id: 'page_stats',
      name: 'نمای وضعیت و امتیاز (HUD)',
      isHome: false,
      layoutMode: 'grid',
      gap: 16,
      gridCols: 2,
      bgColor: '#020617',
      elements: [
        {
          id: 'ui_hp_bar',
          type: 'progressBar',
          label: 'سلامت: {health}%',
          bindVar: 'health',
          x: 40,
          y: 40,
          w: 360,
          h: 42,
          zIndex: 2,
          bgColor: '#1e293b',
          textColor: '#ffffff',
          borderColor: '#ef4444',
          borderRadius: 10,
          fontSize: 13,
        },
        {
          id: 'ui_score_badge',
          type: 'badge',
          label: 'امتیاز فعلی: {score}',
          x: 440,
          y: 40,
          w: 220,
          h: 42,
          zIndex: 2,
          bgColor: '#854d0e',
          textColor: '#fef08a',
          borderColor: '#ca8a04',
          borderRadius: 20,
          fontSize: 14,
        },
        {
          id: 'ui_btn_add_score',
          type: 'button',
          label: 'افزایش امتیاز (+10)',
          x: 40,
          y: 120,
          w: 220,
          h: 48,
          zIndex: 2,
          bgColor: '#f59e0b',
          textColor: '#020617',
          borderColor: '#d97706',
          borderRadius: 12,
          fontSize: 14,
          actionType: 'add-var',
          actionParam: 'score',
          actionValue: '10',
        },
        {
          id: 'ui_btn_stats_home',
          type: 'button',
          label: 'بازگشت به صفحه اصلی',
          x: 300,
          y: 120,
          w: 220,
          h: 48,
          zIndex: 2,
          bgColor: '#1e293b',
          textColor: '#f8fafc',
          borderColor: '#334155',
          borderRadius: 12,
          fontSize: 14,
          actionType: 'navigate',
          actionParam: 'page_home',
        },
      ],
    },
  ];
}

export async function hydrateProjectImageDataUrls(
  project: RayanProject
): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  for (const asset of project.assets) {
    if (asset.kind !== 'image') continue;
    if (asset.dataUrl && asset.dataUrl.startsWith('data:')) {
      map[asset.id] = asset.dataUrl;
    } else if (asset.id) {
      try {
        const res = await retrieveBinaryModel(asset.id);
        if (res?.buffer) {
          map[asset.id] = arrayBufferToDataUrl(
            res.buffer,
            getMimeTypeForAsset(asset.kind, asset.format)
          );
        }
      } catch {
        // Ignore unavailable DB record in headless test contexts
      }
    }
  }
  return map;
}

function renderStaticIconSvg(iconName?: string): string {
  switch (iconName) {
    case 'heart':
      return '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>';
    case 'star':
      return '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>';
    case 'shield':
      return '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/></svg>';
    case 'settings':
      return '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.6.79 1 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';
    default:
      return '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>';
  }
}

export function buildStandaloneUiAppHtml(params: {
  project: RayanProject;
  pages: UIPage[];
  collections: UIDataCollection[];
  hydratedImageUrls?: Record<string, string>;
}): string {
  const { project, pages, collections, hydratedImageUrls = {} } = params;
  const homePage = pages.find((p) => p.isHome) || pages[0];
  const initialVars: Record<string, string | number> = {
    score: project.variables.score ?? 0,
    health: project.variables.health ?? 100,
    level: project.variables.level ?? 1,
    ...(project.customVariables || {}),
  };

  const renderElementHtml = (page: UIPage, el: UIElement): string => {
    const isFree = page.layoutMode === 'free';
    const bg = sanitizeCssColor(el.bgColor, '#1e293b');
    const color = sanitizeCssColor(el.textColor, '#f8fafc');
    const border = sanitizeCssColor(el.borderColor, '#475569');
    const posCss = isFree
      ? `position:absolute;left:${Math.round(el.x)}px;top:${Math.round(el.y)}px;width:${Math.round(el.w)}px;height:${Math.round(el.h)}px;z-index:${Math.round(el.zIndex ?? 1)};`
      : `width:${Math.round(el.w)}px;min-height:${Math.round(el.h)}px;`;
    const commonCss = `${posCss}background:${bg};color:${color};border:1px solid ${border};border-radius:${Math.round(el.borderRadius)}px;font-size:${Math.round(el.fontSize)}px;padding:${Math.round(el.padding ?? 8)}px;opacity:${el.opacity ?? 1};`;

    const actionAttrs = el.actionType
      ? ` data-action-type="${escapeHtml(el.actionType)}" data-action-param="${escapeHtml(el.actionParam || '')}" data-action-value="${escapeHtml(el.actionValue || '')}"`
      : '';

    if (el.type === 'input') {
      return `<input class="rayan-el rayan-input" data-el-id="${escapeHtml(el.id)}" data-bind-var="${escapeHtml(el.bindVar || el.id)}" placeholder="${escapeHtml(el.placeholder || el.label)}" style="${commonCss}" />`;
    }

    if (el.type === 'image') {
      const url = el.imageAssetId ? hydratedImageUrls[el.imageAssetId] || '' : '';
      const safeUrl =
        url.startsWith('data:image/') || url.startsWith('https://') || url.startsWith('http://')
          ? url
          : '';
      const inner = safeUrl
        ? `<img src="${escapeHtml(safeUrl)}" alt="${escapeHtml(el.label)}" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;" />`
        : `<span>${escapeHtml(el.label || 'تصویر')}</span>`;
      return `<div class="rayan-el rayan-image" data-el-id="${escapeHtml(el.id)}"${actionAttrs} style="${commonCss}overflow:hidden;display:flex;align-items:center;justify-content:center;">${inner}</div>`;
    }

    if (el.type === 'icon') {
      return `<div class="rayan-el rayan-icon" data-el-id="${escapeHtml(el.id)}"${actionAttrs} style="${commonCss}display:flex;align-items:center;justify-content:center;gap:6px;">${renderStaticIconSvg(el.iconName)}<span>${escapeHtml(el.label)}</span></div>`;
    }

    if (el.type === 'progressBar') {
      const bindKey = el.bindVar || 'health';
      return `<div class="rayan-el rayan-progress" data-el-id="${escapeHtml(el.id)}" data-bind-var="${escapeHtml(bindKey)}" data-tpl="${escapeHtml(el.label)}" style="${commonCss}position:${isFree ? 'absolute' : 'relative'};overflow:hidden;display:flex;align-items:center;justify-content:center;"><div class="rayan-progress-fill" style="position:absolute;inset-block:0;right:0;width:85%;background:#ef4444;transition:width 0.25s;"></div><span class="rayan-progress-text" style="position:relative;z-index:2;font-weight:700;">${escapeHtml(el.label)}</span></div>`;
    }

    if (el.type === 'list') {
      return `<div class="rayan-el rayan-list" data-el-id="${escapeHtml(el.id)}" data-collection-id="${escapeHtml(el.collectionId || '')}" style="${commonCss}overflow-y:auto;display:flex;flex-direction:column;gap:8px;align-items:stretch;text-align:right;"><div style="font-weight:700;opacity:0.85;border-bottom:1px solid rgba(148,163,184,0.25);padding-bottom:4px;">${escapeHtml(el.label)}</div><div class="rayan-list-rows" style="display:flex;flex-direction:column;gap:6px;"></div></div>`;
    }

    if (el.type === 'button') {
      return `<button type="button" class="rayan-el rayan-btn" data-el-id="${escapeHtml(el.id)}" data-tpl="${escapeHtml(el.label)}"${actionAttrs} style="${commonCss}cursor:pointer;font-weight:700;display:flex;align-items:center;justify-content:center;">${escapeHtml(el.label)}</button>`;
    }

    return `<div class="rayan-el rayan-${escapeHtml(el.type)}" data-el-id="${escapeHtml(el.id)}" data-tpl="${escapeHtml(el.label)}"${actionAttrs} style="${commonCss}display:flex;align-items:center;justify-content:center;text-align:center;">${escapeHtml(el.label)}</div>`;
  };

  const pagesHtml = pages
    .map((page) => {
      const bg = sanitizeCssColor(page.bgColor, '#0f172a');
      let layoutCss = 'position:relative;width:100%;min-height:600px;';
      if (page.layoutMode === 'flex-col') {
        layoutCss = `display:flex;flex-direction:column;gap:${Math.round(page.gap || 12)}px;padding:20px;align-items:flex-start;min-height:600px;`;
      } else if (page.layoutMode === 'flex-row') {
        layoutCss = `display:flex;flex-direction:row;flex-wrap:wrap;gap:${Math.round(page.gap || 12)}px;padding:20px;align-items:flex-start;min-height:600px;`;
      } else if (page.layoutMode === 'grid') {
        layoutCss = `display:grid;grid-template-columns:repeat(${Math.max(1, Math.min(6, page.gridCols || 2))}, minmax(0, 1fr));gap:${Math.round(page.gap || 12)}px;padding:20px;align-content:start;min-height:600px;`;
      }

      const isActive = homePage?.id === page.id;
      const elems = page.elements.map((el) => renderElementHtml(page, el)).join('\n      ');
      return `<section class="rayan-page${isActive ? ' active' : ''}" data-page-id="${escapeHtml(page.id)}" data-layout-mode="${escapeHtml(page.layoutMode)}" style="background:${bg};${layoutCss}${isActive ? '' : 'display:none;'}">\n      ${elems}\n    </section>`;
    })
    .join('\n  ');

  const safeRuntimeConfig = JSON.stringify({
    projectId: project.id,
    homePageId: homePage?.id || '',
    variables: initialVars,
    collections,
  }).replace(/<\//g, '<\\/');

  return `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(project.name)} - اپلیکیشن وب</title>
  <style>
    * { box-sizing: border-box; font-family: system-ui, -apple-system, BlinkMacSystemFont, sans-serif; }
    html, body { margin: 0; padding: 0; min-height: 100vh; background: #070a0f; color: #f8fafc; display: flex; align-items: center; justify-content: center; }
    #app-shell { width: 100%; max-width: 1024px; min-height: 600px; border-radius: 16px; overflow: hidden; border: 1px solid #1e293b; box-shadow: 0 24px 64px rgba(0,0,0,0.65); position: relative; }
    .rayan-btn:hover { filter: brightness(1.1); }
    .rayan-btn:active { transform: scale(0.97); }
    .rayan-row-item { padding: 8px 10px; border-radius: 8px; background: rgba(15,23,42,0.75); border: 1px solid #334155; display: flex; justify-content: space-between; align-items: center; gap: 8px; font-size: 12px; }
    .rayan-row-del { background: transparent; border: 1px solid #ef4444; color: #fca5a5; border-radius: 6px; padding: 2px 8px; cursor: pointer; font-size: 11px; }
    #toast-banner { position: fixed; top: 18px; left: 50%; transform: translateX(-50%); background: #f59e0b; color: #020617; font-weight: 700; font-size: 13px; padding: 10px 18px; border-radius: 10px; display: none; z-index: 999; box-shadow: 0 10px 28px rgba(0,0,0,0.45); }
    @media (max-width: 768px) {
      #app-shell { border-radius: 0; min-height: 100vh; }
      .rayan-page[data-layout-mode="free"] { overflow-x: auto; }
      .rayan-page[data-layout-mode="grid"] { grid-template-columns: 1fr !important; }
    }
  </style>
</head>
<body>
  <div id="toast-banner"></div>
  <main id="app-shell">
    ${pagesHtml}
  </main>
  <script>
    const CONFIG = ${safeRuntimeConfig};
    const vars = Object.assign({}, CONFIG.variables);
    const inputValues = {};

    function showToast(msg) {
      const b = document.getElementById('toast-banner');
      b.textContent = String(msg || '');
      b.style.display = 'block';
      clearTimeout(window.__toastTimer);
      window.__toastTimer = setTimeout(() => { b.style.display = 'none'; }, 2600);
    }

    function openAppDb() {
      return new Promise((resolve, reject) => {
        const req = indexedDB.open('rayan_standalone_app_db', 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('app_records')) {
            const store = db.createObjectStore('app_records', { keyPath: 'id' });
            store.createIndex('collectionId', 'collectionId', { unique: false });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }

    async function dbPutRecord(collectionId, data) {
      const db = await openAppDb();
      const rec = { id: 'rec_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6), collectionId, data, createdAt: Date.now() };
      return new Promise((resolve, reject) => {
        const tx = db.transaction('app_records', 'readwrite');
        tx.objectStore('app_records').put(rec);
        tx.oncomplete = () => resolve(rec);
        tx.onerror = () => reject(tx.error);
      });
    }

    async function dbListRecords(collectionId) {
      const db = await openAppDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('app_records', 'readonly');
        const idx = tx.objectStore('app_records').index('collectionId');
        const req = idx.getAll(collectionId);
        req.onsuccess = () => resolve((req.result || []).sort((a, b) => b.createdAt - a.createdAt));
        req.onerror = () => reject(req.error);
      });
    }

    async function dbDeleteRecord(id) {
      const db = await openAppDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('app_records', 'readwrite');
        tx.objectStore('app_records').delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    }

    async function dbClearCollection(collectionId) {
      const rows = await dbListRecords(collectionId);
      const db = await openAppDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('app_records', 'readwrite');
        const st = tx.objectStore('app_records');
        rows.forEach(r => st.delete(r.id));
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    }

    function interpolate(tpl) {
      return String(tpl || '').replace(/\\{(\\w+)\\}/g, (_, k) => vars[k] !== undefined ? String(vars[k]) : '{' + k + '}');
    }

    function refreshBoundElements() {
      document.querySelectorAll('[data-tpl]').forEach(el => {
        const next = interpolate(el.getAttribute('data-tpl'));
        if (el.classList.contains('rayan-progress')) {
          const txt = el.querySelector('.rayan-progress-text');
          if (txt) txt.textContent = next;
          const key = el.getAttribute('data-bind-var') || 'health';
          const pct = Math.max(0, Math.min(100, Number(vars[key] ?? 85)));
          const fill = el.querySelector('.rayan-progress-fill');
          if (fill) fill.style.width = pct + '%';
        } else {
          el.textContent = next;
        }
      });
    }

    async function refreshAllLists() {
      const listNodes = document.querySelectorAll('.rayan-list[data-collection-id]');
      for (const node of listNodes) {
        const colId = node.getAttribute('data-collection-id');
        const box = node.querySelector('.rayan-list-rows');
        if (!colId || !box) continue;
        const rows = await dbListRecords(colId);
        box.textContent = '';
        if (rows.length === 0) {
          const empty = document.createElement('div');
          empty.style.opacity = '0.55';
          empty.style.fontSize = '12px';
          empty.textContent = 'هنوز رکوردی ثبت نشده است.';
          box.appendChild(empty);
          continue;
        }
        rows.forEach(r => {
          const rowDiv = document.createElement('div');
          rowDiv.className = 'rayan-row-item';
          const textSpan = document.createElement('span');
          textSpan.textContent = Object.entries(r.data || {}).map(([k, v]) => k + ': ' + v).join(' | ');
          const delBtn = document.createElement('button');
          delBtn.type = 'button';
          delBtn.className = 'rayan-row-del';
          delBtn.textContent = 'حذف';
          delBtn.addEventListener('click', async () => {
            await dbDeleteRecord(r.id);
            await refreshAllLists();
          });
          rowDiv.appendChild(textSpan);
          rowDiv.appendChild(delBtn);
          box.appendChild(rowDiv);
        });
      }
    }

    function navigateTo(pageId) {
      document.querySelectorAll('.rayan-page').forEach(pg => {
        const match = pg.getAttribute('data-page-id') === pageId;
        pg.classList.toggle('active', match);
        if (match) {
          const mode = pg.getAttribute('data-layout-mode');
          pg.style.display = mode === 'grid' ? 'grid' : (mode === 'flex-col' || mode === 'flex-row') ? 'flex' : 'block';
        } else {
          pg.style.display = 'none';
        }
      });
    }

    function playTone() {
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.connect(g); g.connect(ctx.destination);
        osc.frequency.setValueAtTime(660, ctx.currentTime);
        g.gain.setValueAtTime(0.14, ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.16);
        osc.start(); osc.stop(ctx.currentTime + 0.17);
      } catch {}
    }

    document.querySelectorAll('.rayan-input').forEach(inp => {
      inp.addEventListener('input', e => {
        const key = inp.getAttribute('data-bind-var');
        if (key) {
          inputValues[key] = e.target.value;
          vars[key] = e.target.value;
        }
      });
    });

    document.querySelectorAll('[data-action-type]').forEach(el => {
      el.addEventListener('click', async () => {
        const type = el.getAttribute('data-action-type');
        const param = el.getAttribute('data-action-param') || '';
        const val = el.getAttribute('data-action-value') || '';
        if (type === 'navigate' && param) {
          navigateTo(param);
          await refreshAllLists();
        } else if (type === 'add-var' && param) {
          vars[param] = (Number(vars[param]) || 0) + (Number(val) || 1);
          refreshBoundElements();
          playTone();
        } else if (type === 'set-var' && param) {
          vars[param] = isNaN(Number(val)) ? val : Number(val);
          refreshBoundElements();
          playTone();
        } else if (type === 'db-save') {
          const colId = param || (CONFIG.collections[0] && CONFIG.collections[0].id) || 'col_tasks';
          const payload = Object.assign({ score: vars.score || 0 }, inputValues);
          await dbPutRecord(colId, payload);
          await refreshAllLists();
          showToast('رکورد جدید در پایگاه داده ذخیره شد');
        } else if (type === 'db-load') {
          await refreshAllLists();
          showToast('داده‌ها از پایگاه داده بارگذاری شد');
        } else if (type === 'db-clear') {
          const colId = param || (CONFIG.collections[0] && CONFIG.collections[0].id) || 'col_tasks';
          await dbClearCollection(colId);
          await refreshAllLists();
          showToast('فهرست داده‌ها پاک شد');
        } else if (type === 'play-sound') {
          playTone();
        } else if (type === 'show-message') {
          showToast(param || val || 'پیام اجرا شد');
        }
      });
    });

    refreshBoundElements();
    refreshAllLists().catch(() => {});
  </script>
</body>
</html>`;
}

export async function exportUiAppSingleHtml(params: {
  project: RayanProject;
  pages: UIPage[];
  collections: UIDataCollection[];
}) {
  const hydratedImageUrls = await hydrateProjectImageDataUrls(params.project);
  const html = buildStandaloneUiAppHtml({
    ...params,
    hydratedImageUrls,
  });
  const slug =
    params.project.name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\u0600-\u06FF]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'rayan-app';
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${slug}-ui-app.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2500);
}

export async function exportUiAppBundleZip(params: {
  project: RayanProject;
  pages: UIPage[];
  collections: UIDataCollection[];
}) {
  const hydratedImageUrls = await hydrateProjectImageDataUrls(params.project);
  const html = buildStandaloneUiAppHtml({
    ...params,
    hydratedImageUrls,
  });
  const zip = new JSZip();
  zip.file('index.html', html);
  zip.file(
    'ui-schema.json',
    JSON.stringify({ pages: params.pages, collections: params.collections }, null, 2)
  );
  zip.file(
    'manifest.json',
    JSON.stringify(
      {
        name: params.project.name,
        short_name: params.project.name.slice(0, 12),
        start_url: './index.html',
        display: 'standalone',
        background_color: '#070a0f',
        theme_color: '#0f172a',
      },
      null,
      2
    )
  );

  const slug =
    params.project.name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\u0600-\u06FF]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'rayan-app';
  const blob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${slug}-ui-bundle.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2500);
}
