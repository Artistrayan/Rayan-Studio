import express from 'express';
import http from 'http';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { GoogleGenAI, Type } from '@google/genai';

dotenv.config();

const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';

async function startServer() {
  const app = express();
  const httpServer = http.createServer(app);
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, studio: 'rayan', aiConfigured: Boolean(process.env.GEMINI_API_KEY) });
  });

  app.post('/api/ai/generate-rules', async (req, res) => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      res.status(503).json({
        error: 'کلید سرویس هوش مصنوعی تنظیم نشده است. می‌توانید از کتابخانه آماده اسکریپت‌نویسی آفلاین استفاده کنید.',
      });
      return;
    }

    const { prompt, entities, engineMode } = req.body as {
      prompt?: string;
      entities?: Array<{ name: string; role: string }>;
      engineMode?: '2d' | '3d';
    };

    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      res.status(400).json({ error: 'لطفاً شرح قانون یا رفتار بازی را بنویسید.' });
      return;
    }

    try {
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });

      const entityListText = (entities ?? [])
        .map((e) => `- ${e.name} (نقش: ${e.role})`)
        .join('\n');

      const systemInstruction = `شما دستیار موتور قوانین استودیو بازی‌سازی رایان هستید.
وظیفه شما تبدیل درخواست فارسی کاربر به قوانین اجرایی ساختاریافته برای موتور ${engineMode === '3d' ? 'سه‌بعدی' : 'دوبعدی'} رایان است.
نام موجودیت‌های موجود در صحنه:
${entityListText || '- بازیکن (player)\n- سکه (collectible)\n- دشمن (enemy)'}

توضیح تریگرهای مجاز (triggerType):
- key-hold: نگه داشتن کلید (key: ArrowRight, ArrowLeft, ArrowUp, ArrowDown, Space, KeyW, KeyA, KeyS, KeyD, KeyE)
- key-press: زدن یکباره کلید
- every-seconds: تکرار زمانی هر N ثانیه (با فیلد intervalSeconds مثل 2 یا 3)
- on-click: کلیک روی موجودیت (targetName)
- on-collision: برخورد targetName با secondaryName
- on-tile-hazard: برخورد targetName با تله/خطر نقشه
- on-tile-finish: رسیدن targetName به پرچم پایان مرحله
- on-scroll: اسکرول روی کادر متن (targetName)
- always: اجرا در هر فریم (برای هوش مصنوعی تعقیب و گشت‌زنی)
- on-start: هنگام شروع بازی
- var-condition: شرط متغیر (varName: score یا health یا نام متغیر سفارشی, operator: >= یا <=, varValue: عدد)

توضیح اکشن‌های مجاز (actionType):
- move-right, move-left, move-up, move-down, move-forward, move-backward (با paramNumber برای سرعت مثل 240 در دوبعدی یا 6 در سه‌بعدی)
- jump (با paramNumber برای قدرت پرش مثل 520 در دوبعدی یا 9 در سه‌بعدی)
- throw-projectile (پرتاب تیر/توپ از targetName با paramNumber=قدرت مثل 560 و paramAngle=زاویه مثل 35)
- throw-self (پرتاب خود targetName با paramNumber=قدرت و paramAngle=زاویه)
- patrol-horizontal (گشت‌زنی رفت و برگشت با paramNumber=سرعت)
- chase-target (هوش مصنوعی تعقیب secondaryName با paramNumber=سرعت)
- orbit-target (چرخش مداری دور secondaryName با paramNumber=سرعت)
- spawn-entity (تولید خودکار یک نمونه جدید از targetName در صحنه)
- spawn-particles (افکت ذرات در محل targetName: paramText یکی از explosion, sparkle, smoke, snow, rain)
- camera-shake (لرزش دوربین با شدت paramNumber مثل 10)
- go-to-scene (رفتن به صحنه با نام paramText)
- next-scene (رفتن به مرحله/صحنه بعدی)
- set-var / add-var (تغییر متغیر سفارشی با varName و paramNumber)
- save-progress / load-progress (ذخیره یا بارگذاری پیشرفت بازیکن)
- add-score (افزایش یا کاهش امتیاز با paramNumber مثل 10 یا -10)
- add-health (تغییر جان با paramNumber مثل -20 یا 15)
- destroy-other (حذف آبجکت دوم در برخورد)
- destroy-self (حذف آبجکت اول)
- respawn (بازگشت targetName به نقطه شروع)
- play-sound (پخش صدا: paramText یکی از coin, jump, throw, hit, click, win)
- show-message (نمایش پیام متنی در paramText)
- set-text (تغییر متن targetName به paramText)

برای هر قانون یک خط persianLine به زبان فارسی خوانا و دقیق نیز برگردان.`;

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: prompt.trim(),
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              summary: { type: Type.STRING, description: 'توضیح کوتاه فارسی درباره قوانین تولیدشده' },
              rules: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    persianLine: { type: Type.STRING },
                    triggerType: { type: Type.STRING },
                    key: { type: Type.STRING },
                    targetName: { type: Type.STRING },
                    secondaryName: { type: Type.STRING },
                    varName: { type: Type.STRING },
                    operator: { type: Type.STRING },
                    varValue: { type: Type.NUMBER },
                    actionType: { type: Type.STRING },
                    paramNumber: { type: Type.NUMBER },
                    paramAngle: { type: Type.NUMBER },
                    paramText: { type: Type.STRING },
                  },
                  required: ['persianLine', 'triggerType', 'targetName', 'actionType'],
                },
              },
            },
            required: ['summary', 'rules'],
          },
        },
      });

      const parsed = JSON.parse((response.text ?? '{}').trim());
      res.json(parsed);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'خطا در ارتباط با سرویس هوش مصنوعی';
      res.status(502).json({ error: message });
    }
  });

  if (!isProduction) {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        ws: { server: httpServer },
        hmr: process.env.DISABLE_HMR === 'true' ? false : true,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
    }
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Rayan Game Studio server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
