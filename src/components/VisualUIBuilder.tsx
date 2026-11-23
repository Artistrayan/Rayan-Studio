/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * Rayan Studio - Professional Visual UI Builder
 * Supports exact free-form X/Y placement, Flexbox & Grid systems, multi-page screen management,
 * responsive breakpoints (Desktop, Tablet, Mobile), external media & icons,
 * real button action binding, data interpolation, and clean code generation.
 */

import React, { useState, useRef, useMemo } from 'react';
import {
  Code2,
  Copy,
  Eye,
  FilePlus2,
  FolderOpen,
  Grid,
  Heart,
  Image as ImageIcon,
  Layers,
  Layout,
  Maximize2,
  Monitor,
  MousePointer,
  Move,
  Play,
  Plus,
  RotateCw,
  Search,
  Settings,
  Shield,
  Smartphone,
  Sparkles,
  Tablet,
  Trash2,
  Type,
  Volume2,
  X,
  Zap,
} from 'lucide-react';
import type { RayanProject } from '../types/studio';
import { audioEngine } from '../engine/audioEngine';

export type LayoutMode = 'absolute' | 'flex' | 'grid';
export type BreakpointMode = 'desktop' | 'tablet' | 'mobile';

export type UIElementType =
  | 'button'
  | 'text'
  | 'image'
  | 'icon'
  | 'container'
  | 'progressBar'
  | 'input'
  | 'badge';

export interface UIActionBinding {
  type: 'navigate' | 'add-var' | 'set-var' | 'play-sound' | 'show-message';
  targetPageId?: string;
  varName?: string;
  varValue?: number;
  soundName?: string;
  messageText?: string;
}

export interface UIElement {
  id: string;
  name: string;
  type: UIElementType;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  text: string;
  color: string;
  bgColor: string;
  borderColor: string;
  borderWidth: number;
  borderRadius: number;
  fontSize: number;
  fontWeight: 'normal' | 'semibold' | 'bold';
  imageUrl?: string;
  iconName?: string;
  progressValue?: number;
  progressMax?: number;
  action?: UIActionBinding;
  flexGrow?: number;
}

export interface UIPage {
  id: string;
  name: string;
  layoutMode: LayoutMode;
  flexDirection?: 'row' | 'column';
  flexGap?: number;
  gridColumns?: number;
  bgColor: string;
  elements: UIElement[];
}

interface VisualUIBuilderProps {
  project: RayanProject;
  onUpdateProject?: (updater: (prev: RayanProject) => RayanProject) => void;
}

const BREAKPOINT_DIMS: Record<BreakpointMode, { width: number; height: number; label: string }> = {
  desktop: { width: 1024, height: 600, label: 'دسکتاپ (1024 × 600)' },
  tablet: { width: 768, height: 580, label: 'تبلت (768 × 580)' },
  mobile: { width: 380, height: 640, label: 'موبایل (380 × 640)' },
};

