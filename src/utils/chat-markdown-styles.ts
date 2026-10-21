import type { ChatFontFamilyId } from '@/constants/reading';
import { resolveChatFontFamily } from '@/constants/reading';

type BuildChatMarkdownStylesArgs = {
  color: string;
  secondaryColor: string;
  fontSize: number;
  fontFamily: ChatFontFamilyId;
};

/** Shared markdown styles for chat bubbles — keeps title/body spacing readable. */
export function buildChatMarkdownStyles({
  color,
  secondaryColor,
  fontSize,
  fontFamily,
}: BuildChatMarkdownStylesArgs) {
  const family = resolveChatFontFamily(fontFamily);
  const lineHeight = Math.round(fontSize * 1.55);
  const headingGap = Math.max(10, Math.round(fontSize * 0.65));
  const paragraphGap = Math.max(6, Math.round(fontSize * 0.35));

  return {
    body: {
      color,
      fontSize,
      lineHeight,
      fontFamily: family,
      marginTop: 0,
      marginBottom: 0,
    },
    text: {
      color,
      fontSize,
      lineHeight,
      fontFamily: family,
    },
    textgroup: {
      fontFamily: family,
    },
    paragraph: {
      marginTop: paragraphGap,
      marginBottom: paragraphGap,
      flexWrap: 'wrap' as const,
      flexDirection: 'row' as const,
      alignItems: 'flex-start' as const,
      justifyContent: 'flex-start' as const,
      width: '100%' as const,
    },
    heading1: {
      flexDirection: 'row' as const,
      fontSize: Math.round(fontSize * 1.45),
      lineHeight: Math.round(fontSize * 1.45 * 1.25),
      fontFamily: family,
      fontWeight: '700' as const,
      marginTop: 2,
      marginBottom: headingGap,
      color,
    },
    heading2: {
      flexDirection: 'row' as const,
      fontSize: Math.round(fontSize * 1.3),
      lineHeight: Math.round(fontSize * 1.3 * 1.25),
      fontFamily: family,
      fontWeight: '700' as const,
      marginTop: 2,
      marginBottom: headingGap,
      color,
    },
    heading3: {
      flexDirection: 'row' as const,
      fontSize: Math.round(fontSize * 1.15),
      lineHeight: Math.round(fontSize * 1.15 * 1.3),
      fontFamily: family,
      fontWeight: '700' as const,
      marginTop: 2,
      marginBottom: Math.max(8, headingGap - 2),
      color,
    },
    heading4: {
      flexDirection: 'row' as const,
      fontSize,
      lineHeight,
      fontFamily: family,
      fontWeight: '700' as const,
      marginTop: 2,
      marginBottom: Math.max(8, headingGap - 2),
      color,
    },
    heading5: {
      flexDirection: 'row' as const,
      fontSize: Math.max(13, fontSize - 1),
      lineHeight,
      fontFamily: family,
      fontWeight: '700' as const,
      marginBottom: 8,
      color,
    },
    heading6: {
      flexDirection: 'row' as const,
      fontSize: Math.max(12, fontSize - 2),
      lineHeight,
      fontFamily: family,
      fontWeight: '700' as const,
      marginBottom: 8,
      color,
    },
    strong: {
      fontWeight: '700' as const,
      color,
    },
    em: {
      color: secondaryColor,
      fontStyle: 'italic' as const,
      fontFamily: family,
    },
  };
}
