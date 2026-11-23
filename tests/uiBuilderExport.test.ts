import { describe, it, expect } from 'vitest';
import {
  buildStandaloneUiAppHtml,
  createDefaultUiCollections,
  createDefaultUiPages,
} from '../src/engine/uiAppExporter';
import { createStarter2DProject } from '../src/storage/projectDb';
import type { UIPage } from '../src/types/studio';

describe('Visual App Builder Standalone Export', () => {
  it('preserves exact free-form X/Y/W/H coordinates, Flexbox/Grid CSS, multi-page navigation, and IndexedDB runtime', () => {
    const project = createStarter2DProject('اپ فروشگاه آزمایشی');
    const pages: UIPage[] = [
      {
        id: 'page_free',
        name: 'صفحه آزاد',
        isHome: true,
        layoutMode: 'free',
        gap: 12,
        gridCols: 2,
        bgColor: '#0f172a',
        elements: [
          {
            id: 'btn_go',
            type: 'button',
            label: 'برو به گرید',
            x: 137,
            y: 219,
            w: 192,
            h: 54,
            zIndex: 4,
            bgColor: '#f59e0b',
            textColor: '#020617',
            borderColor: '#d97706',
            borderRadius: 12,
            fontSize: 15,
            actionType: 'navigate',
            actionParam: 'page_grid',
          },
          {
            id: 'inp_user',
            type: 'input',
            label: 'نام',
            placeholder: 'نام کاربر',
            bindVar: 'username',
            x: 410,
            y: 95,
            w: 240,
            h: 44,
            bgColor: '#0b1120',
            textColor: '#f8fafc',
            borderRadius: 8,
            fontSize: 13,
          },
        ],
      },
      {
        id: 'page_grid',
        name: 'صفحه شبکه‌ای',
        isHome: false,
        layoutMode: 'grid',
        gap: 18,
        gridCols: 3,
        bgColor: '#1e293b',
        elements: [
          {
            id: 'list_1',
            type: 'list',
            label: 'فهرست رکوردها',
            collectionId: 'col_tasks',
            x: 0,
            y: 0,
            w: 320,
            h: 200,
            bgColor: '#111827',
            textColor: '#e2e8f0',
            borderRadius: 10,
            fontSize: 13,
          },
        ],
      },
    ];
    const collections = createDefaultUiCollections();

    const html = buildStandaloneUiAppHtml({
      project,
      pages,
      collections,
    });

    // Exact X/Y/W/H & zIndex preserved
    expect(html).toContain('left:137px;top:219px;width:192px;height:54px;z-index:4;');
    expect(html).toContain('left:410px;top:95px;width:240px;height:44px;');

    // CSS Grid & Gap preserved
    expect(html).toContain('display:grid;grid-template-columns:repeat(3, minmax(0, 1fr));gap:18px;');

    // Multi-page navigation & IndexedDB runtime present
    expect(html).toContain('data-action-type="navigate" data-action-param="page_grid"');
    expect(html).toContain("indexedDB.open('rayan_standalone_app_db', 1)");
    expect(html).toContain("createObjectStore('app_records'");
    expect(html).toContain('data-collection-id="col_tasks"');
  });

  it('escapes HTML/script injection payloads in user-supplied labels and project names', () => {
    const project = createStarter2DProject('<script>alert(1)</script>');
    const pages = createDefaultUiPages('App');
    pages[0].elements[0].label = '"><img src=x onerror=alert(2)>';

    const html = buildStandaloneUiAppHtml({
      project,
      pages,
      collections: createDefaultUiCollections(),
    });

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<img src=x onerror=alert(2)>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&quot;&gt;&lt;img src=x onerror=alert(2)&gt;');
  });
});
