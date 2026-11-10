// Page layouts. The same queries are written out in the page's <style> (keep them in sync).
export type Layout = 'desktop' | 'portrait' | 'landscape';
export const PORTRAIT_MQ = '(pointer: coarse) and (max-width: 600px) and (orientation: portrait)';
export const LANDSCAPE_MQ = '(pointer: coarse) and (max-height: 500px) and (orientation: landscape)';
