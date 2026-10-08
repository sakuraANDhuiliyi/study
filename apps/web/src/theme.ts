import type { ThemeConfig } from 'antd';

// Tabler-inspired tokens. Keep the matching CSS variables in tabler.css in sync.
export const appTheme: ThemeConfig = {
  token: {
    colorPrimary: '#206bc4',
    colorInfo: '#206bc4',
    colorSuccess: '#2b8a3e',
    colorWarning: '#b66a08',
    colorError: '#d63939',
    colorText: '#182433',
    colorTextSecondary: '#626976',
    colorBorder: '#dce1e7',
    colorBorderSecondary: '#e6e9ed',
    colorBgLayout: '#f6f8fb',
    borderRadius: 6,
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
    fontSize: 14,
    controlHeight: 38,
  },
  components: {
    Button: { primaryShadow: '0 1px 2px rgba(24,36,51,.06)', fontWeight: 500 },
    Table: { headerBg: '#f6f8fb', headerColor: '#626976', cellPaddingBlock: 14, rowHoverBg: '#f6f8fb' },
    Input: { activeShadow: '0 0 0 3px rgba(32,107,196,.12)' },
    Select: { optionSelectedBg: '#e9f1fb' },
    Tabs: { horizontalItemGutter: 24 },
    Modal: { titleFontSize: 18 },
  },
};
