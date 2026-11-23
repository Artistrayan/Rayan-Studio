import React from 'react';
import type { BoxChildLayer, RayanAsset, TextConfig } from '../types/studio';

interface BoxLayersRendererProps {
  cfg: TextConfig;
  assets: RayanAsset[];
  isPlaying: boolean;
  interpolateText: (raw: string) => string;
  onTriggerLayerClick: (layer: BoxChildLayer) => void;
  suppressClickRef: React.MutableRefObject<boolean>;
}

export const BoxLayersRenderer: React.FC<BoxLayersRendererProps> = ({
  cfg,
  assets,
  isPlaying,
  interpolateText,
  onTriggerLayerClick,
  suppressClickRef,
}) => {
  const children = cfg.children || [];
  const hasChildren = children.length > 0;
  const isHorizontal = cfg.layoutDirection === 'horizontal';
  const gap = cfg.childGap ?? 8;

  if (!hasChildren) {
    return (
      <div
        className={cfg.scrollableX ? 'whitespace-pre min-w-max' : 'whitespace-pre-wrap'}
        style={{ width: cfg.scrollableX ? 'max-content' : '100%' }}
      >
        {interpolateText(cfg.text)}
      </div>
    );
  }

  return (
    <div
      className={`flex ${isHorizontal ? 'flex-row items-stretch' : 'flex-col items-stretch'}`}
      style={{
        gap: `${gap}px`,
        width: isHorizontal || cfg.scrollableX ? 'max-content' : '100%',
        minWidth: '100%',
      }}
    >
      {cfg.text && cfg.text.trim().length > 0 && (
        <div
          className={cfg.scrollableX && !isHorizontal ? 'whitespace-pre' : 'whitespace-pre-wrap'}
          style={{
            flexShrink: 0,
            color: cfg.textColor,
          }}
        >
          {interpolateText(cfg.text)}
        </div>
      )}

      {children.map((layer) => {
        if (!layer.visible) return null;

        if (layer.kind === 'divider') {
          return (
            <div
              key={layer.id}
              style={{
                flexShrink: 0,
                backgroundColor: layer.borderColor || layer.color || '#334155',
                width: isHorizontal ? '1px' : '100%',
                height: isHorizontal ? 'auto' : '1px',
                minHeight: isHorizontal ? '24px' : '1px',
              }}
            />
          );
        }

        if (layer.kind === 'image') {
          const asset = layer.assetId ? assets.find((a) => a.id === layer.assetId) : undefined;
          return (
            <div
              key={layer.id}
              onClick={(e) => {
                if (!isPlaying || !layer.clickable || suppressClickRef.current) return;
                e.stopPropagation();
                onTriggerLayerClick(layer);
              }}
              style={{
                flexShrink: 0,
                width: layer.width ? `${layer.width}px` : isHorizontal ? '84px' : '100%',
                height: layer.height ? `${layer.height}px` : '64px',
                backgroundColor: layer.bgColor || 'rgba(15, 23, 42, 0.5)',
                border: `1px solid ${layer.borderColor || '#334155'}`,
                borderRadius: '8px',
              }}
              className={`overflow-hidden flex items-center justify-center ${
                isPlaying && layer.clickable ? 'cursor-pointer hover:brightness-110 active:scale-95 transition-transform' : ''
              }`}
            >
              {asset ? (
                <img
                  src={asset.dataUrl}
                  alt={layer.name}
                  className="w-full h-full object-contain pointer-events-none"
                />
              ) : (
                <span className="text-[11px] text-slate-400 px-2 text-center">
                  {interpolateText(layer.text || layer.name || 'تصویر')}
                </span>
              )}
            </div>
          );
        }

        const isBtn = layer.kind === 'button';
        const isBadge = layer.kind === 'badge';
        const isCard = layer.kind === 'card';
        const isInteractive = Boolean(isPlaying && (layer.clickable || isBtn));

        return (
          <div
            key={layer.id}
            onClick={(e) => {
              if (!isInteractive || suppressClickRef.current) return;
              e.stopPropagation();
              onTriggerLayerClick(layer);
            }}
            style={{
              flexShrink: 0,
              width: layer.width ? `${layer.width}px` : isHorizontal && isCard ? '150px' : undefined,
              minHeight: layer.height ? `${layer.height}px` : undefined,
              color: layer.color || cfg.textColor,
              backgroundColor: layer.bgColor || 'transparent',
              border: `1px solid ${layer.borderColor || (isBtn ? '#FCD34D' : '#334155')}`,
              borderRadius: isBadge ? '999px' : '8px',
              fontSize: layer.fontSize ? `${layer.fontSize}px` : undefined,
            }}
            className={`px-2.5 py-1.5 whitespace-pre-wrap leading-snug ${
              isBtn || isBadge ? 'font-bold text-center inline-flex items-center justify-center' : ''
            } ${
              isInteractive
                ? 'cursor-pointer hover:brightness-110 active:scale-95 transition-transform select-none'
                : ''
            }`}
          >
            {interpolateText(layer.text)}
          </div>
        );
      })}
    </div>
  );
};
