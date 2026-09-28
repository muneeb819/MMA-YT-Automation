'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Palette, Check } from 'lucide-react';
import { Card, CardHeader, Button } from '@/components/ui';
import { VISUAL_STYLES, VISUAL_STYLE_LABELS, type VisualStyle } from '@/lib/domain';

const STYLE_DETAIL: Record<VisualStyle, { desc: string; prompt: string; swatch: string[] }> = {
  cinematic: { desc: 'Anamorphic film still, shallow depth of field, volumetric light.', prompt: 'cinematic film still, anamorphic lens, shallow depth of field, volumetric light', swatch: ['#7c5cff', '#1a1030'] },
  documentary: { desc: 'Journalistic photography, available light, 35mm.', prompt: 'documentary photograph, available light, journalistic, 35mm, high detail', swatch: ['#c9a227', '#141210'] },
  realistic: { desc: 'Photorealistic with natural lighting and high dynamic range.', prompt: 'photorealistic, natural lighting, high dynamic range, sharp focus', swatch: ['#4a7ba7', '#101418'] },
  dark_noir: { desc: 'High-contrast chiaroscuro with venetian blind light.', prompt: 'dark noir, high contrast chiaroscuro, deep shadows, venetian blind light', swatch: ['#5c6470', '#08080a'] },
  anime: { desc: 'Anime key visual, cel shaded with a vibrant palette.', prompt: 'anime key visual, cel shaded, vibrant palette, clean linework', swatch: ['#ff5c8a', '#1a1030'] },
  comic: { desc: 'Comic panel with bold ink outlines and halftone shading.', prompt: 'comic book panel, bold ink outlines, halftone shading, saturated color', swatch: ['#ffcc00', '#101010'] },
  graphic_novel: { desc: 'Ink-wash illustration with a muted, dramatic palette.', prompt: 'graphic novel illustration, ink wash, dramatic composition, muted palette', swatch: ['#8a8a8a', '#0d0d12'] },
  minimal: { desc: 'Minimalist composition with negative space.', prompt: 'minimalist composition, negative space, flat design, single accent colour', swatch: ['#3ddc97', '#0a0a0c'] },
  corporate: { desc: 'Clean, bright, even lighting on a neutral background.', prompt: 'clean corporate photography, bright even lighting, neutral background', swatch: ['#3b82f6', '#0c1220'] },
  futuristic: { desc: 'Neon accents and volumetric haze for a sci-fi feel.', prompt: 'futuristic sci-fi, neon accents, volumetric haze, high tech', swatch: ['#00e5ff', '#06061a'] },
  custom: { desc: 'Balanced cinematic default. Refine the prompt yourself.', prompt: 'cinematic, high detail, dramatic composition', swatch: ['#7c5cff', '#1a1030'] },
};

export default function VisualStylesPage() {
  const [selected, setSelected] = useState<VisualStyle>('cinematic');

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <header>
        <h1 className="text-3xl font-black tracking-tight text-white">Visual Styles</h1>
        <p className="mt-1.5 text-sm text-ink-400">
          The style descriptor appended to every scene's image prompt.
        </p>
      </header>

      <Card>
        <CardHeader
          title="Available styles"
          description="Select a style to preview the exact prompt fragment used during generation."
          action={<Palette size={16} className="text-ink-500" />}
        />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {VISUAL_STYLES.map((style) => {
            const d = STYLE_DETAIL[style];
            const active = selected === style;
            return (
              <button
                key={style}
                onClick={() => setSelected(style)}
                aria-pressed={active}
                className={`overflow-hidden rounded-xl border text-left transition-all ${
                  active ? 'border-accent shadow-lg shadow-accent/15' : 'border-ink-700 hover:border-ink-600'
                }`}
              >
                <div
                  className="h-16 w-full"
                  style={{ background: `linear-gradient(135deg, ${d.swatch[0]}, ${d.swatch[1]})` }}
                />
                <div className="p-3.5">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold text-white">{VISUAL_STYLE_LABELS[style]}</span>
                    {active && <Check size={15} className="text-accent-soft" aria-hidden="true" />}
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-ink-400">{d.desc}</p>
                </div>
              </button>
            );
          })}
        </div>
      </Card>

      <Card>
        <CardHeader title={`${VISUAL_STYLE_LABELS[selected]} — prompt fragment`} />
        <p className="rounded-xl border border-ink-700 bg-ink-900/60 p-3.5 font-mono text-xs leading-relaxed text-ink-300">
          {STYLE_DETAIL[selected].prompt}
        </p>
        <p className="mt-3 text-xs leading-relaxed text-ink-500">
          Every scene prompt is composed as:{' '}
          <code className="text-ink-300">[scene description], [style fragment], vertical 9:16 composition, high detail, professional grade, no text, no logos, no watermark, no borders</code>
        </p>
        <Link href="/create" className="btn-primary mt-5">
          Use this style
        </Link>
      </Card>

      <Card className="border-ink-700">
        <CardHeader title="Content rights" />
        <p className="text-sm leading-relaxed text-ink-300">
          ShortForge never scrapes or reuses copyrighted video. Visuals are either user-uploaded,
          AI-generated, or generated locally as an abstract background — each with its source recorded
          on the scene. Background music is synthesised locally so there is no licensing ambiguity.
        </p>
      </Card>
    </div>
  );
}
