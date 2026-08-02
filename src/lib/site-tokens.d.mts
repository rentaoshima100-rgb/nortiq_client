export interface SiteTokens {
  origin: string;
  /** :root などで定義されているカスタムプロパティ */
  vars: { name: string; value: string }[];
  /** 実際に指定されている font-family。頻度順 */
  fonts: string[];
  /** @font-face で読み込んでいる書体名 */
  webFonts: string[];
  /** 使われている色。頻度順 */
  colors: string[];
  /** 文字サイズの刻み */
  fontSizes: string[];
  /** 余白の刻み */
  spacings: string[];
  radii: string[];
  /** 書体の読み込み先。プレビューで同じ書体を出すのに使う */
  fontLinks: string[];
  sheetCount: number;
  /** 抽出した日時。保存時に入れる */
  takenAt: string | null;
}

export function fetchSiteTokens(siteUrl: string): Promise<SiteTokens | null>;
export function tokensText(t: SiteTokens | null): string | null;