export const VisualUIBuilder: React.FC<VisualUIBuilderProps> = ({
  project,
  onUpdateProject,
}) => {
  // --- Pages State ---
  const [pages, setPages] = useState<UIPage[]>([
    {
      id: 'page_main_menu',
      name: 'صفحه منوی اصلی (Main Menu)',
      layoutMode: 'absolute',
      bgColor: '#0f172a',
      elements: [
        {
          id: 'elem_title',
          name: 'عنوان بازی',
          type: 'text',
          x: 260,
          y: 80,
          width: 500,
          height: 60,
          zIndex: 1,
          text: 'استودیو بازی‌سازی رایان',
          color: '#38bdf8',
          bgColor: 'transparent',
          borderColor: 'transparent',
          borderWidth: 0,
          borderRadius: 0,
          fontSize: 32,
          fontWeight: 'bold',
        },
        {
          id: 'elem_btn_start',
          name: 'دکمه شروع بازی',
          type: 'button',
          x: 380,
          y: 200,
          width: 260,
          height: 52,
          zIndex: 2,
          text: 'شروع بازی جدید',
          color: '#020617',
          bgColor: '#f59e0b',
          borderColor: '#d97706',
          borderWidth: 2,
          borderRadius: 12,
          fontSize: 16,
          fontWeight: 'bold',
          action: {
            type: 'navigate',
            targetPageId: 'page_hud',
          },
        },
        {
          id: 'elem_btn_settings',
          name: 'دکمه تنظیمات',
          type: 'button',
          x: 380,
          y: 270,
          width: 260,
          height: 48,
          zIndex: 2,
          text: 'تنظیمات و راهنما',
          color: '#f8fafc',
          bgColor: '#1e293b',
          borderColor: '#334155',
          borderWidth: 1,
          borderRadius: 12,
          fontSize: 14,
          fontWeight: 'semibold',
          action: {
            type: 'navigate',
            targetPageId: 'page_settings',
          },
        },
      ],
    },
    {
      id: 'page_hud',
      name: 'رابط کاربری درون‌بازی (HUD)',
      layoutMode: 'absolute',
      bgColor: '#020617',
      elements: [
        {
          id: 'elem_hp_bar',
          name: 'نوار سلامت',
          type: 'progressBar',
          x: 40,
          y: 30,
          width: 220,
          height: 24,
          zIndex: 5,
          text: 'سلامت: {health}%',
          color: '#ffffff',
          bgColor: '#1e293b',
          borderColor: '#ef4444',
          borderWidth: 1,
          borderRadius: 8,
          fontSize: 11,
          fontWeight: 'bold',
          progressValue: 85,
          progressMax: 100,
        },
        {
          id: 'elem_score_badge',
          name: 'نشان امتیاز',
          type: 'badge',
          x: 820,
          y: 30,
          width: 160,
          height: 36,
          zIndex: 5,
          text: 'امتیاز: {score}',
          color: '#fef08a',
          bgColor: '#854d0e',
          borderColor: '#ca8a04',
          borderWidth: 1,
          borderRadius: 18,
          fontSize: 14,
          fontWeight: 'bold',
        },
        {
          id: 'elem_btn_attack',
          name: 'دکمه ضربه',
          type: 'button',
          x: 840,
          y: 480,
          width: 120,
          height: 48,
          zIndex: 6,
          text: 'حمله (ضربه)',
          color: '#ffffff',
          bgColor: '#dc2626',
          borderColor: '#b91c1c',
          borderWidth: 1,
          borderRadius: 12,
          fontSize: 13,
          fontWeight: 'bold',
          action: {
            type: 'add-var',
            varName: 'score',
            varValue: 10,
            soundName: 'coin',
          },
        },
        {
          id: 'elem_btn_back',
          name: 'دکمه بازگشت به منو',
          type: 'button',
          x: 40,
          y: 520,
          width: 140,
          height: 38,
          zIndex: 6,
          text: 'خروج به منو',
          color: '#94a3b8',
          bgColor: '#1e293b',
          borderColor: '#334155',
          borderWidth: 1,
          borderRadius: 8,
          fontSize: 12,
          fontWeight: 'normal',
          action: {
            type: 'navigate',
            targetPageId: 'page_main_menu',
          },
        },
      ],
    },
    {
      id: 'page_settings',
      name: 'صفحه تنظیمات (Settings)',
      layoutMode: 'absolute',
      bgColor: '#0f172a',
      elements: [
        {
          id: 'elem_set_title',
          name: 'تیتر تنظیمات',
          type: 'text',
          x: 360,
          y: 60,
          width: 300,
          height: 40,
          zIndex: 1,
          text: 'تنظیمات بازی و صدا',
          color: '#f8fafc',
          bgColor: 'transparent',
          borderColor: 'transparent',
          borderWidth: 0,
          borderRadius: 0,
          fontSize: 22,
          fontWeight: 'bold',
        },
        {
          id: 'elem_set_back',
          name: 'بازگشت به منوی اصلی',
          type: 'button',
          x: 400,
          y: 360,
          width: 220,
          height: 44,
          zIndex: 2,
          text: 'ذخیره و بازگشت',
          color: '#020617',
          bgColor: '#38bdf8',
          borderColor: '#0284c7',
          borderWidth: 1,
          borderRadius: 10,
          fontSize: 13,
          fontWeight: 'bold',
          action: {
            type: 'navigate',
            targetPageId: 'page_main_menu',
          },
        },
      ],
    },
  ]);

  const [activePageId, setActivePageId] = useState<string>('page_main_menu');
  const [selectedElementId, setSelectedElementId] = useState<string | null>('elem_title');
  const [breakpoint, setBreakpoint] = useState<BreakpointMode>('desktop');
  const [interactivePreview, setInteractivePreview] = useState(false);
  const [previewVars, setPreviewVars] = useState<Record<string, number>>({
    score: 120,
    health: 85,
  });
  const [bannerMessage, setBannerMessage] = useState<string | null>(null);

  // Dragging in Canvas
  const [dragState, setDragState] = useState<{
    elemId: string;
    startX: number;
    startY: number;
    initialX: number;
    initialY: number;
  } | null>(null);

  const activePage = pages.find((p) => p.id === activePageId) || pages[0];
  const selectedElement = activePage?.elements.find((e) => e.id === selectedElementId) || null;

  // Add new element to active page
  const addElement = (type: UIElementType) => {
    if (!activePage) return;
    const count = activePage.elements.length + 1;
    const newId = `elem_${type}_${Date.now()}`;

    let defaultText = 'عنصر جدید';
    let defaultW = 140;
    let defaultH = 40;
    let defaultBg = '#1e293b';
    let defaultColor = '#ffffff';

    if (type === 'button') {
      defaultText = `دکمه ${count}`;
      defaultBg = '#f59e0b';
      defaultColor = '#000000';
      defaultW = 160;
      defaultH = 44;
    } else if (type === 'text') {
      defaultText = `متن تیتر ${count}`;
      defaultBg = 'transparent';
      defaultColor = '#38bdf8';
      defaultW = 220;
      defaultH = 36;
    } else if (type === 'progressBar') {
      defaultText = 'سلامت: {health}%';
      defaultBg = '#1e293b';
      defaultW = 200;
      defaultH = 22;
    } else if (type === 'badge') {
      defaultText = 'امتیاز: {score}';
      defaultBg = '#854d0e';
      defaultColor = '#fef08a';
      defaultW = 130;
      defaultH = 32;
    } else if (type === 'container') {
      defaultText = '';
      defaultBg = '#1e293b/80';
      defaultW = 260;
      defaultH = 160;
    }

    const newElement: UIElement = {
      id: newId,
      name: `${type} ${count}`,
      type,
      x: 100 + (count % 5) * 20,
      y: 100 + (count % 5) * 20,
      width: defaultW,
      height: defaultH,
      zIndex: activePage.elements.length + 1,
      text: defaultText,
      color: defaultColor,
      bgColor: defaultBg,
      borderColor: '#475569',
      borderWidth: 1,
      borderRadius: 8,
      fontSize: 13,
      fontWeight: 'semibold',
    };

    setPages((prev) =>
      prev.map((p) => (p.id === activePage.id ? { ...p, elements: [...p.elements, newElement] } : p))
    );
    setSelectedElementId(newId);
  };

  // Update element patch
  const updateElement = (patch: Partial<UIElement>) => {
    if (!activePage || !selectedElement) return;
    setPages((prev) =>
      prev.map((p) => {
        if (p.id !== activePage.id) return p;
        return {
          ...p,
          elements: p.elements.map((el) => (el.id === selectedElement.id ? { ...el, ...patch } : el)),
        };
      })
    );
  };

  // Delete element
  const deleteElement = (id: string) => {
    if (!activePage) return;
    setPages((prev) =>
      prev.map((p) => {
        if (p.id !== activePage.id) return p;
        return {
          ...p,
          elements: p.elements.filter((el) => el.id !== id),
        };
      })
    );
    if (selectedElementId === id) setSelectedElementId(null);
  };

  // Add new screen page
  const addPage = () => {
    const pageNum = pages.length + 1;
    const newPage: UIPage = {
      id: `page_${Date.now()}`,
      name: `صفحه جدید ${pageNum}`,
      layoutMode: 'absolute',
      bgColor: '#0f172a',
      elements: [],
    };
    setPages((prev) => [...prev, newPage]);
    setActivePageId(newPage.id);
  };

  // Duplicate page
  const duplicatePage = (p: UIPage) => {
    const newId = `page_${Date.now()}`;
    const clone: UIPage = {
      ...p,
      id: newId,
      name: `${p.name} (کپی)`,
      elements: p.elements.map((el) => ({ ...el, id: `elem_${Date.now()}_${Math.random().toString(36).slice(2, 5)}` })),
    };
    setPages((prev) => [...prev, clone]);
    setActivePageId(newId);
  };

  // Delete page
  const deletePage = (id: string) => {
    if (pages.length <= 1) return;
    setPages((prev) => prev.filter((p) => p.id !== id));
    if (activePageId === id) {
      const remaining = pages.filter((p) => p.id !== id);
      setActivePageId(remaining[0]?.id || '');
    }
  };

  // Interactive Click on Canvas in Preview Mode
  const handleElementAction = (el: UIElement) => {
    if (!interactivePreview || !el.action) return;

    if (el.action.soundName) {
      audioEngine.playSound(el.action.soundName, project.assets);
    }

    if (el.action.type === 'navigate' && el.action.targetPageId) {
      setActivePageId(el.action.targetPageId);
    } else if (el.action.type === 'add-var' && el.action.varName) {
      const v = el.action.varName;
      const delta = el.action.varValue ?? 1;
      setPreviewVars((cur) => ({ ...cur, [v]: (cur[v] || 0) + delta }));
    } else if (el.action.type === 'set-var' && el.action.varName) {
      const v = el.action.varName;
      const val = el.action.varValue ?? 0;
      setPreviewVars((cur) => ({ ...cur, [v]: val }));
    } else if (el.action.type === 'show-message') {
      setBannerMessage(el.action.messageText || 'پیام دکمه!');
      setTimeout(() => setBannerMessage(null), 2500);
    }
  };

  // Interpolate dynamic tags like {score} and {health}
  const renderTextContent = (rawText: string) => {
    return rawText.replace(/\{(\w+)\}/g, (_, key) => {
      if (previewVars[key] !== undefined) {
        return String(previewVars[key]);
      }
      return `{${key}}`;
    });
  };

  // Canvas Mouse handlers for precise X/Y dragging
  const handlePointerDown = (e: React.PointerEvent, elem: UIElement) => {
    if (interactivePreview || activePage.layoutMode !== 'absolute') return;
    e.stopPropagation();
    setSelectedElementId(elem.id);
    setDragState({
      elemId: elem.id,
      startX: e.clientX,
      startY: e.clientY,
      initialX: elem.x,
      initialY: elem.y,
    });
  };

  const handleCanvasPointerMove = (e: React.PointerEvent) => {
    if (!dragState || activePage.layoutMode !== 'absolute') return;
    const dx = e.clientX - dragState.startX;
    const dy = e.clientY - dragState.startY;
    const nextX = Math.max(0, Math.round(dragState.initialX + dx));
    const nextY = Math.max(0, Math.round(dragState.initialY + dy));

    setPages((prev) =>
      prev.map((p) => {
        if (p.id !== activePage.id) return p;
        return {
          ...p,
          elements: p.elements.map((el) =>
            el.id === dragState.elemId ? { ...el, x: nextX, y: nextY } : el
          ),
        };
      })
    );
  };

  const handleCanvasPointerUp = () => {
    setDragState(null);
  };

  const currentDims = BREAKPOINT_DIMS[breakpoint];

  return (
    <div className="flex-1 flex flex-col h-full w-full bg-[#0B0E14] text-slate-100 overflow-hidden select-none">
      {/* Top Header / Viewport Bar */}
      <header className="px-4 py-2.5 border-b border-slate-800 bg-[#0E121B] flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Layout className="w-5 h-5 text-amber-400" />
            <h1 className="text-sm font-bold text-slate-100">طراح حرفه‌ای رابط کاربری (Visual UI Builder)</h1>
          </div>

          <div className="w-px h-5 bg-slate-800" />

          {/* Breakpoint Selector */}
          <div className="flex items-center gap-1 p-0.5 rounded-lg bg-[#070A0F] border border-slate-800 text-xs">
            <button
              type="button"
              onClick={() => setBreakpoint('desktop')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded cursor-pointer ${
                breakpoint === 'desktop' ? 'bg-sky-500 text-slate-950 font-bold' : 'text-slate-400 hover:text-white'
              }`}
            >
              <Monitor className="w-3.5 h-3.5" />
              دسکتاپ
            </button>
            <button
              type="button"
              onClick={() => setBreakpoint('tablet')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded cursor-pointer ${
                breakpoint === 'tablet' ? 'bg-sky-500 text-slate-950 font-bold' : 'text-slate-400 hover:text-white'
              }`}
            >
              <Tablet className="w-3.5 h-3.5" />
              تبلت
            </button>
            <button
              type="button"
              onClick={() => setBreakpoint('mobile')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded cursor-pointer ${
                breakpoint === 'mobile' ? 'bg-sky-500 text-slate-950 font-bold' : 'text-slate-400 hover:text-white'
              }`}
            >
              <Smartphone className="w-3.5 h-3.5" />
              موبایل
            </button>
          </div>
        </div>

        {/* Center / Right controls: Interactive Preview Toggle */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setInteractivePreview((p) => !p)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-colors ${
              interactivePreview
                ? 'bg-emerald-500 text-slate-950 hover:bg-emerald-400'
                : 'bg-slate-800 text-slate-200 border border-slate-700 hover:bg-slate-700'
            }`}
          >
            {interactivePreview ? <Eye className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            {interactivePreview ? 'خروج از پیش‌نمایش تعاملی' : 'پیش‌نمایش تعاملی و کلیک دکمه‌ها'}
          </button>
        </div>
      </header>

      {/* Main Workspace Area */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        {/* Left Sidebar: Pages & Component Palette */}
        <aside className="w-full lg:w-64 shrink-0 border-b lg:border-b-0 lg:border-l border-slate-800 bg-[#0E121B] flex flex-col overflow-hidden">
          {/* Pages Manager */}
          <div className="p-3 border-b border-slate-800 bg-[#121723] flex items-center justify-between">
            <span className="text-xs font-bold text-slate-200">صفحات و نماهای رابط</span>
            <button
              type="button"
              onClick={addPage}
              className="p-1 rounded bg-sky-500/15 text-sky-300 hover:bg-sky-500/25 cursor-pointer"
              title="افزودن صفحه جدید"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="max-h-48 overflow-y-auto p-2 space-y-1 border-b border-slate-800">
            {pages.map((p) => (
              <div
                key={p.id}
                onClick={() => setActivePageId(p.id)}
                className={`group flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs cursor-pointer ${
                  p.id === activePage.id
                    ? 'bg-sky-500/20 text-sky-200 border border-sky-500/40 font-semibold'
                    : 'text-slate-300 hover:bg-slate-800/60 border border-transparent'
                }`}
              >
                <span className="truncate">{p.name}</span>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      duplicatePage(p);
                    }}
                    className="p-1 text-slate-400 hover:text-slate-100"
                    title="کپی صفحه"
                  >
                    <Copy className="w-3 h-3" />
                  </button>
                  {pages.length > 1 && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        deletePage(p.id);
                      }}
                      className="p-1 text-slate-400 hover:text-red-400"
                      title="حذف صفحه"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Palette Tools */}
          <div className="p-3 border-b border-slate-800 bg-[#121723]">
            <span className="text-xs font-bold text-slate-200">افزودن عناصر رابط کاربری</span>
          </div>

          <div className="p-3 grid grid-cols-2 gap-2 overflow-y-auto flex-1">
            <button
              type="button"
              onClick={() => addElement('button')}
              className="p-2.5 rounded-lg border border-slate-700 bg-slate-800/70 hover:bg-slate-800 hover:border-amber-400 flex flex-col items-center gap-1.5 text-xs text-slate-200 cursor-pointer"
            >
              <Zap className="w-4 h-4 text-amber-400" />
              دکمه تعاملی
            </button>
            <button
              type="button"
              onClick={() => addElement('text')}
              className="p-2.5 rounded-lg border border-slate-700 bg-slate-800/70 hover:bg-slate-800 hover:border-sky-400 flex flex-col items-center gap-1.5 text-xs text-slate-200 cursor-pointer"
            >
              <Type className="w-4 h-4 text-sky-400" />
              متن و تیتر
            </button>
            <button
              type="button"
              onClick={() => addElement('progressBar')}
              className="p-2.5 rounded-lg border border-slate-700 bg-slate-800/70 hover:bg-slate-800 hover:border-red-400 flex flex-col items-center gap-1.5 text-xs text-slate-200 cursor-pointer"
            >
              <Heart className="w-4 h-4 text-red-400" />
              نوار سلامت / HP
            </button>
            <button
              type="button"
              onClick={() => addElement('badge')}
              className="p-2.5 rounded-lg border border-slate-700 bg-slate-800/70 hover:bg-slate-800 hover:border-yellow-400 flex flex-col items-center gap-1.5 text-xs text-slate-200 cursor-pointer"
            >
              <Sparkles className="w-4 h-4 text-yellow-400" />
              نشان امتیاز
            </button>
            <button
              type="button"
              onClick={() => addElement('container')}
              className="p-2.5 rounded-lg border border-slate-700 bg-slate-800/70 hover:bg-slate-800 hover:border-purple-400 flex flex-col items-center gap-1.5 text-xs text-slate-200 cursor-pointer"
            >
              <Layout className="w-4 h-4 text-purple-400" />
              کادر / پنل
            </button>
            <button
              type="button"
              onClick={() => addElement('image')}
              className="p-2.5 rounded-lg border border-slate-700 bg-slate-800/70 hover:bg-slate-800 hover:border-emerald-400 flex flex-col items-center gap-1.5 text-xs text-slate-200 cursor-pointer"
            >
              <ImageIcon className="w-4 h-4 text-emerald-400" />
              تصویر خارجی
            </button>
          </div>
        </aside>

        {/* Center: Interactive Visual Canvas */}
        <main
          className="flex-1 bg-[#070A0F] p-4 lg:p-8 overflow-auto flex items-center justify-center relative"
          onPointerMove={handleCanvasPointerMove}
          onPointerUp={handleCanvasPointerUp}
        >
          {bannerMessage && (
            <div className="absolute top-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl bg-amber-500 text-slate-950 font-bold text-xs shadow-2xl animate-in fade-in">
              {bannerMessage}
            </div>
          )}

          {/* Canvas Artboard Box */}
          <div
            style={{
              width: currentDims.width,
              height: currentDims.height,
              backgroundColor: activePage.bgColor || '#0f172a',
            }}
            className={`relative rounded-2xl border border-slate-800 shadow-2xl overflow-hidden transition-all duration-200 ${
              activePage.layoutMode === 'flex'
                ? `flex ${activePage.flexDirection === 'column' ? 'flex-col' : 'flex-row'} p-4 gap-${activePage.flexGap || 4}`
                : activePage.layoutMode === 'grid'
                  ? `grid grid-cols-${activePage.gridColumns || 3} p-4 gap-4`
                  : ''
            }`}
          >
            {activePage.elements.length === 0 ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-500 text-xs gap-2">
                <MousePointer className="w-8 h-8 opacity-40" />
                <span>عناصر را از ستون کناری اضافه کنید یا موقعیت آنها را آزادانه جابجا کنید.</span>
              </div>
            ) : (
              activePage.elements.map((el) => {
                const isSel = el.id === selectedElementId && !interactivePreview;

                const style: React.CSSProperties =
                  activePage.layoutMode === 'absolute'
                    ? {
                        position: 'absolute',
                        left: el.x,
                        top: el.y,
                        width: el.width,
                        height: el.height,
                        zIndex: el.zIndex,
                        backgroundColor: el.bgColor,
                        color: el.color,
                        borderColor: el.borderColor,
                        borderWidth: el.borderWidth,
                        borderRadius: el.borderRadius,
                        fontSize: el.fontSize,
                        fontWeight: el.fontWeight,
                      }
                    : {
                        width: el.width,
                        height: el.height,
                        backgroundColor: el.bgColor,
                        color: el.color,
                        borderColor: el.borderColor,
                        borderWidth: el.borderWidth,
                        borderRadius: el.borderRadius,
                        fontSize: el.fontSize,
                        fontWeight: el.fontWeight,
                      };

                return (
                  <div
                    key={el.id}
                    style={style}
                    onPointerDown={(e) => handlePointerDown(e, el)}
                    onClick={() => handleElementAction(el)}
                    className={`flex items-center justify-center text-center select-none overflow-hidden ${
                      isSel ? 'ring-2 ring-sky-400 ring-offset-2 ring-offset-black' : ''
                    } ${
                      el.type === 'button'
                        ? 'cursor-pointer hover:brightness-110 active:scale-95 transition-transform'
                        : interactivePreview
                          ? 'cursor-default'
                          : 'cursor-grab active:cursor-grabbing'
                    }`}
                  >
                    {el.type === 'progressBar' ? (
                      <div className="w-full h-full bg-slate-800 rounded overflow-hidden relative flex items-center justify-center">
                        <div
                          className="absolute inset-y-0 right-0 bg-red-500 transition-all duration-300"
                          style={{ width: `${(el.progressValue || 85)}%` }}
                        />
                        <span className="relative z-10 text-[10px] font-bold text-white px-2">
                          {renderTextContent(el.text)}
                        </span>
                      </div>
                    ) : el.type === 'image' ? (
                      el.imageUrl ? (
                        <img src={el.imageUrl} alt={el.name} className="w-full h-full object-cover" />
                      ) : (
                        <div className="flex flex-col items-center justify-center text-slate-500 text-[11px] gap-1">
                          <ImageIcon className="w-5 h-5" />
                          <span>تصویر خارجی</span>
                        </div>
                      )
                    ) : (
                      <span>{renderTextContent(el.text)}</span>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </main>

        {/* Right Sidebar: Inspector & Properties */}
        <aside className="w-full lg:w-80 shrink-0 border-t lg:border-t-0 lg:border-r border-slate-800 bg-[#0E121B] p-4 flex flex-col space-y-4 overflow-y-auto">
          {/* Page Layout Settings */}
          <div className="space-y-3 pb-3 border-b border-slate-800">
            <span className="text-xs font-bold text-slate-200">تنظیمات چیدمان صفحه</span>
            <div className="grid grid-cols-3 gap-1.5 text-xs">
              <button
                type="button"
                onClick={() =>
                  setPages((prev) =>
                    prev.map((p) => (p.id === activePage.id ? { ...p, layoutMode: 'absolute' } : p))
                  )
                }
                className={`py-1.5 rounded cursor-pointer ${
                  activePage.layoutMode === 'absolute'
                    ? 'bg-sky-500 text-slate-950 font-bold'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                مطلق (X, Y)
              </button>
              <button
                type="button"
                onClick={() =>
                  setPages((prev) =>
                    prev.map((p) => (p.id === activePage.id ? { ...p, layoutMode: 'flex' } : p))
                  )
                }
                className={`py-1.5 rounded cursor-pointer ${
                  activePage.layoutMode === 'flex'
                    ? 'bg-sky-500 text-slate-950 font-bold'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                Flexbox
              </button>
              <button
                type="button"
                onClick={() =>
                  setPages((prev) =>
                    prev.map((p) => (p.id === activePage.id ? { ...p, layoutMode: 'grid' } : p))
                  )
                }
                className={`py-1.5 rounded cursor-pointer ${
                  activePage.layoutMode === 'grid'
                    ? 'bg-sky-500 text-slate-950 font-bold'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                Grid
              </button>
            </div>
          </div>

          {/* Selected Element Properties */}
          {selectedElement ? (
            <div className="space-y-3 text-xs flex-1">
              <div className="flex items-center justify-between">
                <span className="font-bold text-sky-400">{selectedElement.name}</span>
                <button
                  type="button"
                  onClick={() => deleteElement(selectedElement.id)}
                  className="p-1 text-slate-500 hover:text-red-400"
                  title="حذف عنصر"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Exact Coordinates X and Y */}
              {activePage.layoutMode === 'absolute' && (
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-[11px] text-slate-400 font-mono">موقعیت X (پیکسل)</label>
                    <input
                      type="number"
                      value={selectedElement.x}
                      onChange={(e) => updateElement({ x: parseInt(e.target.value) || 0 })}
                      className="w-full px-2 py-1 bg-[#080B10] border border-slate-700 rounded text-slate-200 font-mono text-left"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] text-slate-400 font-mono">موقعیت Y (پیکسل)</label>
                    <input
                      type="number"
                      value={selectedElement.y}
                      onChange={(e) => updateElement({ y: parseInt(e.target.value) || 0 })}
                      className="w-full px-2 py-1 bg-[#080B10] border border-slate-700 rounded text-slate-200 font-mono text-left"
                    />
                  </div>
                </div>
              )}

              {/* Dimensions W & H */}
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-[11px] text-slate-400 font-mono">عرض (Width)</label>
                  <input
                    type="number"
                    value={selectedElement.width}
                    onChange={(e) => updateElement({ width: parseInt(e.target.value) || 10 })}
                    className="w-full px-2 py-1 bg-[#080B10] border border-slate-700 rounded text-slate-200 font-mono text-left"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] text-slate-400 font-mono">ارتفاع (Height)</label>
                  <input
                    type="number"
                    value={selectedElement.height}
                    onChange={(e) => updateElement({ height: parseInt(e.target.value) || 10 })}
                    className="w-full px-2 py-1 bg-[#080B10] border border-slate-700 rounded text-slate-200 font-mono text-left"
                  />
                </div>
              </div>

              {/* Text Content */}
              <div className="space-y-1">
                <label className="text-[11px] text-slate-400">متن عنصر (پشتیبانی از تگ‌های متغیر)</label>
                <input
                  type="text"
                  value={selectedElement.text}
                  onChange={(e) => updateElement({ text: e.target.value })}
                  placeholder="مثال: امتیاز: {score}"
                  className="w-full px-2.5 py-1.5 bg-[#080B10] border border-slate-700 rounded text-slate-200"
                />
              </div>

              {/* Colors */}
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-[11px] text-slate-400">رنگ پس‌زمینه</label>
                  <div className="flex items-center gap-1.5 bg-[#080B10] p-1 border border-slate-700 rounded">
                    <input
                      type="color"
                      value={selectedElement.bgColor.startsWith('#') ? selectedElement.bgColor : '#1e293b'}
                      onChange={(e) => updateElement({ bgColor: e.target.value })}
                      className="w-6 h-6 rounded cursor-pointer bg-transparent"
                    />
                    <span className="text-[10px] font-mono text-slate-300 truncate">{selectedElement.bgColor}</span>
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] text-slate-400">رنگ قلم (متن)</label>
                  <div className="flex items-center gap-1.5 bg-[#080B10] p-1 border border-slate-700 rounded">
                    <input
                      type="color"
                      value={selectedElement.color.startsWith('#') ? selectedElement.color : '#ffffff'}
                      onChange={(e) => updateElement({ color: e.target.value })}
                      className="w-6 h-6 rounded cursor-pointer bg-transparent"
                    />
                    <span className="text-[10px] font-mono text-slate-300 truncate">{selectedElement.color}</span>
                  </div>
                </div>
              </div>

              {/* Real Action Binding for Buttons */}
              <div className="space-y-2 pt-2 border-t border-slate-800">
                <span className="text-[11px] font-bold text-amber-400 flex items-center gap-1">
                  <Zap className="w-3.5 h-3.5" />
                  اتصال عملکرد واقعی هنگام کلیک (Action Binding)
                </span>

                <select
                  value={selectedElement.action?.type || ''}
                  onChange={(e) => {
                    const actionType = e.target.value as UIActionBinding['type'];
                    if (!actionType) {
                      updateElement({ action: undefined });
                    } else {
                      updateElement({
                        action: {
                          type: actionType,
                          targetPageId: pages.find((p) => p.id !== activePage.id)?.id,
                          varName: 'score',
                          varValue: 10,
                          soundName: 'coin',
                        },
                      });
                    }
                  }}
                  className="w-full px-2.5 py-1.5 bg-[#080B10] border border-slate-700 rounded text-slate-200"
                >
                  <option value="">بدون عمل (غیرفعال)</option>
                  <option value="navigate">رفتن به صفحه دیگر (Navigation)</option>
                  <option value="add-var">افزایش متغیر بازی (مثلاً امتیاز +10)</option>
                  <option value="set-var">تنظیم متغیر بازی (Set Variable)</option>
                  <option value="play-sound">پخش افکت صوتی (Play Sound)</option>
                  <option value="show-message">نمایش پیام دیالوگ (Show Message)</option>
                </select>

                {selectedElement.action?.type === 'navigate' && (
                  <div className="space-y-1">
                    <label className="text-[10px] text-slate-400">صفحه مقصد:</label>
                    <select
                      value={selectedElement.action.targetPageId || ''}
                      onChange={(e) =>
                        updateElement({
                          action: { ...selectedElement.action!, targetPageId: e.target.value },
                        })
                      }
                      className="w-full px-2 py-1 bg-[#080B10] border border-slate-700 rounded text-slate-200 text-xs"
                    >
                      {pages.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="text-slate-500 text-xs flex items-center justify-center h-48">
              یک عنصر را برای تنظیم موقعیت و عملکرد انتخاب کنید.
            </div>
          )}
        </aside>
      </div>
    </div>
  );
};
