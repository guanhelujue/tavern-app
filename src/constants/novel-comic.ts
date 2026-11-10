import type { ComicAspect, ComicPageLayout } from '../types/novel-comic';

export const COMIC_DIMENSIONS: Record<ComicAspect, { width: number; height: number }> = {
  portrait: { width: 768, height: 1024 },
  square: { width: 768, height: 768 },
  landscape: { width: 1024, height: 768 },
  wide: { width: 1024, height: 576 },
  tall: { width: 768, height: 1152 },
};

export const COMIC_MASTER_PAGE = { width: 1536, height: 2304 } as const;
export const COMIC_PAGE_MARGIN = 32;
export const COMIC_PANEL_GAP = 24;
export const COMIC_HEADER_HEIGHT = 100;
export const COMIC_CAPTION_HEIGHT = 144;

type PagePanel = { x: number; y: number; width: number; height: number; captionHeight: number };
export type ComicPageLayoutSpec = { width: number; height: number; panels: PagePanel[] };

export function getComicDimensions(aspect: ComicAspect): { width: number; height: number } {
  return COMIC_DIMENSIONS[aspect] ?? COMIC_DIMENSIONS.portrait;
}

export function getComicPageLayout(layout: ComicPageLayout): ComicPageLayoutSpec {
  const left = COMIC_PAGE_MARGIN;
  const top = COMIC_PAGE_MARGIN + COMIC_HEADER_HEIGHT;
  const fullWidth = COMIC_MASTER_PAGE.width - COMIC_PAGE_MARGIN * 2;
  // `height` is the complete panel slot, including its separately rendered caption.
  const fullHeight = COMIC_MASTER_PAGE.height - top - COMIC_PAGE_MARGIN;
  const captionHeight = COMIC_CAPTION_HEIGHT;
  const slotHeight = (fullHeight - COMIC_PANEL_GAP) / 2;
  const halfWidth = (fullWidth - COMIC_PANEL_GAP) / 2;
  const panel = (x: number, y: number, width: number, height: number): PagePanel => ({
    x, y, width, height, captionHeight,
  });

  switch (layout) {
    case 'daily-grid':
      return { width: COMIC_MASTER_PAGE.width, height: COMIC_MASTER_PAGE.height, panels: [
        panel(left, top, halfWidth, slotHeight),
        panel(left + halfWidth + COMIC_PANEL_GAP, top, halfWidth, slotHeight),
        panel(left, top + slotHeight + COMIC_PANEL_GAP, halfWidth, slotHeight),
        panel(left + halfWidth + COMIC_PANEL_GAP, top + slotHeight + COMIC_PANEL_GAP, halfWidth, slotHeight),
      ] };
    case 'daily-focus':
    case 'battle-action':
      return { width: COMIC_MASTER_PAGE.width, height: COMIC_MASTER_PAGE.height, panels: [
        panel(left, top, fullWidth, slotHeight),
        panel(left, top + slotHeight + COMIC_PANEL_GAP, halfWidth, slotHeight),
        panel(left + halfWidth + COMIC_PANEL_GAP, top + slotHeight + COMIC_PANEL_GAP, halfWidth, slotHeight),
      ] };
    case 'battle-impact':
      return { width: COMIC_MASTER_PAGE.width, height: COMIC_MASTER_PAGE.height, panels: [
        panel(left, top, fullWidth, fullHeight),
      ] };
  }
}
